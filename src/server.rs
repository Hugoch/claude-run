use std::collections::HashMap;
use std::convert::Infallible;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::http::StatusCode;
use axum::{
    extract::{Path, Query, State},
    http::Method,
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Json,
    },
    routing::{delete, get, post},
    Router,
};
use tokio::io::AsyncReadExt;
use tokio_stream::Stream;
use tower_http::cors::{AllowOrigin, CorsLayer};

use crate::embedded::serve_embedded;
use crate::models::*;
use crate::push;
use crate::state::AppState;
use crate::storage;

/// Build a `zellij` Command with optional `--session` argument.
fn zellij_cmd(session: Option<&str>) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new("zellij");
    if let Some(s) = session {
        cmd.args(["--session", s]);
    }
    cmd
}

/// Ensure a Zellij session exists, creating it via Python PTY if needed.
async fn ensure_zellij_session(name: &str) -> Result<(), String> {
    // Check if session already exists
    if let Ok(output) = tokio::process::Command::new("zellij")
        .args(["list-sessions", "-s"])
        .output()
        .await
    {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if stdout.lines().any(|l| l.trim() == name) {
                return Ok(());
            }
        }
    }

    eprintln!("[zellij] session '{}' not found, creating...", name);
    let py_script = format!(
        "import pty,os,subprocess;fd=pty.openpty()[1];subprocess.Popen(['zellij','--session','{}'],stdin=fd,stdout=fd,stderr=fd);os.close(fd)",
        name.replace('\'', "")
    );
    tokio::process::Command::new("python3")
        .args(["-c", &py_script])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
        .await
        .map_err(|e| format!("Failed to spawn: {}", e))?;

    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

    // Verify
    let output = tokio::process::Command::new("zellij")
        .args(["list-sessions", "-s"])
        .output()
        .await
        .map_err(|e| format!("Failed to list sessions: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    if stdout.lines().any(|l| l.trim() == name) {
        eprintln!("[zellij] session '{}' created", name);
        Ok(())
    } else {
        Err("Session was not created".to_string())
    }
}

fn build_permission_message(
    tool_name: Option<&str>,
    tool_input: Option<&serde_json::Value>,
) -> String {
    let name = tool_name.unwrap_or("Unknown");
    let detail = tool_input.and_then(|input| {
        input
            .get("command")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or_else(|| {
                input
                    .get("file_path")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
            })
            .or_else(|| {
                let pattern = input.get("pattern").and_then(|v| v.as_str())?;
                let path = input.get("path").and_then(|v| v.as_str());
                Some(match path {
                    Some(p) => format!("{}/{}", p, pattern),
                    None => pattern.to_string(),
                })
            })
            .or_else(|| {
                input
                    .get("url")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
            })
    });
    match detail {
        Some(d) => {
            let truncated = if d.len() > 80 { &d[..80] } else { &d };
            format!("{}: {}", name, truncated)
        }
        None => name.to_string(),
    }
}

pub fn create_router(state: Arc<AppState>) -> Router {
    let api = Router::new()
        .route("/api/sessions", get(get_sessions))
        .route("/api/sessions/:id", delete(delete_session))
        .route("/api/sessions/:id/tags", post(set_session_tags))
        .route("/api/tags", get(get_all_tags))
        .route("/api/sessions/:id/status", post(set_status))
        .route("/api/sessions/:id/send", post(send_message))
        .route("/api/sessions/:id/keys", post(send_keys))
        .route("/api/sessions/:id/answer", post(answer_question))
        .route("/api/sessions/stream", get(sessions_stream))
        .route("/api/projects", get(get_projects))
        .route("/api/search", post(search))
        .route("/api/conversation/:id", get(get_conversation))
        .route("/api/conversation/:id/stream", get(conversation_stream))
        .route("/api/conversation/:id/tail", get(conversation_tail))
        .route("/api/conversation/:id/older", get(conversation_older))
        .route("/api/conversation/:id/subagents", get(get_subagents))
        .route(
            "/api/conversation/:id/subagent/:agent_id",
            get(get_subagent_conversation),
        )
        .route(
            "/api/conversation/:id/plan-sessions",
            get(get_plan_sessions),
        )
        .route("/api/usage", get(get_usage))
        .route("/api/launch", post(launch_agent))
        .route("/api/models", get(get_models))
        .route("/api/sessions/:id/resurrect", post(resurrect_session))
        .route("/api/sessions/:id/kill", post(kill_session))
        .route(
            "/api/zellij/sessions",
            get(get_zellij_sessions).post(create_zellij_session),
        )
        .route("/api/zellij/tabs", get(get_zellij_tabs))
        .route("/api/tail", get(tail_file))
        .route("/api/tasks/:id/alive", get(check_task_alive))
        .route("/api/ping", get(ping))
        .route("/api/push/vapid-key", get(get_vapid_key))
        .route("/api/push/subscribe", post(subscribe_push))
        .route("/api/open-url", post(open_url))
        .route("/api/git/pr", get(get_git_pr))
        .route("/api/tts", post(crate::tts::tts_handler))
        .route("/api/file", get(get_file))
        .route("/api/image", get(get_image))
        .route("/api/files", get(get_files))
        .route("/api/git/diff", get(get_git_diff))
        .route("/api/git/changed-files", get(get_git_changed_files))
        .route("/api/client-error", post(client_error));

    let mut router = api;

    if state.dev_mode {
        let cors = CorsLayer::new()
            .allow_origin(AllowOrigin::exact(
                "http://localhost:12000".parse().unwrap(),
            ))
            .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::OPTIONS])
            .allow_headers([axum::http::header::CONTENT_TYPE]);
        router = router.layer(cors);
    }

    // SPA fallback for non-API routes
    router = router.fallback(serve_embedded);

    router.with_state(state)
}

// --- REST Handlers ---

async fn get_sessions(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let sessions = storage::get_sessions(&state).await;
    Json(sessions)
}

async fn get_projects(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let projects = storage::get_projects(&state).await;
    Json(projects)
}

async fn get_conversation(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let messages = storage::get_conversation(&state, &id).await;
    Json(messages)
}

async fn get_subagents(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let infos = storage::get_subagent_map(&state, &id).await;
    Json(infos)
}

async fn get_subagent_conversation(
    State(state): State<Arc<AppState>>,
    Path((id, agent_id)): Path<(String, String)>,
) -> impl IntoResponse {
    let messages = storage::get_subagent_conversation(&state, &id, &agent_id).await;
    Json(messages)
}

async fn get_plan_sessions(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let infos = storage::get_plan_session_map(&state, &id).await;
    Json(infos)
}

async fn delete_session(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let deleted = storage::delete_session(&state, &id).await;
    if deleted {
        Json(serde_json::json!({ "success": true }))
    } else {
        Json(serde_json::json!({ "error": "Session not found" }))
    }
}

#[derive(Deserialize)]
struct SetTagsRequest {
    tags: Vec<String>,
}

async fn set_session_tags(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(body): Json<SetTagsRequest>,
) -> impl IntoResponse {
    let tags = crate::tags::set_tags(&state, &id, body.tags).await;
    Json(serde_json::json!({ "tags": tags }))
}

async fn get_all_tags(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let tags = crate::tags::all_tags(&state);
    Json(serde_json::json!({ "tags": tags }))
}

