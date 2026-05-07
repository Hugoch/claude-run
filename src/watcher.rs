use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use notify::{Config, Event, PollWatcher, RecommendedWatcher, RecursiveMode, Watcher};
use tokio::sync::mpsc;

use crate::state::AppState;

pub async fn start_watcher(state: Arc<AppState>) -> anyhow::Result<()> {
    let claude_dir = PathBuf::from(&state.claude_dir);
    let projects_dir = PathBuf::from(&state.projects_dir);

    let (tx, mut rx) = mpsc::channel::<Event>(256);

    let use_polling = std::env::var("CLAUDE_RUN_USE_POLLING")
        .map(|v| v == "1")
        .unwrap_or(false);

    // Spawn the watcher in a blocking thread since notify watchers are !Send on some platforms
    let claude_dir_clone = claude_dir.clone();
    let projects_dir_clone = projects_dir.clone();
    let dev_mode = state.dev_mode;

    std::thread::spawn(move || {
        let tx = tx;

        if use_polling {
            let config = Config::default().with_poll_interval(Duration::from_millis(100));
            let tx_clone = tx.clone();
            let mut watcher = PollWatcher::new(
                move |res: Result<Event, notify::Error>| {
                    if let Ok(event) = res {
                        let _ = tx_clone.blocking_send(event);
                    }
                },
                config,
            )
            .expect("Failed to create poll watcher");

            // Watch ~/.claude/ directory (catches history.jsonl changes)
            if let Err(e) = watcher.watch(&claude_dir_clone, RecursiveMode::NonRecursive) {
                eprintln!("[watcher] failed to watch claude dir: {}", e);
            }
            if projects_dir_clone.exists() {
                if let Err(e) = watcher.watch(&projects_dir_clone, RecursiveMode::Recursive) {
                    eprintln!("[watcher] failed to watch projects dir: {}", e);
                }
            }

            loop {
                std::thread::sleep(Duration::from_secs(3600));
            }
        } else {
            let tx_clone = tx.clone();
            let mut watcher = RecommendedWatcher::new(
                move |res: Result<Event, notify::Error>| {
                    if let Ok(event) = res {
                        let _ = tx_clone.blocking_send(event);
                    }
                },
                Config::default(),
            )
            .expect("Failed to create watcher");

            // Watch ~/.claude/ directory (catches history.jsonl changes)
            if let Err(e) = watcher.watch(&claude_dir_clone, RecursiveMode::NonRecursive) {
                eprintln!("[watcher] failed to watch claude dir: {}", e);
            }
            if projects_dir_clone.exists() {
                if let Err(e) = watcher.watch(&projects_dir_clone, RecursiveMode::Recursive) {
                    eprintln!("[watcher] failed to watch projects dir: {}", e);
                }
            }

            if dev_mode {
                eprintln!(
                    "[watcher] watching {} and {}",
                    claude_dir_clone.display(),
                    projects_dir_clone.display()
                );
            }

            loop {
                std::thread::sleep(Duration::from_secs(3600));
            }
        }
    });

    // Debounce + dispatch events
    tokio::spawn(async move {
        use std::collections::HashMap;
        use tokio::time::{sleep, Instant};

        let debounce_ms = Duration::from_millis(20);
        let mut pending: HashMap<PathBuf, Instant> = HashMap::new();

        loop {
            // Drain available events
            let mut got_event = false;
            while let Ok(event) = rx.try_recv() {
                got_event = true;
                for path in event.paths {
                    pending.insert(path, Instant::now());
                }
            }

            // Check for debounced events ready to fire
            let now = Instant::now();
            let mut to_emit = Vec::new();
            pending.retain(|path, instant| {
                if now.duration_since(*instant) >= debounce_ms {
                    to_emit.push(path.clone());
                    false
                } else {
                    true
                }
            });

            for path in to_emit {
                emit_change(&state, &path);
            }

            if !got_event && pending.is_empty() {
                // Wait for next event (blocking)
                match rx.recv().await {
                    Some(event) => {
                        for path in event.paths {
                            pending.insert(path, Instant::now());
                        }
                    }
                    None => break,
                }
            } else {
                // Short sleep for debounce checking
                sleep(Duration::from_millis(5)).await;
            }
        }
    });

    Ok(())
}

fn emit_change(state: &AppState, path: &Path) {
    let path_str = path.to_string_lossy();

    if state.dev_mode {
        eprintln!("[watcher] change: {}", path_str);
    }

    if path_str.ends_with("history.jsonl") {
        if state.dev_mode {
            eprintln!("[watcher] history.jsonl changed, invalidating cache");
        }
        state.invalidate_history_cache();
        let _ = state.history_tx.send(());
    } else if path_str.ends_with(".jsonl") && !path_str.contains("/subagents/") {
        if let Some(stem) = path.file_stem() {
            let session_id = stem.to_string_lossy().to_string();
            let file_path = path.to_string_lossy().to_string();
            if state.dev_mode {
                eprintln!("[watcher] session file: {}", session_id);
            }
            state
                .file_index
                .insert(session_id.clone(), file_path.clone());
            let _ = state.session_tx.send((session_id, file_path));
        }
    }
}
