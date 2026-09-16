//! What Tailscale says about this machine: its HTTPS name and who is signed in.
//!
//! Read with `tailscale status --json`, only ever for this machine's own entry
//! — the peer list is never looked at. Used to show the address a phone should
//! open, and to let this machine's own login in when no allow-list is set.

use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TailscaleSelf {
    /// The tailnet is up and this machine is on it.
    pub running: bool,
    /// `machine.tailnet.ts.net`, without the trailing dot.
    pub dns_name: Option<String>,
    /// The signed-in user's login, e.g. an email address.
    pub login: Option<String>,
    /// HTTPS certificates are enabled for this machine's name.
    pub https: bool,
}

impl TailscaleSelf {
    /// The address a device on the tailnet opens once `tailscale serve` runs.
    pub fn url(&self) -> Option<String> {
        self.dns_name.as_ref().map(|n| format!("https://{n}"))
    }
}

/// This machine's Tailscale state, or `None` when the CLI is missing or silent.
pub fn status() -> Option<TailscaleSelf> {
    let json = run_with_timeout("tailscale", &["status", "--json"], Duration::from_secs(4))?;
    parse_status(&json)
}

/// The piece of `tailscale status --json` this module reads.
pub fn parse_status(json: &str) -> Option<TailscaleSelf> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    let me = v.get("Self")?;
    let dns_name = me
        .get("DNSName")
        .and_then(|d| d.as_str())
        .map(|d| d.trim_end_matches('.').to_string())
        .filter(|d| !d.is_empty());
    let login = me
        .get("UserID")
        .map(|id| match id {
            serde_json::Value::Number(n) => n.to_string(),
            other => other.as_str().unwrap_or_default().to_string(),
        })
        .and_then(|id| v.get("User")?.get(&id)?.get("LoginName")?.as_str().map(str::to_string));
    let https = match (&dns_name, v.get("CertDomains").and_then(|c| c.as_array())) {
        (Some(name), Some(domains)) => domains.iter().any(|d| d.as_str() == Some(name.as_str())),
        _ => false,
    };
    Some(TailscaleSelf {
        running: v.get("BackendState").and_then(|s| s.as_str()) == Some("Running"),
        dns_name,
        login,
        https,
    })
}

/// Run a command, giving up after `limit`: a wedged daemon must not hang the app.
fn run_with_timeout(cmd: &str, args: &[&str], limit: Duration) -> Option<String> {
    let mut child = Command::new(cmd)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut out = String::new();
        let _ = stdout.read_to_string(&mut out);
        out
    });
    let deadline = Instant::now() + limit;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let out = reader.join().ok()?;
                return status.success().then_some(out);
            }
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(50)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_this_machines_name_login_and_certificate() {
        let json = r#"{
            "BackendState": "Running",
            "Self": { "DNSName": "desk.example-tailnet.ts.net.", "UserID": 42 },
            "User": { "42": { "LoginName": "you@example.com" } },
            "CertDomains": ["desk.example-tailnet.ts.net"],
            "Peer": { "ignored": {} }
        }"#;
        let me = parse_status(json).unwrap();
        assert!(me.running);
        assert_eq!(me.dns_name.as_deref(), Some("desk.example-tailnet.ts.net"));
        assert_eq!(me.login.as_deref(), Some("you@example.com"));
        assert!(me.https);
        assert_eq!(me.url().as_deref(), Some("https://desk.example-tailnet.ts.net"));
    }

    #[test]
    fn a_stopped_tailnet_without_certificates() {
        let me = parse_status(r#"{ "BackendState": "Stopped", "Self": { "DNSName": "" } }"#).unwrap();
        assert!(!me.running);
        assert_eq!(me.dns_name, None);
        assert!(!me.https);
        assert_eq!(parse_status("not json"), None);
    }
}