async fn set_status(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(body): Json<StatusUpdateRequest>,
) -> impl IntoResponse {
    let status: SessionStatus = match body.event.as_str() {
        "SessionStart" => Some(SessionStatusValue::Active),
        "UserPromptSubmit" => Some(SessionStatusValue::Responding),
        "Notification" => {
            if body.notification_type.as_deref() == Some("permission_prompt") {
                Some(SessionStatusValue::Permission)
            } else {
                Some(SessionStatusValue::Notification)
            }
        }
        "PermissionRequest" => {
            let msg = build_permission_message(body.tool_name.as_deref(), body.tool_input.as_ref());
            state.permission_messages.insert(id.clone(), msg);
            // Store question data for AskUserQuestion or ExitPlanMode
            if body.tool_name.as_deref() == Some("AskUserQuestion") {
                if let Some(input) = &body.tool_input {
                    if let Some(questions) = input.get("questions") {
                        state.question_data.insert(id.clone(), questions.clone());
                    }
                }
            } else if body.tool_name.as_deref() == Some("ExitPlanMode") {
                let plan_options = serde_json::json!([{
                    "question": "Approve this plan?",
                    "header": "Plan",
                    "options": [
                        {"label": "Yes + clear ctx + bypass", "description": "Clear context and bypass all permissions"},
                        {"label": "Yes + bypass", "description": "Keep context, bypass permissions"},
                        {"label": "Yes, manual", "description": "Keep context, manually approve edits"}
                    ],
                    "multiSelect": false
                }]);
                state.question_data.insert(id.clone(), plan_options);
            } else {
                state.question_data.remove(&id);
            }
            Some(SessionStatusValue::Permission)
        }
        "PreCompact" => Some(SessionStatusValue::Compacting),
        "PreToolUse" | "PostToolUse" => Some(SessionStatusValue::Responding),
        "Stop" => Some(SessionStatusValue::Active),
        "SessionEnd" => None,
        _ => {
            // Unknown event — ignore, don't change status
            return Json(serde_json::json!({ "ok": true }));
        }
    };

    // Clear permission message + question data when transitioning away from permission
    if status != Some(SessionStatusValue::Permission)
        && state.get_session_status(&id) == Some(SessionStatusValue::Permission)
    {
        state.permission_messages.remove(&id);
        state.question_data.remove(&id);
    }

    // Trigger push notification for attention-requiring events
    // Skip if: mobile viewer connected (user is on phone app)
    //          OR desktop viewer connected + Mac active (user is at laptop)
    if matches!(
        status,
        Some(SessionStatusValue::Permission) | Some(SessionStatusValue::Notification)
    ) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let last_mobile = state
            .last_mobile_ping
            .load(std::sync::atomic::Ordering::Relaxed);
        let last_desktop = state
            .last_desktop_ping
            .load(std::sync::atomic::Ordering::Relaxed);
        let mobile_active = last_mobile > 0 && now.saturating_sub(last_mobile) < 30;
        let desktop_active = last_desktop > 0 && now.saturating_sub(last_desktop) < 30;
        eprintln!("[push] mobile_active={mobile_active} ({}s ago) desktop_active={desktop_active} ({}s ago)",
            now.saturating_sub(last_mobile), now.saturating_sub(last_desktop));

        // Mobile recently active → user is looking at the phone app, skip
        if mobile_active {
            eprintln!("[push] skipping: mobile recently active");
        } else {
            let state_clone = state.clone();
            let id_clone = id.clone();
            let is_permission = status == Some(SessionStatusValue::Permission);
            let perm_msg = state.permission_messages.get(&id).map(|v| v.clone());
            let display = state
                .summary_cache
                .get(&id)
                .map(|entry| entry.value().0.clone());
            let project_name = state.file_index.get(&id).and_then(|entry| {
                let path = std::path::Path::new(entry.value());
                let dir_name = path.parent()?.file_name()?.to_str()?;
                let decoded = storage::decode_project_path(dir_name);
                Some(storage::get_project_name(&decoded))
            });
            tokio::spawn(async move {
                // Desktop dashboard open → user is looking at it, skip
                if desktop_active {
                    eprintln!("[push] skipping: desktop recently active");
                    return;
                }

                // No client connected — check Mac idle time via ioreg
                if let Ok(output) = tokio::process::Command::new("ioreg")
                    .args(["-c", "IOHIDSystem"])
                    .output()
                    .await
                {
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    let idle_secs = stdout
                        .lines()
                        .find(|l| l.contains("HIDIdleTime"))
                        .and_then(|l| l.split_whitespace().last())
                        .and_then(|v| v.parse::<u64>().ok())
                        .map(|ns| ns / 1_000_000_000)
                        .unwrap_or(0);
                    eprintln!("[push] idle_secs={idle_secs}");
                    if idle_secs < 60 {
                        eprintln!("[push] skipping: mac not idle");
                        return;
                    }
                }

                let project = project_name.unwrap_or_default();
                let body_text = if is_permission {
                    perm_msg.unwrap_or_else(|| "Permission required".into())
                } else {
                    display.as_deref().unwrap_or("Needs attention").to_string()
                };
                let title = if project.is_empty() {
                    display.unwrap_or_else(|| id_clone.clone())
                } else {
                    format!("[{}] {}", project, display.as_deref().unwrap_or(&id_clone))
                };
                eprintln!("[push] sending: title={title} body={body_text}");
                push::send_notification(&state_clone, &title, &body_text, &id_clone, &project)
                    .await;
            });
        }
    }

    if status.is_none() {
        let pane_map_path = format!("{}/pane-map/{}", state.claude_dir, id);
        let _ = tokio::fs::remove_file(&pane_map_path).await;
    }
    state.set_session_status(&id, status.clone(), body.pane_id, body.zellij_session);

    if status.is_some() {
        if let Some((pane_id, zs, _)) = state.get_session_pane(&id) {
            let display = state
                .summary_cache
                .get(&id)
                .map(|entry| entry.value().0.clone());
            if let Some(name) = display {
                tokio::spawn(async move {
                    rename_zellij_tab(&pane_id, zs.as_deref(), &name).await;
                });
            }
        }
    }

    Json(serde_json::json!({ "ok": true }))
}

async fn send_message(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(body): Json<SendMessageRequest>,
) -> impl IntoResponse {
    let (pane_id, zs) = match state.get_session_pane(&id) {
        Some((p, zs, _)) => (p, zs),
        None => return Json(serde_json::json!({ "error": "No pane ID for this session" })),
    };

    let result = zellij_cmd(zs.as_deref())
        .args([
            "action",
            "write-chars",
            "--pane-id",
            &pane_id,
            &body.message,
        ])
        .output()
        .await;

    if let Err(e) = result {
        return Json(serde_json::json!({ "error": format!("Failed to write chars: {}", e) }));
    }

    // Send Enter key (carriage return = byte 13)
    let result = zellij_cmd(zs.as_deref())
        .args(["action", "write", "--pane-id", &pane_id, "13"])
        .output()
        .await;

    if let Err(e) = result {
        return Json(serde_json::json!({ "error": format!("Failed to send enter: {}", e) }));
    }

    Json(serde_json::json!({ "ok": true }))
}

