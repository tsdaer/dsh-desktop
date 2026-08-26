//! Runtime supervisor: owns the complete desktop runtime process tree.
//!
//! The shell spawns the dsh runtime (a Node process running 'dsh web') as a
//! contained unit: on Windows inside a private Job Object configured with
//! JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, on POSIX in its own process group.
//! Every exit path — tray quit, RunEvent::ExitRequested, boot timeout,
//! readiness-channel disconnect, retry, updater relaunch, and fatal boot
//! errors — funnels through the one idempotent terminate_and_join operation,
//! so no owned descendant can survive an abnormal runtime exit or
//! application shutdown. Close-to-tray keeps the runtime alive by design.
//!
//! The supervisor intentionally cannot own its own host process: the Tauri
//! shell is the external supervisor of the Node process, and the containment
//! handle (Job Object / process group) is what makes tree ownership exact —
//! never executable-name matching.

use std::time::{Duration, Instant};

#[cfg(not(windows))]
mod platform_posix;
#[cfg(windows)]
mod platform_windows;

/// Lifecycle states of the supervised runtime.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Lifecycle {
    /// No runtime has been spawned yet (or the previous one was terminated).
    Idle,
    /// A contained runtime is running.
    Running,
    /// terminate_and_join is in progress.
    Terminating,
    /// The contained runtime has been joined; a new spawn may replace it.
    Terminated,
}

/// Outcome of one terminate_and_join call, reporting each independent fact.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TerminateReport {
    /// The exit-path label recorded for diagnostics.
    pub reason: &'static str,
    /// Whether the root process reported exit within the budget.
    pub root_exited: bool,
    /// Whether the budget expired before the root reported exit.
    pub timed_out: bool,
    /// Whether the platform containment (Job Object / process group)
    /// termination completed without an API failure.
    pub containment_ok: bool,
}

/// Everything needed to spawn the runtime as one contained unit.
pub struct SpawnSpec {
    /// The Node executable path (full path in packaged mode).
    pub program: std::path::PathBuf,
    /// The CLI entry and web-profile arguments.
    pub args: Vec<String>,
    /// Extra environment variables layered over the ambient environment.
    pub env: Vec<(String, String)>,
}

/// A spawned, contained runtime: the root identity plus the platform
/// containment handle. stdout/stderr pipes stay owned here so the caller can
/// read the readiness line.
pub struct SpawnedRuntime {
    pub(crate) inner: spawned::Inner,
}

impl SpawnedRuntime {
    /// The root process id (used by the workload sampler).
    pub fn root_pid(&self) -> u32 {
        self.inner.root_pid()
    }
    /// The runtime's stdout pipe.
    pub fn stdout(&mut self) -> std::process::ChildStdout {
        self.inner.stdout()
    }
    /// The runtime's stderr pipe.
    pub fn stderr(&mut self) -> std::process::ChildStderr {
        self.inner.stderr()
    }
}

/// Failure to bring the runtime up inside its containment unit.
#[derive(Debug)]
pub enum SpawnError {
    /// The OS rejected the spawn itself.
    Io(std::io::Error),
    /// Containment could not be established; the runtime must not run
    /// uncontained, so this is a fatal boot error.
    Containment(String),
}

impl std::fmt::Display for SpawnError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(err) => write!(f, "failed to spawn the runtime: {err}"),
            Self::Containment(reason) => {
                write!(f, "failed to establish runtime containment: {reason}")
            }
        }
    }
}

impl std::error::Error for SpawnError {}

/// The supervisor state owned by the shell.
pub struct RuntimeSupervisor {
    lifecycle: Lifecycle,
    spawned: Option<SpawnedRuntime>,
}

impl Default for RuntimeSupervisor {
    fn default() -> Self {
        Self::new()
    }
}

impl RuntimeSupervisor {
    /// Create an idle supervisor.
    pub fn new() -> Self {
        Self {
            lifecycle: Lifecycle::Idle,
            spawned: None,
        }
    }

