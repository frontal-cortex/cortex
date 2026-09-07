//! Which agent CLIs are installed on this machine.
//!
//! The terminal pane can open straight into an agent session instead of a
//! bare shell (`terminal_command` in settings). Rather than make the user
//! remember and type the binary name, the app offers the ones it can find.
//! Detection is a plain `$PATH` walk — no shelling out to `which`, which
//! would differ per shell and per platform — and the result carries the
//! resolved path so the UI can show where a command comes from.

use serde::Serialize;
use std::path::{Path, PathBuf};

/// The agent CLIs we know how to name: (id, label, command).
pub const KNOWN: [(&str, &str, &str); 11] = [
    ("claude", "Claude Code", "claude"),
    ("hermes", "Hermes", "hermes"),
    ("openclaw", "OpenClaw", "openclaw"),
    ("codex", "Codex CLI", "codex"),
    ("gemini", "Gemini CLI", "gemini"),
    ("opencode", "OpenCode", "opencode"),
    ("aider", "Aider", "aider"),
    ("goose", "Goose", "goose"),
    ("amp", "Amp", "amp"),
    ("copilot", "GitHub Copilot CLI", "copilot"),
    ("pi", "Pi", "pi"),
];

#[derive(Debug, Clone, Serialize)]
pub struct AgentCli {
    pub id: String,
    pub label: String,
    /// What to run — the value `terminal_command` takes.
    pub command: String,
    pub found: bool,
    /// Absolute path of the executable, when found.
    pub path: Option<String>,
}

/// Every known agent, in the fixed order above, with whether it is on `$PATH`.
pub fn detect() -> Vec<AgentCli> {
    KNOWN
        .iter()
        .map(|(id, label, command)| {
            let path = find_in_path(command);
            AgentCli {
                id: (*id).into(),
                label: (*label).into(),
                command: (*command).into(),
                found: path.is_some(),
                path: path.map(|p| p.to_string_lossy().into_owned()),
            }
        })
        .collect()
}

/// First executable named `command` on `$PATH`, the way a shell would find
/// it. On Windows a bare name also matches the `PATHEXT` variants
/// (`claude.cmd`, `claude.exe`) that npm-installed tools ship as.
pub fn find_in_path(command: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    let names = candidate_names(command);
    std::env::split_paths(&path)
        .filter(|dir| !dir.as_os_str().is_empty())
        .flat_map(|dir| names.iter().map(move |n| dir.join(n)).collect::<Vec<_>>())
        .find(|p| is_executable(p))
}

#[cfg(windows)]
fn candidate_names(command: &str) -> Vec<String> {
    let exts = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into());
    let mut names = vec![command.to_string()];
    names.extend(exts.split(';').filter(|e| !e.is_empty()).map(|e| format!("{command}{}", e.to_lowercase())));
    names
}

#[cfg(not(windows))]
fn candidate_names(command: &str) -> Vec<String> {
    vec![command.to_string()]
}

#[cfg(unix)]
fn is_executable(p: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    // `metadata` follows symlinks, so a link to a script counts as its target.
    std::fs::metadata(p)
        .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable(p: &Path) -> bool {
    p.is_file()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_a_common_binary() {
        // `sh` exists on every unix; the walk must find it and report a real path.
        if cfg!(unix) {
            let p = find_in_path("sh").expect("sh on PATH");
            assert!(p.is_absolute() && p.ends_with("sh"));
        }
        assert!(find_in_path("definitely-not-a-real-command-xyz").is_none());
    }

    #[test]
    fn detect_lists_every_known_agent() {
        let agents = detect();
        assert_eq!(agents.len(), KNOWN.len());
        for (a, (id, _, cmd)) in agents.iter().zip(KNOWN.iter()) {
            assert_eq!(a.id, *id);
            assert_eq!(a.command, *cmd);
            assert_eq!(a.found, a.path.is_some());
        }
    }
}