async fn send_keys(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(body): Json<SendKeysRequest>,
) -> impl IntoResponse {
    let (pane_id, zs) = match state.get_session_pane(&id) {
        Some((p, zs, _)) => (p, zs),
        None => return Json(serde_json::json!({ "error": "No pane ID for this session" })),
    };

    for key_seq in &body.keys {
        let args: Vec<String> = std::iter::once("action".to_string())
            .chain(std::iter::once("write".to_string()))
            .chain(std::iter::once("--pane-id".to_string()))
            .chain(std::iter::once(pane_id.clone()))
            .chain(key_seq.iter().map(|b| b.to_string()))
            .collect();

        let result = zellij_cmd(zs.as_deref()).args(&args).output().await;

        if let Err(e) = result {
            return Json(serde_json::json!({ "error": format!("Failed to send keys: {}", e) }));
        }
    }

    Json(serde_json::json!({ "ok": true }))
}

async fn answer_question(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(body): Json<AnswerQuestionRequest>,
) -> impl IntoResponse {
    let (pane_id, zs) = match state.get_session_pane(&id) {
        Some((p, zs, _)) => (p, zs),
        None => return Json(serde_json::json!({ "error": "No pane ID for this session" })),
    };

    let question_data = state.question_data.get(&id).map(|v| v.clone());
    let questions = match &question_data {
        Some(v) => v.as_array(),
        None => None,
    };

    let delay = std::time::Duration::from_millis(50);

    if let Some(option_index) = body.option_index {
        // Select a predefined option: Arrow Down × optionIndex, then Enter
        for _ in 0..option_index {
            if let Err(e) = zellij_cmd(zs.as_deref())
                .args(["action", "write", "--pane-id", &pane_id, "27", "91", "66"])
                .output()
                .await
            {
                return Json(serde_json::json!({ "error": format!("Failed to send keys: {}", e) }));
            }
            tokio::time::sleep(delay).await;
        }
        if let Err(e) = zellij_cmd(zs.as_deref())
            .args(["action", "write", "--pane-id", &pane_id, "13"])
            .output()
            .await
        {
            return Json(serde_json::json!({ "error": format!("Failed to send enter: {}", e) }));
        }
    } else if let Some(text) = &body.text {
        // Free text: Arrow Down × number of options to reach "Type something.", then type
        let option_count = questions
            .and_then(|q| q.first())
            .and_then(|q| q.get("options"))
            .and_then(|o| o.as_array())
            .map(|a| a.len())
            .unwrap_or(1);
        for _ in 0..option_count {
            if let Err(e) = zellij_cmd(zs.as_deref())
                .args(["action", "write", "--pane-id", &pane_id, "27", "91", "66"])
                .output()
                .await
            {
                return Json(serde_json::json!({ "error": format!("Failed to send keys: {}", e) }));
            }
            tokio::time::sleep(delay).await;
        }
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;

        // Type the text
        if let Err(e) = zellij_cmd(zs.as_deref())
            .args(["action", "write-chars", "--pane-id", &pane_id, text])
            .output()
            .await
        {
            return Json(serde_json::json!({ "error": format!("Failed to write chars: {}", e) }));
        }
        // Press Enter
        if let Err(e) = zellij_cmd(zs.as_deref())
            .args(["action", "write", "--pane-id", &pane_id, "13"])
            .output()
            .await
        {
            return Json(serde_json::json!({ "error": format!("Failed to send enter: {}", e) }));
        }
    } else {
        return Json(serde_json::json!({ "error": "Either optionIndex or text is required" }));
    }

    // Clear question/permission data before transitioning away from permission
    state.question_data.remove(&id);
    state.permission_messages.remove(&id);
    state.set_session_status(&id, Some(SessionStatusValue::Responding), None, None);

    Json(serde_json::json!({ "ok": true }))
}

async fn search(
    State(state): State<Arc<AppState>>,
    Json(body): Json<SearchRequest>,
) -> impl IntoResponse {
    let query = body.query.trim().to_string();
    if query.is_empty() {
        return Json(serde_json::json!({ "results": [] }));
    }
    let results = storage::search_conversations(&state.clone(), &query).await;
    Json(serde_json::json!({ "results": results }))
}

async fn get_usage(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    const CACHE_TTL: Duration = Duration::from_secs(60);

    // Check cache
    {
        let cache = state.usage_cache.lock().await;
        if let Some((fetched_at, ref resp)) = *cache {
            if fetched_at.elapsed() < CACHE_TTL {
                return Json(serde_json::to_value(resp).unwrap());
            }
        }
    }

    // Read OAuth token from macOS Keychain
    let token = match tokio::process::Command::new("security")
        .args([
            "find-generic-password",
            "-s",
            "Claude Code-credentials",
            "-w",
        ])
        .output()
        .await
    {
        Ok(output) if output.status.success() => {
            let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
            // The keychain value is JSON: extract claudeAiOauth.accessToken
            match serde_json::from_str::<serde_json::Value>(&raw) {
                Ok(v) => v["claudeAiOauth"]["accessToken"]
                    .as_str()
                    .unwrap_or("")
                    .to_string(),
                Err(_) => raw,
            }
        }
        _ => {
            return Json(
                serde_json::json!({ "error": "Failed to read OAuth token from Keychain" }),
            );
        }
    };

    if token.is_empty() {
        return Json(serde_json::json!({ "error": "No OAuth token found" }));
    }

    // Call Anthropic usage API
    let client = reqwest::Client::new();
    let resp = match client
        .get("https://api.anthropic.com/api/oauth/usage")
        .bearer_auth(&token)
        .header("anthropic-beta", "oauth-2025-04-20")
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return Json(serde_json::json!({ "error": format!("API request failed: {}", e) }));
        }
    };

    let body = match resp.json::<serde_json::Value>().await {
        Ok(b) => b,
        Err(e) => {
            return Json(
                serde_json::json!({ "error": format!("Failed to parse response: {}", e) }),
            );
        }
    };

    // API returns five_hour.utilization / seven_day.utilization (already percentages)
    let five_hour_pct = body
        .pointer("/five_hour/utilization")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0)
        .round();
    let seven_day_pct = body
        .pointer("/seven_day/utilization")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0)
        .round();
    let resets_at = body
        .pointer("/five_hour/resets_at")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let seven_day_resets_at = body
        .pointer("/seven_day/resets_at")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let extra_usage_cents = body
        .pointer("/extra_usage/used_credits")
        .and_then(|v| v.as_f64());

    let usage = UsageResponse {
        five_hour_pct,
        seven_day_pct,
        resets_at,
        seven_day_resets_at,
        extra_usage_cents,
    };

    // Update cache
    {
        let mut cache = state.usage_cache.lock().await;
        *cache = Some((Instant::now(), usage.clone()));
    }

    Json(serde_json::to_value(&usage).unwrap())
}

async fn open_url(
    State(state): State<Arc<AppState>>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    let url = body.get("url").and_then(|v| v.as_str()).unwrap_or_default();
    if url.is_empty() {
        return StatusCode::BAD_REQUEST;
    }
    // Try SSE broadcast first
    let sse_ok = state.url_tx.send(url.to_string()).is_ok();

    // Also send push notification (works even if SSE is disconnected)
    let state2 = state.clone();
    let url2 = url.to_string();
    tokio::spawn(async move {
        push::send_url_notification(&state2, &url2).await;
    });

    let _ = sse_ok;
    StatusCode::OK
}