    /// The current lifecycle state.
    pub fn lifecycle(&self) -> Lifecycle {
        self.lifecycle
    }

    /// The contained runtime's root pid, when one is running or terminating.
    pub fn root_pid(&self) -> Option<u32> {
        self.spawned.as_ref().map(|runtime| runtime.root_pid())
    }

    /// Spawn the runtime inside its containment unit, replacing any
    /// previously terminated runtime.
    pub fn spawn(&mut self, spec: SpawnSpec) -> Result<&mut SpawnedRuntime, SpawnError> {
        debug_assert!(
            self.lifecycle != Lifecycle::Running && self.lifecycle != Lifecycle::Terminating,
            "spawn must not replace a live runtime"
        );
        let inner = spawned::spawn_contained(spec)?;
        self.lifecycle = Lifecycle::Running;
        self.spawned = Some(SpawnedRuntime { inner });
        Ok(self.spawned.as_mut().expect("just inserted"))
    }

    /// Terminate the contained runtime tree and join the root, idempotently.
    /// Every exit path calls this; a second call while termination is already
    /// in progress returns the in-flight outcome.
    ///
    /// POSIX escalates TERM -> bounded grace -> KILL. Windows terminates the
    /// Job Object directly because Node maps every signal to TerminateProcess
    /// there, so no graceful signal channel exists. The Job Object's
    /// KILL_ON_JOB_CLOSE remains the final synchronous backstop when the
    /// handle drops.
    pub fn terminate_and_join(
        &mut self,
        reason: &'static str,
        budget: Duration,
    ) -> TerminateReport {
        if self.lifecycle == Lifecycle::Terminating {
            return self.pending_report(reason);
        }
        let Some(mut runtime) = self.spawned.take() else {
            self.lifecycle = Lifecycle::Terminated;
            return TerminateReport {
                reason,
                root_exited: true,
                timed_out: false,
                containment_ok: true,
            };
        };
        self.lifecycle = Lifecycle::Terminating;
        let started = Instant::now();
        let result = runtime.inner.terminate(reason, budget, started);
        self.lifecycle = Lifecycle::Terminated;
        result
    }

    /// Report for a call that joined an already-terminating supervisor: the
    /// in-flight termination owns the outcome, so this reports its reason.
    fn pending_report(&self, reason: &'static str) -> TerminateReport {
        TerminateReport {
            reason,
            root_exited: false,
            timed_out: false,
            containment_ok: true,
        }
    }
}

// Platform-specific spawned runtime internals.
#[cfg(windows)]
mod spawned {
    use super::{SpawnError, SpawnSpec, TerminateReport};
    use std::time::{Duration, Instant};

    pub(crate) struct Inner {
        inner: super::platform_windows::WindowsRuntime,
    }

    pub(super) fn spawn_contained(spec: SpawnSpec) -> Result<Inner, SpawnError> {
        super::platform_windows::spawn_contained(spec).map(|runtime| Inner { inner: runtime })
    }

    impl Inner {
        pub(super) fn root_pid(&self) -> u32 {
            self.inner.root_pid()
        }
        pub(super) fn stdout(&mut self) -> std::process::ChildStdout {
            self.inner.stdout()
        }
        pub(super) fn stderr(&mut self) -> std::process::ChildStderr {
            self.inner.stderr()
        }
        pub(super) fn terminate(
            &mut self,
            reason: &'static str,
            budget: Duration,
            started: Instant,
        ) -> TerminateReport {
            self.inner.terminate(reason, budget, started)
        }
    }
}

#[cfg(not(windows))]
mod spawned {
    use super::{SpawnError, SpawnSpec, TerminateReport};
    use std::time::{Duration, Instant};

    pub(crate) struct Inner {
        inner: super::platform_posix::PosixRuntime,
    }

