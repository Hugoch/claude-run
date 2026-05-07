mod embedded;
mod models;
mod push;
mod server;
mod state;
mod storage;
mod summarizer;
mod tags;
mod tls;
mod tts;
mod watcher;

use clap::Parser;

#[derive(Parser)]
#[command(name = "claude-run")]
#[command(about = "A beautiful web UI for browsing Claude Code conversation history")]
#[command(version)]
struct Cli {
    /// Port to listen on
    #[arg(short, long, default_value = "12001")]
    port: u16,

    /// Claude directory path
    #[arg(short, long, default_value_t = default_claude_dir())]
    dir: String,

    /// Enable CORS for development
    #[arg(long)]
    dev: bool,

    /// Do not open browser automatically
    #[arg(long)]
    no_open: bool,

    /// Enable HTTPS using Tailscale certificates
    #[arg(long)]
    tls: bool,

    /// Tailscale hostname (skips `tailscale status` call)
    #[arg(long)]
    hostname: Option<String>,
}

fn default_claude_dir() -> String {
    dirs::home_dir()
        .map(|h| format!("{}/.claude", h.display()))
        .unwrap_or_else(|| "~/.claude".to_string())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    // Load or generate VAPID keys for push notifications
    let (vapid_pem, vapid_pub) = push::load_or_generate_vapid(&cli.dir).unwrap_or_else(|e| {
        eprintln!("[push] Failed to load/generate VAPID keys: {}", e);
        (Vec::new(), String::new())
    });

    let state = state::AppState::new(cli.dir.clone(), cli.dev, vapid_pem, vapid_pub);

    // Load push subscriptions
    for sub in push::load_subscriptions(&cli.dir) {
        state.push_subscriptions.insert(sub.endpoint.clone(), sub);
    }

    // Load storage (file index + history cache)
    storage::load_storage(&state).await;

    // Start file watcher
    watcher::start_watcher(state.clone()).await?;

    // Load persisted tags
    tags::load_tags(&state).await;

    // Load persisted summaries and start background summarizer
    summarizer::load_summaries(&state).await;
    summarizer::spawn_summarizer(state.clone());
    summarizer::spawn_initial_summary_scan(state.clone());

    // Build router
    let app = server::create_router(state.clone());

    if cli.tls {
        // HTTPS mode with Tailscale certs
        let hostname = match cli.hostname {
            Some(h) => h,
            None => tls::tailscale_hostname()?,
        };
        let certs = tls::ensure_certs(&hostname)?;

        let tls_config =
            axum_server::tls_rustls::RustlsConfig::from_pem_file(&certs.cert_path, &certs.key_path)
                .await?;

        let tls_port = cli.port + 443;
        let url = format!("https://{}:{}/", hostname, tls_port);
        println!("\n  claude-run is running at {}", url);
        println!("  (hooks: http://localhost:{})\n", cli.port);

        if !cli.no_open && !cli.dev {
            let _ = opener::open(&url);
        }

        // HTTP on localhost only (for hooks)
        let http_app = server::create_router(state.clone());
        let http_listener =
            tokio::net::TcpListener::bind(format!("127.0.0.1:{}", cli.port)).await?;
        tokio::spawn(async move {
            axum::serve(http_listener, http_app).await.ok();
        });

        // HTTPS on all interfaces
        let tls_addr = std::net::SocketAddr::from(([0, 0, 0, 0], tls_port));
        let handle = axum_server::Handle::new();
        let handle_clone = handle.clone();

        tokio::spawn(async move {
            shutdown_signal().await;
            handle_clone.graceful_shutdown(None);
        });

        axum_server::bind_rustls(tls_addr, tls_config)
            .handle(handle)
            .serve(app.into_make_service())
            .await?;
    } else {
        // HTTP mode (default)
        let url = if cli.dev {
            "http://localhost:12000/".to_string()
        } else {
            format!("http://localhost:{}/", cli.port)
        };

        println!("\n  claude-run is running at {}\n", url);

        if !cli.no_open && !cli.dev {
            let _ = opener::open(&url);
        }

        let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", cli.port)).await?;

        axum::serve(listener, app)
            .with_graceful_shutdown(shutdown_signal())
            .await?;
    }

    Ok(())
}

async fn shutdown_signal() {
    tokio::signal::ctrl_c()
        .await
        .expect("Failed to install Ctrl+C handler");

    println!("\nShutting down (Ctrl+C again to force)...");

    // Second Ctrl+C → force exit
    tokio::spawn(async {
        tokio::signal::ctrl_c().await.ok();
        std::process::exit(1);
    });
}