pub async fn rename_zellij_tab(
    pane_id: &str,
    zellij_session: Option<&str>,
    name: &str,
) {
    let panes_output = match zellij_cmd(zellij_session)
        .args(["action", "list-panes", "--json", "--tab"])
        .output()
        .await
    {
        Ok(o) if o.status.success() => o,
        _ => return,
    };

    let panes: Vec<serde_json::Value> =
        match serde_json::from_slice(&panes_output.stdout) {
            Ok(v) => v,
            Err(_) => return,
        };

    let pane_id_num: u64 = match pane_id.parse() {
        Ok(n) => n,
        Err(_) => return,
    };

    let tab_id = match panes
        .iter()
        .find(|p| p.get("id").and_then(|v| v.as_u64()) == Some(pane_id_num))
        .and_then(|p| p.get("tab_id").and_then(|v| v.as_u64()))
    {
        Some(id) => id,
        None => return,
    };

    // Only rename if this pane is the sole selectable pane in its tab
    let tab_pane_count = panes
        .iter()
        .filter(|p| {
            p.get("tab_id").and_then(|v| v.as_u64()) == Some(tab_id)
                && p.get("is_selectable").and_then(|v| v.as_bool()).unwrap_or(false)
        })
        .count();
    if tab_pane_count > 1 {
        return;
    }

    let truncated: String = name.chars().take(60).collect();
    let _ = zellij_cmd(zellij_session)
        .args(["action", "rename-tab-by-id", &tab_id.to_string(), &truncated])
        .output()
        .await;
}

fn get_anthropic_api_key() -> Option<String> {
    // Try macOS keychain first (where Claude Code stores OAuth credentials)
    if let Ok(output) = std::process::Command::new("security")
        .args(["find-generic-password", "-s", "Claude Code-credentials", "-w"])
        .output()
    {
        if output.status.success() {
            if let Ok(json_str) = String::from_utf8(output.stdout) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(json_str.trim()) {
                    if let Some(token) = json
                        .get("claudeAiOauth")
                        .and_then(|o| o.get("accessToken"))
                        .and_then(|t| t.as_str())
                    {
                        return Some(token.to_string());
                    }
                }
            }
        }
    }
    // Fallback to env var
    std::env::var("ANTHROPIC_API_KEY").ok()
}

async fn get_models() -> impl IntoResponse {
    let api_key = match get_anthropic_api_key() {
        Some(key) => key,
        None => {
            return Json(
                serde_json::json!({ "error": "No API key found in keychain or ANTHROPIC_API_KEY" }),
            )
        }
    };

    let client = reqwest::Client::new();
    let mut models = Vec::new();
    let mut after_id: Option<String> = None;

    loop {
        let mut request = client
            .get("https://api.anthropic.com/v1/models")
            .header("x-api-key", &api_key)
            .header("anthropic-version", "2023-06-01")
            .query(&[("limit", "100")]);

        if let Some(ref cursor) = after_id {
            request = request.query(&[("after_id", cursor.as_str())]);
        }

        match request.send().await {
            Ok(resp) if resp.status().is_success() => match resp.json::<serde_json::Value>().await
            {
                Ok(body) => {
                    if let Some(data) = body.get("data").and_then(|d| d.as_array()) {
                        models.extend(data.clone());
                    }
                    if body.get("has_more").and_then(|h| h.as_bool()) == Some(true) {
                        after_id = body
                            .get("last_id")
                            .and_then(|id| id.as_str())
                            .map(|s| s.to_string());
                    } else {
                        break;
                    }
                }
                Err(err) => {
                    return Json(serde_json::json!({ "error": format!("Failed to parse response: {}", err) }))
                }
            },
            Ok(resp) => {
                let status = resp.status().as_u16();
                let text = resp.text().await.unwrap_or_default();
                return Json(
                    serde_json::json!({ "error": format!("API returned {}: {}", status, text) }),
                );
            }
            Err(err) => {
                return Json(serde_json::json!({ "error": format!("Request failed: {}", err) }))
            }
        }
    }

    Json(serde_json::json!({ "models": models }))
}

async fn run_in_zellij(
    zellij_session: Option<&str>,
    target_tab_id: Option<u64>,
    cwd: Option<&str>,
    shell_cmd: &str,
    label: &str,
) -> Json<serde_json::Value> {
    if let Some(tab_id) = target_tab_id {
        // Focus the target tab, then create a pane inside it
        let _ = zellij_cmd(zellij_session)
            .args(["action", "go-to-tab-by-id", &tab_id.to_string()])
            .output()
            .await;

        let mut args = vec!["action".to_string(), "new-pane".to_string()];
        if let Some(dir) = cwd {
            args.extend(["--cwd".to_string(), dir.to_string()]);
        }
        args.extend(["--".to_string(), "sh".to_string(), "-c".to_string(), shell_cmd.to_string()]);

        eprintln!("[{}] running pane in tab {}: zellij {:?}", label, tab_id, args);
        match zellij_cmd(zellij_session).args(&args).output().await {
            Ok(output) if output.status.success() => {
                eprintln!("[{}] success", label);
                Json(serde_json::json!({ "ok": true }))
            }
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                eprintln!("[{}] zellij failed: {}", label, stderr);
                Json(serde_json::json!({ "error": stderr }))
            }
            Err(err) => {
                eprintln!("[{}] spawn error: {}", label, err);
                Json(serde_json::json!({ "error": format!("{}", err) }))
            }
        }
    } else {
        // Create a new tab
        let mut args = vec!["action".to_string(), "new-tab".to_string()];
        if let Some(dir) = cwd {
            args.extend(["--cwd".to_string(), dir.to_string()]);
        }
        args.extend(["--".to_string(), "sh".to_string(), "-c".to_string(), shell_cmd.to_string()]);

        eprintln!("[{}] running new tab: zellij {:?}", label, args);
        match zellij_cmd(zellij_session).args(&args).output().await {
            Ok(output) if output.status.success() => {
                eprintln!("[{}] success", label);
                Json(serde_json::json!({ "ok": true }))
            }
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                eprintln!("[{}] zellij failed: {}", label, stderr);
                Json(serde_json::json!({ "error": stderr }))
            }
            Err(err) => {
                eprintln!("[{}] spawn error: {}", label, err);
                Json(serde_json::json!({ "error": format!("{}", err) }))
            }
        }
    }
}

async fn launch_agent(Json(body): Json<LaunchRequest>) -> impl IntoResponse {
    eprintln!(
        "[launch] project={:?} zellij_session={:?} skip={:?} target_tab={:?}",
        body.project, body.zellij_session, body.dangerously_skip_permissions, body.target_tab_id
    );

    // Ensure the Zellij session exists (create if needed)
    if let Some(ref session_name) = body.zellij_session {
        eprintln!(
            "[launch] ensuring zellij session '{}' exists...",
            session_name
        );
        if let Err(e) = ensure_zellij_session(session_name).await {
            eprintln!("[launch] ensure_zellij_session failed: {}", e);
            return Json(serde_json::json!({ "error": e }));
        }
        eprintln!("[launch] zellij session ready");
    } else {
        eprintln!("[launch] WARNING: no zellij_session provided");
    }

    let prompt = body
        .prompt
        .as_deref()
        .unwrap_or("** Session started from claude-run ** don't answer to this message");
    let escaped_prompt = prompt.replace('\'', "'\\''");
    let model_flag = body
        .model
        .as_deref()
        .filter(|m| !m.is_empty())
        .map(|m| format!(" --model {}", m))
        .unwrap_or_default();
    let cmd = if body.dangerously_skip_permissions.unwrap_or(false) {
        format!(
            "$SHELL -c 'claude{} --dangerously-skip-permissions \"{}\"'",
            model_flag, escaped_prompt
        )
    } else {
        format!("$SHELL -c 'claude{} \"{}\"'", model_flag, escaped_prompt)
    };

    run_in_zellij(
        body.zellij_session.as_deref(),
        body.target_tab_id,
        body.project.as_deref(),
        &cmd,
        "launch",
    )
    .await
}

