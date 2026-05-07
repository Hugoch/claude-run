use std::path::PathBuf;

use anyhow::{Context, Result};

const MACOS_TAILSCALE: &str = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";

pub struct TlsCerts {
    pub cert_path: PathBuf,
    pub key_path: PathBuf,
}

fn tailscale_bin() -> &'static str {
    if std::path::Path::new(MACOS_TAILSCALE).exists() {
        MACOS_TAILSCALE
    } else {
        "tailscale"
    }
}

pub fn tailscale_hostname() -> Result<String> {
    let output = std::process::Command::new(tailscale_bin())
        .args(["status", "--json"])
        .output()
        .context("Failed to run `tailscale status --json`. Is Tailscale installed?")?;
    if !output.status.success() {
        anyhow::bail!(
            "tailscale status failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    let json: serde_json::Value =
        serde_json::from_slice(&output.stdout).context("Failed to parse tailscale status JSON")?;

    let dns_name = json["Self"]["DNSName"]
        .as_str()
        .context("Missing Self.DNSName in tailscale status")?;

    // Strip trailing dot
    Ok(dns_name.trim_end_matches('.').to_string())
}

pub fn ensure_certs(hostname: &str) -> Result<TlsCerts> {
    let certs_dir = dirs::home_dir()
        .context("Cannot determine home directory")?
        .join(".claude")
        .join("certs");

    std::fs::create_dir_all(&certs_dir).context("Failed to create ~/.claude/certs/ directory")?;

    let cert_path = certs_dir.join(format!("{hostname}.crt"));
    let key_path = certs_dir.join(format!("{hostname}.key"));

    // Skip cert generation if they already exist
    if cert_path.exists() && key_path.exists() {
        return Ok(TlsCerts {
            cert_path,
            key_path,
        });
    }

    let output = std::process::Command::new(tailscale_bin())
        .args([
            "cert",
            &format!("--cert-file={}", cert_path.display()),
            &format!("--key-file={}", key_path.display()),
            hostname,
        ])
        .output()
        .context("Failed to run `tailscale cert`")?;

    if !output.status.success() {
        anyhow::bail!(
            "tailscale cert failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    Ok(TlsCerts {
        cert_path,
        key_path,
    })
}
