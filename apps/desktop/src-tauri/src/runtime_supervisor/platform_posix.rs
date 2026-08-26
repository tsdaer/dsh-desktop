//! POSIX containment: the runtime in its own process group.
//!
//! The runtime is spawned into a fresh process group (setpgid via std's
//! CommandExt). Termination sends TERM to the whole group, waits a bounded
//! grace, then sends KILL and joins the root. The process group covers every
//! descendant that stays in the group (Node workers and child processes
//! without their own group); process-name matching is never used.
//!
//! The supervisor contains ESRCH and exit races: a group that already exited
//! is reported as exited, and a kill that finds no process is not an error.

use std::io;
use std::os::unix::process::CommandExt;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use super::{SpawnError, SpawnSpec, TerminateReport};

/// A POSIX-contained runtime: the std child plus the group id (the root pid).
pub(super) struct PosixRuntime {
    child: Child,
    root_pid: u32,
}

impl PosixRuntime {
    /// The root process id (also the process group id).
    pub(super) fn root_pid(&self) -> u32 {
        self.root_pid
    }
    /// The root's stdout pipe (ownership moves out).
    pub(super) fn stdout(&mut self) -> std::process::ChildStdout {
        self.child.stdout.take().expect("piped stdout")
    }
    /// The root's stderr pipe (ownership moves out).
    pub(super) fn stderr(&mut self) -> std::process::ChildStderr {
        self.child.stderr.take().expect("piped stderr")
    }

    /// Terminate the whole group: TERM, bounded grace, KILL, then join.
    pub(super) fn terminate(
        &mut self,
        reason: &'static str,
        budget: Duration,
        started: Instant,
    ) -> TerminateReport {
        let group = -(self.root_pid as i32);
        // Phase 1: TERM to the group.
        let term_result = unsafe { libc::kill(group, libc::SIGTERM) };
        if term_result != 0 {
            let err = io::Error::last_os_error();
            // ESRCH means the group is already gone: a clean exit.
            if err.raw_os_error() != Some(libc::ESRCH) {
                eprintln!(
                    "[dsh-desktop] runtime termination ({reason}) TERM to group {group} failed: {err}"
                );
            }
        }
        let mut elapsed = started.elapsed();
        let mut remaining = budget.saturating_sub(elapsed);
        let grace = remaining.min(Duration::from_secs(5));
        if wait_with_timeout(&mut self.child, grace) {
            return TerminateReport {
                reason,
                root_exited: true,
                timed_out: false,
                containment_ok: true,
            };
        }
        elapsed = started.elapsed();
        remaining = budget.saturating_sub(elapsed);
        if remaining.is_zero() {
            // The budget expired before the grace completed; the root may
            // still be alive, so report the timeout fact.
            let _ = wait_with_timeout(&mut self.child, Duration::ZERO);
            return TerminateReport {
                reason,
                root_exited: self.child.try_wait().ok().flatten().is_some(),
                timed_out: true,
                containment_ok: true,
            };
        }
        // Phase 2: KILL to the group.
        let kill_result = unsafe { libc::kill(group, libc::SIGKILL) };
        if kill_result != 0 {
            let err = io::Error::last_os_error();
            if err.raw_os_error() != Some(libc::ESRCH) {
                eprintln!(
                    "[dsh-desktop] runtime termination ({reason}) KILL to group {group} failed: {err}"
                );
            }
        }
        let joined = wait_with_timeout(&mut self.child, remaining);
        TerminateReport {
            reason,
            root_exited: joined,
            timed_out: !joined,
            containment_ok: true,
        }
    }
}

/// Spawn the runtime into a fresh process group.
pub(super) fn spawn_contained(spec: SpawnSpec) -> Result<PosixRuntime, SpawnError> {
    let mut cmd = Command::new(&spec.program);
    cmd.args(&spec.args);
    for (key, value) in &spec.env {
        cmd.env(key, value);
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0);
    let child = cmd.spawn().map_err(SpawnError::Io)?;
    let root_pid = child.id();
    Ok(PosixRuntime { child, root_pid })
}

/// Poll the child's exit within the budget; returns whether it reported exit.
fn wait_with_timeout(child: &mut Child, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return true,
            Ok(None) => {
                if Instant::now() >= deadline {
                    return false;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            Err(_) => return false,
        }
    }
}