async fn resurrect_session(
    Path(id): Path<String>,
    Json(body): Json<ResurrectRequest>,
) -> impl IntoResponse {
    eprintln!(
        "[resurrect] session={} project={} zellij_session={:?} skip={:?} target_tab={:?}",
        id, body.project, body.zellij_session, body.dangerously_skip_permissions, body.target_tab_id
    );

    // Ensure the Zellij session exists (create if needed)
    if let Some(ref session_name) = body.zellij_session {
        eprintln!(
            "[resurrect] ensuring zellij session '{}' exists...",
            session_name
        );
        if let Err(e) = ensure_zellij_session(session_name).await {
            eprintln!("[resurrect] ensure_zellij_session failed: {}", e);
            return Json(serde_json::json!({ "error": e }));
        }
        eprintln!("[resurrect] zellij session ready");
    } else {
        eprintln!("[resurrect] WARNING: no zellij_session provided");
    }

    let cmd = if body.dangerously_skip_permissions.unwrap_or(false) {
        format!(
            "$SHELL -c 'claude --resume {} --dangerously-skip-permissions'",
            id
        )
    } else {
        format!("$SHELL -c 'claude --resume {}'", id)
    };

    run_in_zellij(
        body.zellij_session.as_deref(),
        body.target_tab_id,
        Some(&body.project),
        &cmd,
        "resurrect",
    )
    .await
}

async fn kill_session(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let (pane_id, zs) = match state.get_session_pane(&id) {
        Some((p, zs, _)) => (p, zs),
        None => return Json(serde_json::json!({ "error": "No pane ID for this session" })),
    };

    // Send /exit + Enter to gracefully quit claude
    let _ = zellij_cmd(zs.as_deref())
        .args(["action", "write-chars", "--pane-id", &pane_id, "/exit"])
        .output()
        .await;
    let _ = zellij_cmd(zs.as_deref())
        .args(["action", "write", "--pane-id", &pane_id, "13"])
        .output()
        .await;

    state.set_session_status(&id, None, None, None);
    state.session_panes.remove(&id);

    // Send Ctrl+C then close the pane after a short delay
    let pane_id_owned = pane_id.clone();
    let zs_owned = zs.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        let _ = zellij_cmd(zs_owned.as_deref())
            .args(["action", "write", "--pane-id", &pane_id_owned, "3"])
            .output()
            .await;
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        let _ = zellij_cmd(zs_owned.as_deref())
            .args(["action", "close-pane", "--pane-id", &pane_id_owned])
            .output()
            .await;
    });

    Json(serde_json::json!({ "ok": true }))
}

async fn get_zellij_sessions() -> impl IntoResponse {
    match tokio::process::Command::new("zellij")
        .args(["list-sessions", "-s"])
        .output()
        .await
    {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let sessions: Vec<&str> = stdout
                .lines()
                .map(|l| l.trim())
                .filter(|l| !l.is_empty())
                .collect();
            Json(serde_json::json!({ "sessions": sessions }))
        }
        _ => Json(serde_json::json!({ "sessions": [] })),
    }
}

async fn get_zellij_tabs(Query(params): Query<HashMap<String, String>>) -> impl IntoResponse {
    let session = params.get("session");
    match zellij_cmd(session.map(|s| s.as_str()))
        .args(["action", "list-tabs", "--json"])
        .output()
        .await
    {
        Ok(output) if output.status.success() => {
            match serde_json::from_slice::<serde_json::Value>(&output.stdout) {
                Ok(tabs) => Json(serde_json::json!({ "tabs": tabs })),
                Err(_) => Json(serde_json::json!({ "tabs": [] })),
            }
        }
        _ => Json(serde_json::json!({ "tabs": [] })),
    }
}

async fn create_zellij_session(Json(body): Json<serde_json::Value>) -> impl IntoResponse {
    let name = body["name"].as_str().unwrap_or("main");
    match ensure_zellij_session(name).await {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(e) => Json(serde_json::json!({ "error": e })),
    }
}

// --- Git PR Resolution ---

#[derive(Deserialize)]
struct GitPrQuery {
    project: String,
    branch: String,
}

async fn get_git_pr(
    State(state): State<Arc<AppState>>,
    Query(query): Query<GitPrQuery>,
) -> impl IntoResponse {
    let key = (query.project.clone(), query.branch.clone());

    // Check cache
    if let Some(cached) = state.pr_cache.get(&key) {
        return match cached.value() {
            Some((url, number)) => Json(serde_json::json!({ "url": url, "number": number })),
            None => Json(serde_json::json!({ "url": null, "number": null })),
        };
    }

    // Run gh pr list (try open first, then closed/merged)
    let mut pr_info: Option<(String, u64)> = None;
    for state_filter in &["open", "merged", "closed"] {
        let output = tokio::process::Command::new("gh")
            .args([
                "pr",
                "list",
                "--head",
                &query.branch,
                "--state",
                state_filter,
                "--json",
                "url,number",
                "--limit",
                "1",
            ])
            .current_dir(&query.project)
            .output()
            .await;

        if let Ok(o) = output {
            if o.status.success() {
                let stdout = String::from_utf8_lossy(&o.stdout);
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&stdout) {
                    if let Some(first) = val.as_array().and_then(|a| a.first()) {
                        let url = first
                            .get("url")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());
                        let number = first.get("number").and_then(|v| v.as_u64());
                        if let (Some(u), Some(n)) = (url, number) {
                            pr_info = Some((u, n));
                            break;
                        }
                    }
                }
            }
        }
    }

    state.pr_cache.insert(key, pr_info.clone());
    match pr_info {
        Some((url, number)) => Json(serde_json::json!({ "url": url, "number": number })),
        None => Json(serde_json::json!({ "url": null, "number": null })),
    }
}

// --- Push Notification Handlers ---

async fn get_vapid_key(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    Json(serde_json::json!({ "publicKey": state.vapid_public_base64 }))
}

async fn subscribe_push(
    State(state): State<Arc<AppState>>,
    Json(body): Json<PushSubscription>,
) -> impl IntoResponse {
    state.push_subscriptions.insert(body.endpoint.clone(), body);
    push::save_subscriptions(&state.claude_dir, &state.push_subscriptions);
    Json(serde_json::json!({ "ok": true }))
}

// --- Ping Handler ---

fn is_mobile_ua(ua: &str) -> bool {
    ua.contains("iPhone") || ua.contains("iPad") || ua.contains("Android") || ua.contains("Mobile")
}

async fn ping(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let ua = headers
        .get("user-agent")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if is_mobile_ua(ua) {
        state
            .last_mobile_ping
            .store(now, std::sync::atomic::Ordering::Relaxed);
    } else {
        state
            .last_desktop_ping
            .store(now, std::sync::atomic::Ordering::Relaxed);
    }
    Json(serde_json::json!({ "ok": true }))
}

// --- Background Task Alive Check ---