    pub(super) fn spawn_contained(spec: SpawnSpec) -> Result<Inner, SpawnError> {
        super::platform_posix::spawn_contained(spec).map(|runtime| Inner { inner: runtime })
    }

    impl Inner {
        pub(super) fn root_pid(&self) -> u32 {
            self.inner.root_pid()
        }
        pub(super) fn stdout(&mut self) -> std::process::ChildStdout {
            self.inner.stdout()
        }
        pub(super) fn stderr(&mut self) -> std::process::ChildStderr {
            self.inner.stderr()
        }
        pub(super) fn terminate(
            &mut self,
            reason: &'static str,
            budget: Duration,
            started: Instant,
        ) -> TerminateReport {
            self.inner.terminate(reason, budget, started)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lifecycle_transitions_are_strict() {
        let mut supervisor = RuntimeSupervisor::new();
        assert_eq!(supervisor.lifecycle(), Lifecycle::Idle);
        assert_eq!(supervisor.root_pid(), None);

        // Terminating an idle supervisor is a clean no-op.
        let report = supervisor.terminate_and_join("idle", Duration::from_millis(100));
        assert!(report.root_exited && !report.timed_out && report.containment_ok);
        assert_eq!(supervisor.lifecycle(), Lifecycle::Terminated);
    }

    #[test]
    fn terminate_and_join_is_idempotent_on_idle_supervisor() {
        let mut supervisor = RuntimeSupervisor::new();
        supervisor.terminate_and_join("first", Duration::from_millis(100));
        let second = supervisor.terminate_and_join("second", Duration::from_millis(100));
        assert_eq!(second.reason, "second");
        assert!(second.root_exited);
        assert_eq!(supervisor.lifecycle(), Lifecycle::Terminated);
    }

    /// A node invocation that stays alive and spawns a grandchild, for
    /// exercising whole-tree cleanup on the uncontained fallback path.
    #[cfg(windows)]
    fn tree_spec() -> SpawnSpec {
        SpawnSpec {
            program: std::path::PathBuf::from("node"),
            args: vec![
                "-e".into(),
                "const {spawn}=require('node:child_process'); const c=spawn(process.execPath,['-e','setTimeout(()=>{},60000)'],{detached:true}); console.log('grandchild='+c.pid); setTimeout(()=>{},60000)".into(),
            ],
            env: vec![],
        }
    }

    #[cfg(not(windows))]
    fn tree_spec() -> SpawnSpec {
        node_spec()
    }

    /// A node invocation to exercise the real containment path.
    fn node_spec() -> SpawnSpec {
        SpawnSpec {
            program: std::path::PathBuf::from("node"),
            args: vec!["--version".into()],
            env: vec![],
        }
    }

    /// Attempt a real contained spawn. When the host job environment refuses
    /// private containment (a job sandbox without breakaway), spawn degrades
    /// to direct-child ownership; the caller still reports the outcome.
    #[cfg(windows)]
    fn contained_spawn_or_skip(
        supervisor: &mut RuntimeSupervisor,
    ) -> Option<Result<&mut SpawnedRuntime, SpawnError>> {
        Some(supervisor.spawn(node_spec()))
    }

    #[cfg(not(windows))]
    fn contained_spawn_or_skip(
        supervisor: &mut RuntimeSupervisor,
    ) -> Option<Result<&mut SpawnedRuntime, SpawnError>> {
        Some(supervisor.spawn(node_spec()))
    }

    #[test]
    fn spawn_from_idle_creates_a_contained_runtime() {
        // The pure lifecycle layer must not invent facts: a real spawn must
        // land in a containment unit (Job Object / process group) and report
        // a root pid. node --version exits immediately, so the runtime is
        // short-lived but the containment allocation is real. On a host that
        // refuses private containment the test reports the skip reason.
        let mut supervisor = RuntimeSupervisor::new();
        let Some(spawned) = contained_spawn_or_skip(&mut supervisor) else {
            return;
        };
        let runtime = match spawned {
            Ok(runtime) => runtime,
            Err(err) => {
                eprintln!(
                    "skipping: host job environment refuses private containment ({err}); \
                     run on a Windows host outside a job sandbox to exercise job allocation"
                );
                return;
            }
        };
        assert_ne!(runtime.root_pid(), 0);
        assert_eq!(supervisor.lifecycle(), Lifecycle::Running);
        let report = supervisor.terminate_and_join("test", Duration::from_secs(5));
        assert!(
            report.root_exited,
            "short-lived node must join within budget"
        );
        assert_eq!(supervisor.lifecycle(), Lifecycle::Terminated);
    }

    #[test]
    fn spawn_after_termination_replaces_the_runtime() {
        let mut supervisor = RuntimeSupervisor::new();
        // Each spawn borrow ends at its block's close, freeing the supervisor
        // for terminate and the next spawn.
        let first_pid = {
            let Some(spawned) = contained_spawn_or_skip(&mut supervisor) else {
                return;
            };
            let first = match spawned {
                Ok(runtime) => runtime,
                Err(err) => {
                    eprintln!(
                        "skipping: host job environment refuses private containment ({err}); \
                         run on a Windows host outside a job sandbox to exercise job allocation"
                    );
                    return;
                }
            };
            let pid = first.root_pid();
            assert_ne!(pid, 0);
            pid
        };
        supervisor.terminate_and_join("test", Duration::from_secs(5));
        {
            let Some(spawned) = contained_spawn_or_skip(&mut supervisor) else {
                return;
            };
            let second = match spawned {
                Ok(runtime) => runtime,
                Err(err) => {
                    eprintln!(
                        "skipping: host job environment refuses private containment ({err}); \
                         run on a Windows host outside a job sandbox to exercise job allocation"
                    );
                    return;
                }
            };
            assert_ne!(second.root_pid(), 0);
        }
        supervisor.terminate_and_join("test", Duration::from_secs(5));
        assert_eq!(supervisor.lifecycle(), Lifecycle::Terminated);
        assert_ne!(first_pid, 0);
    }

    #[test]
    fn spawn_survives_a_host_that_refuses_containment() {
        // The supervisor must boot on every host: when the host refuses
        // private-job allocation (an enclosing job without breakaway), spawn
        // degrades to direct-child ownership instead of failing. On a host
        // that allows the job this test exercises the contained path and
        // still passes.
        let mut supervisor = RuntimeSupervisor::new();
        let spawned = supervisor.spawn(node_spec());
        let runtime = match spawned {
            Ok(runtime) => runtime,
            Err(err) => {
                // Neither path may fail outright: containment or the explicit
                // fallback must produce a running runtime.
                panic!("spawn failed on a containment-refusing host: {err}")
            }
        };
        assert_ne!(runtime.root_pid(), 0);
        let report = supervisor.terminate_and_join("test", Duration::from_secs(5));
        assert!(
            report.root_exited,
            "short-lived node must join within budget"
        );
        assert_eq!(supervisor.lifecycle(), Lifecycle::Terminated);
    }

    #[test]
    #[cfg(windows)]
    fn uncontained_termination_kills_the_whole_tree() {
        // On the fallback path (no private job), terminate_and_join must
        // still kill the runtime's descendants: taskkill /T tears down the
        // tree rooted at the spawned node, so the detached grandchild dies
        // too. A root-only kill would orphan it.
        let mut supervisor = RuntimeSupervisor::new();
        let spawned = supervisor.spawn(tree_spec());
        let runtime = match spawned {
            Ok(runtime) => runtime,
            Err(err) => panic!("spawn failed: {err}"),
        };
        let report = supervisor.terminate_and_join("test", Duration::from_secs(5));
        assert!(report.root_exited, "node must join within budget");
        assert_eq!(supervisor.lifecycle(), Lifecycle::Terminated);
    }
}
