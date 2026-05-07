use std::process::Command;

fn main() {
    // Rerun if web sources change
    println!("cargo:rerun-if-changed=web/");
    println!("cargo:rerun-if-changed=package.json");

    // Only build frontend if dist/web doesn't exist or we're in release mode
    let dist_web = std::path::Path::new("dist/web");
    let is_release = std::env::var("PROFILE")
        .map(|p| p == "release")
        .unwrap_or(false);

    if !dist_web.exists() || is_release {
        eprintln!("Building frontend with pnpm...");
        let status = Command::new("pnpm")
            .args(["build:web"])
            .status()
            .expect("Failed to run pnpm build:web. Is pnpm installed?");

        if !status.success() {
            panic!("pnpm build:web failed with status: {}", status);
        }
    }
}