async fn check_task_alive(Path(task_id): Path<String>) -> impl IntoResponse {
    // Sanitize: only alphanumeric
    if !task_id.chars().all(|c| c.is_alphanumeric()) {
        return Json(serde_json::json!({ "alive": false }));
    }

    // Get UID from home directory metadata
    use std::os::unix::fs::MetadataExt;
    let uid = std::fs::metadata(std::env::var("HOME").unwrap_or_default())
        .map(|m| m.uid())
        .unwrap_or(501);
    let base = format!("/private/tmp/claude-{}", uid);

    let Ok(mut entries) = tokio::fs::read_dir(&base).await else {
        return Json(serde_json::json!({ "alive": false }));
    };

    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry
            .path()
            .join("tasks")
            .join(format!("{}.output", task_id));
        if let Ok(meta) = tokio::fs::metadata(&path).await {
            let age = meta
                .modified()
                .ok()
                .and_then(|m| m.elapsed().ok())
                .map(|d| d.as_secs())
                .unwrap_or(u64::MAX);
            // If modified within the last 60s, consider alive
            return Json(serde_json::json!({ "alive": age < 60 }));
        }
    }

    // File not found → dead
    Json(serde_json::json!({ "alive": false }))
}

// --- SSE Handlers ---

async fn sessions_stream(
    State(state): State<Arc<AppState>>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let stream = async_stream::stream! {

        let mut known_sessions: HashMap<String, (f64, SessionStatus)> = HashMap::new();
        let mut history_rx = state.history_tx.subscribe();
        let mut session_rx = state.session_tx.subscribe();
        let mut status_rx = state.status_tx.subscribe();
        let mut url_rx = state.url_tx.subscribe();

        // Send initial sessions
        let sessions = storage::get_sessions(&state).await;
        for s in &sessions {
            known_sessions.insert(s.id.clone(), (s.last_activity, s.status.clone()));
        }
        let data = serde_json::to_string(&sessions).unwrap_or_default();
        yield Ok(Event::default().event("sessions").data(data));

        loop {
            tokio::select! {
                _ = history_rx.recv() => {
                    // History changed — push session updates
                    if let Some(updates) = compute_session_updates(&state, &mut known_sessions).await {
                        yield Ok(updates);
                    }
                }
                _ = session_rx.recv() => {
                    // Session file changed — push session updates
                    if let Some(updates) = compute_session_updates(&state, &mut known_sessions).await {
                        yield Ok(updates);
                    }
                }
                Ok((session_id, status)) = status_rx.recv() => {
                    // Status changed — send targeted update
                    if let Some(known) = known_sessions.get_mut(&session_id) {
                        known.1 = status.clone();
                    }
                    let pane = state.get_session_pane(&session_id);
                    let perm_msg = state.permission_messages.get(&session_id).map(|v| v.clone());
                    let q_data = state.question_data.get(&session_id).map(|v| v.clone());
                    let data = serde_json::json!({
                        "id": session_id,
                        "status": status,
                        "paneId": pane.as_ref().map(|(id, _, _)| id),
                        "paneVerified": pane.as_ref().map(|(_, _, v)| v),
                        "permissionMessage": perm_msg,
                        "questionData": q_data,
                    });
                    yield Ok(Event::default().event("statusUpdate").data(data.to_string()));
                }
                Ok(url) = url_rx.recv() => {
                    let data = serde_json::json!({ "url": url });
                    yield Ok(Event::default().event("openUrl").data(data.to_string()));
                }
                _ = tokio::time::sleep(Duration::from_secs(30)) => {
                    let data = serde_json::json!({ "timestamp": chrono_now_ms() });
                    yield Ok(Event::default().event("heartbeat").data(data.to_string()));
                }
            }
        }
    };

    Sse::new(stream).keep_alive(KeepAlive::default())
}

async fn compute_session_updates(
    state: &AppState,
    known_sessions: &mut HashMap<String, (f64, SessionStatus)>,
) -> Option<Event> {
    let sessions = storage::get_sessions(state).await;
    let mut new_or_updated = Vec::new();

    for s in &sessions {
        let dominated = known_sessions
            .get(&s.id)
            .is_none_or(|(la, st)| *la != s.last_activity || *st != s.status);
        if dominated {
            new_or_updated.push(s.clone());
        }
    }

    for s in &sessions {
        known_sessions.insert(s.id.clone(), (s.last_activity, s.status.clone()));
    }

    if new_or_updated.is_empty() {
        if state.dev_mode {
            eprintln!(
                "[sse] compute_session_updates: no changes ({} sessions)",
                sessions.len()
            );
        }
        return None;
    }

    if state.dev_mode {
        let ids: Vec<&str> = new_or_updated.iter().map(|s| s.id.as_str()).collect();
        eprintln!(
            "[sse] sending sessionsUpdate: {} updates {:?}",
            new_or_updated.len(),
            ids
        );
    }
    let data = serde_json::to_string(&new_or_updated).unwrap_or_default();
    Some(Event::default().event("sessionsUpdate").data(data))
}

#[derive(Deserialize)]
struct ConversationStreamQuery {
    offset: Option<u64>,
}

async fn conversation_stream(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(query): Query<ConversationStreamQuery>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let session_id = id;
    let initial_offset = query.offset.unwrap_or(0);

    let stream = async_stream::stream! {
        let mut offset = initial_offset;
        let mut session_rx = state.session_tx.subscribe();

        // Send initial messages
        let result = storage::get_conversation_stream(&state, &session_id, offset).await;
        offset = result.next_offset;

        let data = serde_json::json!({
            "messages": result.messages,
            "offset": result.next_offset,
        });
        yield Ok(Event::default().event("messages").data(data.to_string()));

        loop {
            tokio::select! {
                Ok((changed_id, _)) = session_rx.recv() => {
                    if changed_id != session_id {
                        continue;
                    }
                    let result = storage::get_conversation_stream(&state, &session_id, offset).await;
                    offset = result.next_offset;

                    if !result.messages.is_empty() {
                        let data = serde_json::json!({
                            "messages": result.messages,
                            "offset": result.next_offset,
                        });
                        yield Ok(Event::default().event("messages").data(data.to_string()));
                    }
                }
                _ = tokio::time::sleep(Duration::from_secs(30)) => {
                    let data = serde_json::json!({ "timestamp": chrono_now_ms() });
                    yield Ok(Event::default().event("heartbeat").data(data.to_string()));
                }
            }
        }
    };

    Sse::new(stream).keep_alive(KeepAlive::default())
}

// --- Paginated conversation endpoints ---

#[derive(Deserialize)]
struct ConversationTailQuery {
    limit: Option<usize>,
}

async fn conversation_tail(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(query): Query<ConversationTailQuery>,
) -> impl IntoResponse {
    let limit = query.limit.unwrap_or(50);
    let result = storage::get_conversation_tail(&state, &id, limit).await;
    Json(result)
}

#[derive(Deserialize)]
struct ConversationOlderQuery {
    before: u64,
    limit: Option<usize>,
}

async fn conversation_older(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(query): Query<ConversationOlderQuery>,
) -> impl IntoResponse {
    let limit = query.limit.unwrap_or(50);
    let result = storage::get_conversation_range(&state, &id, query.before, limit).await;
    Json(result)
}

// --- Directory listing ---

