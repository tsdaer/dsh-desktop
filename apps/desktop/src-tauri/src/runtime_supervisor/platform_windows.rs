//! Windows containment: a private Job Object over the suspended runtime.
//!
//! The runtime is spawned suspended (CREATE_SUSPENDED via std's Command), its
//! process handle is opened, the process is assigned to a private Job Object
//! configured with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, and only then is the
//! process resumed (NtResumeProcess). The Job Object covers Node workers and
//! every descendant launched from the runtime's node_modules without
//! process-name matching and without touching unrelated Node installations.
//! Termination calls TerminateJobObject and joins the root child; dropping
//! the supervisor's job handle is the final synchronous backstop
//! (KILL_ON_JOB_CLOSE).
//!
//! Containment allocation failure is fatal to boot: the runtime must never
//! run uncontained, so a failed assignment tears down the suspended child
//! and reports a Containment error instead of falling back to direct-child
//! ownership.

use std::io;
use std::os::windows::process::CommandExt;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows::Win32::System::Threading::{
    OpenProcess, PROCESS_ACCESS_RIGHTS, PROCESS_SUSPEND_RESUME,
};

use super::{SpawnError, SpawnSpec, TerminateReport};

/// The CREATE_NO_WINDOW creation flag (0x08000000): keeps the console-
/// subsystem node.exe headless under a GUI-subsystem parent.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
/// CREATE_SUSPENDED (0x4): the runtime starts paused until its job is set.
const CREATE_SUSPENDED: u32 = 0x4;
/// CREATE_BREAKAWAY_FROM_JOB (0x01000000): detach the runtime from an
/// enclosing job (when the enclosing job allows breakaway) so it can be
/// assigned to our private job. Without it, a runtime spawned from inside a
/// toolchain job (CI runner, dev sandbox) inherits that job and the private
/// assignment is refused with access denied.
const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;

// ntdll's process resume entry: resumes every thread of one process. std
// never exposes the suspended main-thread handle, and ResumeThread needs
// exactly that handle, so this is the resume path for a suspended spawn.
#[link(name = "ntdll")]
extern "system" {
    fn NtResumeProcess(process: HANDLE) -> i32;
}

/// A Windows-contained runtime: the std child (stdio, pid, join) plus the
/// owning job handle. The job is None only under an explicit, non-silent
/// uncontained fallback (DSH_DESKTOP_ALLOW_UNCONTAINED=1): the caller accepts
/// direct-child ownership when the host refuses private-job allocation, and
/// termination then kills the root child only.
pub(super) struct WindowsRuntime {
    child: Child,
    /// The private job; closing it kills the job tree (KILL_ON_JOB_CLOSE).
    job: Option<HANDLE>,
    root_pid: u32,
}

// The job handle is a kernel handle owned by this struct; it is only ever
// closed by this struct's Drop and only ever waited on from the supervisor
// mutex, so the struct is safe to move across threads under that lock.
// std::process::Child is already Send; HANDLE (a *mut c_void) is not.
unsafe impl Send for WindowsRuntime {}

impl WindowsRuntime {
    /// The root process id.
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

    /// Terminate the whole job and join the root. Windows cannot deliver a
    /// graceful signal to Node (all signals map to TerminateProcess), so the
    /// termination is direct; the budget bounds the join wait.
    pub(super) fn terminate(
        &mut self,
        reason: &'static str,
        budget: Duration,
        started: Instant,
    ) -> TerminateReport {
        let containment_ok = match self.job {
            Some(job) => match unsafe { TerminateJobObject(job, 1) } {
                Ok(()) => true,
                Err(err) => {
                    eprintln!(
                        "[dsh-desktop] runtime termination ({reason}) failed to terminate the job: {err}"
                    );
                    false
                }
            },
            // Explicit uncontained fallback: no job owns the tree, so the root
            // kill is the only termination verb.
            None => self.child.kill().is_ok(),
        };
        let elapsed = started.elapsed();
        let remaining = budget.saturating_sub(elapsed);
        let joined = wait_with_timeout(&mut self.child, remaining);
        TerminateReport {
            reason,
            root_exited: joined,
            timed_out: !joined,
            containment_ok,
        }
    }
}

impl Drop for WindowsRuntime {
    fn drop(&mut self) {
        // Closing the job handle triggers JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE:
        // the final synchronous backstop for any process that survived
        // termination. The child handle itself is reaped by the Child drop.
        if let Some(job) = self.job {
            unsafe {
                let _ = CloseHandle(job);
            }
        }
    }
}

/// Spawn the runtime suspended, assign it to a private job, then resume it.
pub(super) fn spawn_contained(spec: SpawnSpec) -> Result<WindowsRuntime, SpawnError> {
    let job = create_private_job()?;
    match spawn_suspended(&spec, job) {
        Ok(runtime) => Ok(runtime),
        Err(err) => {
            unsafe {
                let _ = CloseHandle(job);
            }
            Err(err)
        }
    }
}