async fn get_files(Query(query): Query<FileQuery>) -> Result<Json<serde_json::Value>, StatusCode> {
    let path = PathBuf::from(&query.path);
    let project = PathBuf::from(&query.project);

    let canon_path = path.canonicalize().map_err(|_| StatusCode::NOT_FOUND)?;
    let canon_project = project
        .canonicalize()
        .map_err(|_| StatusCode::BAD_REQUEST)?;

    if !canon_path.starts_with(&canon_project) {
        return Err(StatusCode::FORBIDDEN);
    }

    let mut read_dir = tokio::fs::read_dir(&canon_path)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    let mut dirs = Vec::new();
    let mut files = Vec::new();

    while let Some(entry) = read_dir
        .next_entry()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let meta = entry
            .metadata()
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let is_dir = meta.is_dir();
        let item = serde_json::json!({
            "name": name,
            "is_dir": is_dir,
            "size": if is_dir { None } else { Some(meta.len()) },
        });
        if is_dir {
            dirs.push((name, item));
        } else {
            files.push((name, item));
        }
    }

    dirs.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()));
    files.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()));

    let mut entries: Vec<serde_json::Value> = dirs.into_iter().map(|(_, v)| v).collect();
    entries.extend(files.into_iter().map(|(_, v)| v));

    Ok(Json(serde_json::json!({
        "path": canon_path.to_string_lossy(),
        "entries": entries,
    })))
}

// --- Git diff for file ---

async fn get_git_diff(
    Query(query): Query<FileQuery>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let path = PathBuf::from(&query.path);
    let project = PathBuf::from(&query.project);

    let canon_path = path.canonicalize().map_err(|_| StatusCode::NOT_FOUND)?;
    let canon_project = project
        .canonicalize()
        .map_err(|_| StatusCode::BAD_REQUEST)?;

    if !canon_path.starts_with(&canon_project) {
        return Err(StatusCode::FORBIDDEN);
    }

    let rel_path = canon_path
        .strip_prefix(&canon_project)
        .map_err(|_| StatusCode::BAD_REQUEST)?
        .to_string_lossy()
        .to_string();

    let empty = Ok(Json(
        serde_json::json!({ "added": [], "modified": [], "deleted_after": [] }),
    ));

    // Diff working tree against HEAD (uncommitted changes only)
    let mut diff_text = String::new();
    let output = tokio::process::Command::new("git")
        .args(["diff", "HEAD", "--unified=0", "--", &rel_path])
        .current_dir(&canon_project)
        .output()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if output.status.success() && !output.stdout.is_empty() {
        diff_text = String::from_utf8_lossy(&output.stdout).to_string();
    }

    if diff_text.is_empty() {
        return empty;
    }

    // With --unified=0, each hunk is one change block: all - lines then all + lines
    let mut added: Vec<u32> = Vec::new();
    let mut modified: Vec<u32> = Vec::new();
    let mut deleted_after: Vec<u32> = Vec::new();
    // old_lines: key = line number AFTER which to show old content (0 = before first line)
    let mut old_lines: std::collections::BTreeMap<u32, Vec<String>> =
        std::collections::BTreeMap::new();

    let mut new_start: u32 = 0;
    let mut hunk_dels: u32 = 0;
    let mut hunk_del_lines: Vec<String> = Vec::new();
    let mut hunk_adds: Vec<u32> = Vec::new();

    let flush = |dels: u32,
                 del_lines: &[String],
                 adds: &[u32],
                 ns: u32,
                 out_add: &mut Vec<u32>,
                 out_mod: &mut Vec<u32>,
                 out_del: &mut Vec<u32>,
                 out_old: &mut std::collections::BTreeMap<u32, Vec<String>>| {
        if dels == 0 && adds.is_empty() {
            return;
        }
        let mc = std::cmp::min(dels as usize, adds.len());
        out_mod.extend_from_slice(&adds[..mc]);
        out_add.extend_from_slice(&adds[mc..]);
        if dels as usize > adds.len() {
            let marker = if adds.is_empty() {
                ns.saturating_sub(1)
            } else {
                *adds.last().unwrap()
            };
            out_del.push(marker);
        }
        if !del_lines.is_empty() {
            let after = if adds.is_empty() {
                ns
            } else {
                adds[0].saturating_sub(1)
            };
            out_old
                .entry(after)
                .or_default()
                .extend(del_lines.iter().cloned());
        }
    };

    for line in diff_text.lines() {
        if line.starts_with("@@") {
            flush(
                hunk_dels,
                &hunk_del_lines,
                &hunk_adds,
                new_start,
                &mut added,
                &mut modified,
                &mut deleted_after,
                &mut old_lines,
            );
            hunk_dels = 0;
            hunk_del_lines.clear();
            hunk_adds.clear();
            for part in line.split_whitespace() {
                if let Some(rest) = part.strip_prefix('+') {
                    let num_str: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
                    new_start = num_str.parse().unwrap_or(0);
                    break;
                }
            }
            continue;
        }
        if new_start == 0 || line.starts_with("+++") || line.starts_with("---") {
            continue;
        }

        if line.starts_with('+') {
            hunk_adds.push(new_start + hunk_adds.len() as u32);
        } else if let Some(rest) = line.strip_prefix('-') {
            hunk_dels += 1;
            hunk_del_lines.push(rest.to_string());
        }
    }
    flush(
        hunk_dels,
        &hunk_del_lines,
        &hunk_adds,
        new_start,
        &mut added,
        &mut modified,
        &mut deleted_after,
        &mut old_lines,
    );

    // Convert BTreeMap keys to strings for JSON
    let old_lines_json: serde_json::Map<String, serde_json::Value> = old_lines
        .into_iter()
        .map(|(k, v)| (k.to_string(), serde_json::json!(v)))
        .collect();

    Ok(Json(serde_json::json!({
        "added": added,
        "modified": modified,
        "deleted_after": deleted_after,
        "old_lines": old_lines_json,
    })))
}

// --- Git changed files for directory browser ---

#[derive(Deserialize)]
struct ChangedFilesQuery {
    project: String,
}

async fn get_git_changed_files(
    Query(query): Query<ChangedFilesQuery>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let project = PathBuf::from(&query.project);
    let canon_project = project
        .canonicalize()
        .map_err(|_| StatusCode::BAD_REQUEST)?;

    // Diff working tree against HEAD (uncommitted changes only)
    let mut added = Vec::new();
    let mut modified = Vec::new();
    let mut deleted = Vec::new();

    if let Ok(output) = tokio::process::Command::new("git")
        .args(["diff", "--name-status", "HEAD"])
        .current_dir(&canon_project)
        .output()
        .await
    {
        if output.status.success() {
            parse_name_status(
                &String::from_utf8_lossy(&output.stdout),
                &mut added,
                &mut modified,
                &mut deleted,
            );
        }
    }

    // Untracked files
    if let Ok(output) = tokio::process::Command::new("git")
        .args(["ls-files", "--others", "--exclude-standard"])
        .current_dir(&canon_project)
        .output()
        .await
    {
        if output.status.success() {
            for line in String::from_utf8_lossy(&output.stdout).lines() {
                let f = line.trim().to_string();
                if !f.is_empty() && !added.contains(&f) {
                    added.push(f);
                }
            }
        }
    }

    added.sort();
    added.dedup();
    modified.sort();
    modified.dedup();
    deleted.sort();
    deleted.dedup();

    Ok(Json(serde_json::json!({
        "added": added,
        "modified": modified,
        "deleted": deleted,
    })))
}

fn parse_name_status(
    text: &str,
    added: &mut Vec<String>,
    modified: &mut Vec<String>,
    deleted: &mut Vec<String>,
) {
    for line in text.lines() {
        let parts: Vec<&str> = line.splitn(2, '\t').collect();
        if parts.len() != 2 {
            continue;
        }
        let file = parts[1].trim().to_string();
        match parts[0].chars().next() {
            Some('A') => {
                if !added.contains(&file) {
                    added.push(file);
                }
            }
            Some('M') => {
                if !modified.contains(&file) {
                    modified.push(file);
                }
            }
            Some('D') => {
                if !deleted.contains(&file) {
                    deleted.push(file);
                }
            }
            Some('R') => {
                if !modified.contains(&file) {
                    modified.push(file);
                }
            }
            _ => {}
        }
    }
}

// --- File reader ---

#[derive(Deserialize)]
struct FileQuery {
    path: String,
    project: String,
}

async fn get_file(Query(query): Query<FileQuery>) -> Result<impl IntoResponse, StatusCode> {
    let path = PathBuf::from(&query.path);
    let project = PathBuf::from(&query.project);

    let canon_path = path.canonicalize().map_err(|_| StatusCode::NOT_FOUND)?;
    let canon_project = project
        .canonicalize()
        .map_err(|_| StatusCode::BAD_REQUEST)?;

    if !canon_path.starts_with(&canon_project) {
        return Err(StatusCode::FORBIDDEN);
    }

    let meta = tokio::fs::metadata(&canon_path)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;
    if meta.len() > 1_048_576 {
        return Err(StatusCode::PAYLOAD_TOO_LARGE);
    }

    let mut buf = Vec::with_capacity(meta.len() as usize);
    let mut file = tokio::fs::File::open(&canon_path)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;
    file.read_to_end(&mut buf)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Reject binary files (check for null bytes in first 8KB)
    let check_len = buf.len().min(8192);
    if buf[..check_len].contains(&0) {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }

    let text = String::from_utf8(buf).map_err(|_| StatusCode::UNPROCESSABLE_ENTITY)?;
    Ok((
        [(
            axum::http::header::CONTENT_TYPE,
            "text/plain; charset=utf-8",
        )],
        text,
    ))
}

// --- Image serving ---

#[derive(Deserialize)]
struct ImageQuery {
    path: String,
}

async fn get_image(Query(query): Query<ImageQuery>) -> Result<impl IntoResponse, StatusCode> {
    let path = PathBuf::from(&query.path);
    let canon_path = path.canonicalize().map_err(|_| StatusCode::NOT_FOUND)?;

    let ext = canon_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let content_type = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        _ => return Err(StatusCode::UNSUPPORTED_MEDIA_TYPE),
    };

    let meta = tokio::fs::metadata(&canon_path)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;
    if meta.len() > 10_485_760 {
        return Err(StatusCode::PAYLOAD_TOO_LARGE);
    }

    let buf = tokio::fs::read(&canon_path)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    Ok((
        [
            (axum::http::header::CONTENT_TYPE, content_type),
            (axum::http::header::CACHE_CONTROL, "public, max-age=60"),
        ],
        buf,
    ))
}

// --- File tail SSE ---

#[derive(Deserialize)]
struct TailQuery {
    path: String,
}

async fn tail_file(
    Query(query): Query<TailQuery>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, StatusCode> {
    let path = PathBuf::from(&query.path);
    let canonical = path.canonicalize().unwrap_or_else(|_| path.clone());
    let s = canonical.to_string_lossy();
    if !s.starts_with("/tmp/") && !s.starts_with("/private/tmp/") && !s.starts_with("/var/folders/")
    {
        return Err(StatusCode::FORBIDDEN);
    }

    Ok(Sse::new(tail_stream(query.path)).keep_alive(KeepAlive::default()))
}

fn tail_stream(path: String) -> impl Stream<Item = Result<Event, Infallible>> {
    async_stream::stream! {
        let file_path = PathBuf::from(&path);

        // Wait up to 10s for file to appear
        let mut waited = 0u32;
        while !file_path.exists() && waited < 100 {
            tokio::time::sleep(Duration::from_millis(100)).await;
            waited += 1;
        }
        if !file_path.exists() {
            yield Ok(Event::default().event("error").data("File not found"));
            return;
        }

        // Read initial content
        let mut bytes_read: u64 = 0;
        if let Ok(mut f) = tokio::fs::File::open(&file_path).await {
            let mut buf = String::new();
            if let Ok(n) = f.read_to_string(&mut buf).await {
                bytes_read = n as u64;
                if !buf.is_empty() {
                    yield Ok(Event::default().event("content").data(buf));
                }
            }
        }

        // Watch parent dir for changes
        let (tx, mut rx) = tokio::sync::mpsc::channel::<()>(16);
        let parent = file_path.parent().unwrap_or(&file_path).to_path_buf();
        let _watcher = {
            use notify::{Watcher, RecursiveMode, Event as NEvent, EventKind};
            let file_name = file_path.file_name().map(|n| n.to_os_string());
            let tx = tx.clone();
            let mut watcher = notify::recommended_watcher(move |res: Result<NEvent, notify::Error>| {
                if let Ok(event) = res {
                    if matches!(event.kind, EventKind::Modify(_) | EventKind::Create(_)) {
                        let dominated = file_name.as_ref().is_none_or(|target| {
                            event.paths.iter().any(|p| p.file_name().map(|n| n == target.as_os_str()).unwrap_or(false))
                        });
                        if dominated {
                            let _ = tx.try_send(());
                        }
                    }
                }
            }).ok();
            if let Some(ref mut w) = watcher {
                let _ = w.watch(&parent, RecursiveMode::NonRecursive);
            }
            watcher
        };

        loop {
            let changed = tokio::time::timeout(Duration::from_secs(30), rx.recv()).await;
            match changed {
                Ok(Some(())) => {
                    // Drain any extra events
                    while rx.try_recv().is_ok() {}
                    // Read new bytes
                    if let Ok(mut f) = tokio::fs::File::open(&file_path).await {
                        use tokio::io::AsyncSeekExt;
                        if f.seek(std::io::SeekFrom::Start(bytes_read)).await.is_ok() {
                            let mut buf = String::new();
                            if let Ok(n) = f.read_to_string(&mut buf).await {
                                if n > 0 {
                                    bytes_read += n as u64;
                                    yield Ok(Event::default().event("content").data(buf));
                                }
                            }
                        }
                    }
                }
                Ok(None) => {
                    // Channel closed
                    yield Ok(Event::default().event("done").data("stream ended"));
                    break;
                }
                Err(_) => {
                    // 30s idle timeout
                    yield Ok(Event::default().event("done").data("idle timeout"));
                    break;
                }
            }
        }
    }
}

fn chrono_now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

use serde::Deserialize;

// --- Client error reporting ---

async fn client_error(Json(body): Json<serde_json::Value>) -> StatusCode {
    let error = body
        .get("error")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    let stack = body.get("stack").and_then(|v| v.as_str()).unwrap_or("");
    let mut msg = format!("[CLIENT ERROR] {}\n", error);
    if !stack.is_empty() {
        for line in stack.lines().take(15) {
            msg.push_str(&format!("  {}\n", line));
        }
    }
    // Write to home dir to avoid sandbox issues
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let path = format!("{}/client-error.log", home);
    let _ = tokio::fs::write(&path, &msg).await;
    StatusCode::OK
}