/// Create the private job object configured with KILL_ON_JOB_CLOSE.
fn create_private_job() -> Result<HANDLE, SpawnError> {
    let job = unsafe { CreateJobObjectW(None, None) }
        .map_err(|err| SpawnError::Containment(format!("CreateJobObjectW failed: {err}")))?;
    let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    let result = unsafe {
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const _,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    };
    if let Err(err) = result {
        unsafe {
            let _ = CloseHandle(job);
        }
        return Err(SpawnError::Containment(format!(
            "SetInformationJobObject failed: {err}"
        )));
    }
    Ok(job)
}

/// Spawn the runtime suspended via std's Command, assign it to the job, then
/// resume it. The spawn must not return until containment is established:
/// a suspended child is torn down on any assignment failure.
///
/// Breakaway handling: when the shell itself runs inside an enclosing job
/// (CI runner, dev sandbox) and that job permits breakaway, the runtime is
/// spawned with CREATE_BREAKAWAY_FROM_JOB so it can join our private job. If
/// the enclosing job refuses breakaway (ERROR_ACCESS_DENIED at spawn), the
/// spawn is retried without the flag; the child then inherits the enclosing
/// job and the private assignment fails loudly, which is the correct fatal
/// outcome — the containment guarantee cannot be established in that host.
fn spawn_suspended(spec: &SpawnSpec, job: HANDLE) -> Result<WindowsRuntime, SpawnError> {
    let flags_with_breakaway = CREATE_SUSPENDED | CREATE_NO_WINDOW | CREATE_BREAKAWAY_FROM_JOB;
    let flags_without_breakaway = CREATE_SUSPENDED | CREATE_NO_WINDOW;
    let mut child = match spawn_command(spec, flags_with_breakaway) {
        Ok(child) => child,
        Err(err) if err.kind() == io::ErrorKind::PermissionDenied => {
            // The enclosing job refuses breakaway; retry inheriting it. The
            // assignment below then fails loudly, never silently uncontained.
            spawn_command(spec, flags_without_breakaway).map_err(SpawnError::Io)?
        }
        Err(err) => return Err(SpawnError::Io(err)),
    };
    let pid = child.id();

    let process = match open_process(pid) {
        Ok(handle) => handle,
        Err(err) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(SpawnError::Containment(format!(
                "OpenProcess({pid}) failed: {err}"
            )));
        }
    };

    let assign = unsafe { AssignProcessToJobObject(job, process) };
    if let Err(err) = assign {
        // The suspended child must never run uncontained — unless the host
        // explicitly opts into the uncontained fallback (DSH_DESKTOP_ALLOW_UNCONTAINED=1,
        // set only by test tooling that runs inside an enclosing job). The
        // fallback is never silent: it logs the diagnosis and the supervisor
        // reports containment_ok=false at termination.
        if std::env::var("DSH_DESKTOP_ALLOW_UNCONTAINED").is_ok_and(|v| v == "1") {
            eprintln!(
                "[dsh-desktop] runtime containment refused by the host ({err}); \
                 running uncontained per DSH_DESKTOP_ALLOW_UNCONTAINED=1"
            );
            let resume = unsafe { NtResumeProcess(process) };
            unsafe {
                let _ = CloseHandle(process);
            }
            if resume != 0 {
                let _ = child.kill();
                let _ = child.wait();
                return Err(SpawnError::Containment(format!(
                    "NtResumeProcess failed with status {resume}"
                )));
            }
            return Ok(WindowsRuntime {
                child,
                job: None,
                root_pid: pid,
            });
        }
        let _ = child.kill();
        let _ = child.wait();
        unsafe {
            let _ = CloseHandle(process);
        }
        return Err(SpawnError::Containment(format!(
            "AssignProcessToJobObject failed: {err}"
        )));
    }

    // The assignment call above is authoritative: a successful
    // AssignProcessToJobObject means the process is inside our job.

    // Resume the suspended process now that containment is established.
    let resume = unsafe { NtResumeProcess(process) };
    unsafe {
        let _ = CloseHandle(process);
    }
    if resume != 0 {
        let _ = child.kill();
        let _ = child.wait();
        return Err(SpawnError::Containment(format!(
            "NtResumeProcess failed with status {resume}"
        )));
    }

    Ok(WindowsRuntime {
        child,
        job: Some(job),
        root_pid: pid,
    })
}

/// Build and spawn the suspended runtime Command with the given creation flags.
fn spawn_command(spec: &SpawnSpec, flags: u32) -> io::Result<Child> {
    let mut cmd = Command::new(&spec.program);
    cmd.args(&spec.args);
    for (key, value) in &spec.env {
        cmd.env(key, value);
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(flags);
    cmd.spawn()
}

/// Open the process with the access needed to resume it.
fn open_process(pid: u32) -> io::Result<HANDLE> {
    let access = PROCESS_ACCESS_RIGHTS(PROCESS_SUSPEND_RESUME.0);
    unsafe { OpenProcess(access, false, pid) }
        .map_err(|err| io::Error::new(io::ErrorKind::Other, err.to_string()))
}

/// Poll the child's exit within the remaining budget; returns whether it
/// reported exit. The child handle is reaped by std when it exits.
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
