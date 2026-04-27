use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;

use tokio::fs;
use tokio::io::{AsyncBufReadExt, AsyncSeekExt, BufReader};

use crate::models::*;
use crate::state::AppState;

/// Extract task-id from a string containing <task-notification> XML.
fn extract_task_id(text: &str) -> Option<String> {
    let start = text.find("<task-id>")? + "<task-id>".len();
    let end = text[start..].find("</task-id>")? + start;
    Some(text[start..end].to_string())
}

/// Convert a queue-operation with <task-notification> content into a user message
/// so it gets displayed in the conversation UI.
fn queue_op_to_user_message(msg: &ConversationMessage) -> Option<ConversationMessage> {
    let content = msg.extra.get("content")?.as_str()?;
    if !content.contains("<task-notification>") {
        return None;
    }
    let mut m = msg.clone();
    m.msg_type = "user".to_string();
    m.message = Some(MessageBody {
        role: Some("user".to_string()),
        content: Some(MessageContent::Text(content.to_string())),
        model: None,
        usage: None,
    });
    Some(m)
}

pub fn encode_project_path(path: &str) -> String {
    path.chars()
        .map(|c| if c == '/' || c == '.' { '-' } else { c })
        .collect()
}

pub fn decode_project_path(encoded: &str) -> String {
    // Encoded format: -Users-xcid-workspace-foo → /Users/xcid/workspace/foo
    // Leading - was a /, subsequent - could be / or . but we assume /
    if encoded.starts_with('-') {
        encoded.replacen('-', "/", encoded.len())
    } else {
        encoded.to_string()
    }
}

async fn get_session_slug(state: &AppState, session_id: &str) -> Option<String> {
    if let Some(cached) = state.slug_cache.get(session_id) {
        return cached.value().clone();
    }

    let file_path = match find_session_file(state, session_id).await {
        Some(p) => p,
        None => {
            state.slug_cache.insert(session_id.to_string(), None);
            return None;
        }
    };

    let file = match tokio::fs::File::open(&file_path).await {
        Ok(f) => f,
        Err(_) => {
            state.slug_cache.insert(session_id.to_string(), None);
            return None;
        }
    };

    let reader = tokio::io::BufReader::new(file);
    let mut lines = reader.lines();
    while let Ok(Some(line)) = lines.next_line().await {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
            if let Some(slug) = val.get("slug").and_then(|s| s.as_str()) {
                let slug = slug.to_string();
                state.slug_cache.insert(session_id.to_string(), Some(slug.clone()));
                return Some(slug);
            }
        }
    }

    state.slug_cache.insert(session_id.to_string(), None);
    None
}

async fn get_session_git_branch(state: &AppState, session_id: &str) -> Option<String> {
    if let Some(cached) = state.git_branch_cache.get(session_id) {
        return cached.value().clone();
    }

    let file_path = match find_session_file(state, session_id).await {
        Some(p) => p,
        None => {
            state.git_branch_cache.insert(session_id.to_string(), None);
            return None;
        }
    };

    // Read first ~10 lines looking for gitBranch (appears on progress lines near the top)
    let content = match tokio::fs::read_to_string(&file_path).await {
        Ok(c) => c,
        Err(_) => {
            state.git_branch_cache.insert(session_id.to_string(), None);
            return None;
        }
    };

    for (i, line) in content.lines().enumerate() {
        if i >= 10 {
            break;
        }
        if !line.contains("gitBranch") {
            continue;
        }
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(line) {
            if let Some(branch) = val.get("gitBranch").and_then(|s| s.as_str()) {
                if !branch.is_empty() && branch != "HEAD" && branch != "main" && branch != "master" {
                    let branch = branch.to_string();
                    state.git_branch_cache.insert(session_id.to_string(), Some(branch.clone()));
                    return Some(branch);
                }
            }
        }
    }

    state.git_branch_cache.insert(session_id.to_string(), None);
    None
}

async fn get_first_user_message(state: &AppState, session_id: &str) -> String {
    let file_path = match find_session_file(state, session_id).await {
        Some(p) => p,
        None => return session_id.to_string(),
    };

    let content = match fs::read_to_string(&file_path).await {
        Ok(c) => c,
        Err(_) => return session_id.to_string(),
    };

    for line in content.lines() {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(msg) = serde_json::from_str::<ConversationMessage>(line) {
            if msg.msg_type == "user" {
                if let Some(ref message) = msg.message {
                    if let Some(ref content) = message.content {
                        let text = extract_text_from_content(content);
                        if !text.is_empty() {
                            let truncated: String = text.chars().take(100).collect();
                            return truncated;
                        }
                    }
                }
            }
        }
    }

    session_id.to_string()
}

pub fn get_project_name(project_path: &str) -> String {
    project_path
        .split('/')
        .rfind(|s| !s.is_empty())
        .unwrap_or(project_path)
        .to_string()
}

pub async fn build_file_index(state: &AppState) {
    let projects_dir = &state.projects_dir;
    let mut entries = match fs::read_dir(projects_dir).await {
        Ok(e) => e,
        Err(_) => return,
    };

    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let mut sub_entries = match fs::read_dir(&path).await {
            Ok(e) => e,
            Err(_) => continue,
        };
        while let Ok(Some(file_entry)) = sub_entries.next_entry().await {
            let file_path = file_entry.path();
            if let Some(ext) = file_path.extension() {
                if ext == "jsonl" {
                    if let Some(stem) = file_path.file_stem() {
                        let session_id = stem.to_string_lossy().to_string();
                        state
                            .file_index
                            .insert(session_id, file_path.to_string_lossy().to_string());
                    }
                }
            }
        }
    }
}

pub async fn load_history_cache(state: &AppState) -> Vec<HistoryEntry> {
    let history_path = format!("{}/history.jsonl", state.claude_dir);
    let content = match fs::read_to_string(&history_path).await {
        Ok(c) => c,
        Err(_) => {
            let mut cache = state.history_cache.write().await;
            *cache = Some(Vec::new());
            return Vec::new();
        }
    };

    let entries: Vec<HistoryEntry> = content
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect();

    let mut cache = state.history_cache.write().await;
    *cache = Some(entries.clone());
    entries
}

pub async fn load_pane_map(state: &AppState) {
    let pane_map_dir = format!("{}/pane-map", state.claude_dir);
    let mut entries = match fs::read_dir(&pane_map_dir).await {
        Ok(e) => e,
        Err(_) => return,
    };

    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let session_id = match path.file_name() {
            Some(name) => name.to_string_lossy().to_string(),
            None => continue,
        };
        if let Ok(raw) = fs::read_to_string(&path).await {
            let raw = raw.trim().to_string();
            if !raw.is_empty() {
                let (pane_id, zellij_session) = if let Some((p, z)) = raw.split_once(':') {
                    (p.to_string(), if z.is_empty() { None } else { Some(z.to_string()) })
                } else {
                    (raw, None)
                };
                state.session_panes.insert(session_id, (pane_id, zellij_session, false));
            }
        }
    }
}

async fn load_deleted_sessions(state: &AppState) {
    let deleted_path = format!("{}/deleted_sessions", state.claude_dir);
    if let Ok(content) = fs::read_to_string(&deleted_path).await {
        for line in content.lines() {
            let id = line.trim();
            if !id.is_empty() {
                state.hidden_sessions.insert(id.to_string(), ());
            }
        }
    }
}

pub async fn load_storage(state: &AppState) {
    tokio::join!(
        build_file_index(state),
        load_history_cache(state),
        load_pane_map(state),
        load_deleted_sessions(state),
    );
}

async fn find_session_by_timestamp(
    projects_dir: &str,
    encoded_project: &str,
    timestamp: f64,
) -> Option<String> {
    let project_path = PathBuf::from(projects_dir).join(encoded_project);
    let mut entries = fs::read_dir(&project_path).await.ok()?;

    let mut closest_file: Option<String> = None;
    let mut closest_diff = f64::INFINITY;

    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        if let Ok(meta) = fs::metadata(&path).await {
            if let Ok(modified) = meta.modified() {
                let mtime_ms = modified
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs_f64()
                    * 1000.0;
                let diff = (mtime_ms - timestamp).abs();
                if diff < closest_diff {
                    closest_diff = diff;
                    closest_file = path
                        .file_stem()
                        .map(|s| s.to_string_lossy().to_string());
                }
            }
        }
    }

    closest_file
}

pub async fn find_session_file(state: &AppState, session_id: &str) -> Option<String> {
    // Check index first
    if let Some(entry) = state.file_index.get(session_id) {
        return Some(entry.value().clone());
    }

    // Fallback: scan all project directories
    let target_file = format!("{}.jsonl", session_id);
    let mut entries = fs::read_dir(&state.projects_dir).await.ok()?;

    while let Ok(Some(dir_entry)) = entries.next_entry().await {
        let dir_path = dir_entry.path();
        if !dir_path.is_dir() {
            continue;
        }
        let mut sub_entries = match fs::read_dir(&dir_path).await {
            Ok(e) => e,
            Err(_) => continue,
        };
        while let Ok(Some(file_entry)) = sub_entries.next_entry().await {
            if file_entry.file_name().to_string_lossy() == target_file {
                let file_path = file_entry.path().to_string_lossy().to_string();
                state
                    .file_index
                    .insert(session_id.to_string(), file_path.clone());
                return Some(file_path);
            }
        }
    }

    None
}

pub async fn count_session_messages(state: &AppState, session_id: &str) -> usize {
    let file_path = match find_session_file(state, session_id).await {
        Some(p) => p,
        None => return 0,
    };

    let file_size = match fs::metadata(&file_path).await {
        Ok(m) => m.len(),
        Err(_) => return 0,
    };

    // Return cached count if file size hasn't changed
    if let Some(cached) = state.message_count_cache.get(session_id) {
        if cached.1 == file_size {
            return cached.0;
        }
    }

    let content = match fs::read_to_string(&file_path).await {
        Ok(c) => c,
        Err(_) => return 0,
    };

    let count = content
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|line| {
            let v: serde_json::Value = serde_json::from_str(line).ok()?;
            let t = v.get("type")?.as_str()?;
            if t == "user" || t == "assistant" {
                Some(())
            } else {
                None
            }
        })
        .count();

    state.message_count_cache.insert(session_id.to_string(), (count, file_size));
    count
}

pub async fn get_sessions(state: &AppState) -> Vec<Session> {
    // Check dirty flag — always reload if history.jsonl changed
    let is_dirty = state.history_dirty.swap(false, std::sync::atomic::Ordering::AcqRel);
    let entries = if is_dirty {
        // Invalidate and reload
        {
            let mut cache = state.history_cache.write().await;
            *cache = None;
        }
        load_history_cache(state).await
    } else {
        let cache = state.history_cache.read().await;
        match cache.as_ref() {
            Some(entries) => entries.clone(),
            None => {
                drop(cache);
                load_history_cache(state).await
            }
        }
    };

    let mut sessions = Vec::new();
    let mut seen_ids = HashSet::new();

    for entry in &entries {
        let session_id = if let Some(ref sid) = entry.session_id {
            sid.clone()
        } else {
            let encoded = encode_project_path(&entry.project);
            match find_session_by_timestamp(&state.projects_dir, &encoded, entry.timestamp).await {
                Some(id) => id,
                None => continue,
            }
        };

        if seen_ids.contains(&session_id) || state.hidden_sessions.contains_key(&session_id) {
            continue;
        }
        seen_ids.insert(session_id.clone());

        let file_path = find_session_file(state, &session_id).await;
        let message_count = match &file_path {
            Some(_) => count_session_messages(state, &session_id).await,
            None => 0,
        };

        let mut last_activity = entry.timestamp;
        let mut file_size = None;
        if let Some(ref fp) = file_path {
            if let Ok(meta) = fs::metadata(fp).await {
                file_size = Some(meta.len());
                if let Ok(modified) = meta.modified() {
                    last_activity = modified
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs_f64()
                        * 1000.0;
                }
            }
        }

        let slug = get_session_slug(state, &session_id).await;
        let git_branch = get_session_git_branch(state, &session_id).await;
        let summary = state.summary_cache.get(&session_id).map(|v| v.0.clone());
        let tags = crate::tags::get_tags(state, &session_id);

        let display = if entry.display.contains("** Session started from claude-run **") {
            "New session".to_string()
        } else {
            entry.display.clone()
        };

        sessions.push(Session {
            id: session_id.clone(),
            display,
            timestamp: entry.timestamp,
            last_activity,
            project: entry.project.clone(),
            project_name: get_project_name(&entry.project),
            message_count,
            status: state.get_session_status(&session_id),
            pane_id: state.get_session_pane(&session_id).map(|(id, _, _)| id),
            pane_verified: state.get_session_pane(&session_id).map(|(_, _, v)| v),
            zellij_session: state.get_session_pane(&session_id).and_then(|(_, zs, _)| zs),
            permission_message: state.permission_messages.get(&session_id).map(|v| v.clone()),
            question_data: state.question_data.get(&session_id).map(|v| v.clone()),
            slug,
            git_branch,
            summary,
            file_size,
            tags,
        });
    }

    // Include orphan sessions (files in index but not in history.jsonl)
    for entry in state.file_index.iter() {
        let session_id = entry.key().clone();
        if session_id.starts_with("agent-") || seen_ids.contains(&session_id) || state.hidden_sessions.contains_key(&session_id) {
            continue;
        }
        seen_ids.insert(session_id.clone());

        let file_path = entry.value().clone();
        let message_count = count_session_messages(state, &session_id).await;
        if message_count == 0 {
            continue;
        }

        // Extract project from file path: .../projects/<encoded_project>/<sessionId>.jsonl
        let project_path = std::path::Path::new(&file_path);
        let project_dir = project_path.parent().unwrap_or(std::path::Path::new(""));
        let encoded_project = project_dir
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        // Decode project path: replace leading - with /, then remaining - that were / or .
        let project = decode_project_path(&encoded_project);
        let project_name = get_project_name(&project);

        // Get first user message as display text
        let display = get_first_user_message(state, &session_id).await;

        let mut last_activity = 0.0_f64;
        let mut timestamp = 0.0_f64;
        let mut file_size = None;
        if let Ok(meta) = fs::metadata(&file_path).await {
            file_size = Some(meta.len());
            if let Ok(modified) = meta.modified() {
                last_activity = modified
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs_f64()
                    * 1000.0;
            }
            if let Ok(created) = meta.created() {
                timestamp = created
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs_f64()
                    * 1000.0;
            }
        }

        let slug = get_session_slug(state, &session_id).await;
        let git_branch = get_session_git_branch(state, &session_id).await;
        let summary = state.summary_cache.get(&session_id).map(|v| v.0.clone());
        let tags = crate::tags::get_tags(state, &session_id);

        sessions.push(Session {
            id: session_id.clone(),
            display,
            timestamp,
            last_activity,
            project,
            project_name,
            message_count,
            status: state.get_session_status(&session_id),
            pane_id: state.get_session_pane(&session_id).map(|(id, _, _)| id),
            pane_verified: state.get_session_pane(&session_id).map(|(_, _, v)| v),
            zellij_session: state.get_session_pane(&session_id).and_then(|(_, zs, _)| zs),
            permission_message: state.permission_messages.get(&session_id).map(|v| v.clone()),
            question_data: state.question_data.get(&session_id).map(|v| v.clone()),
            slug,
            git_branch,
            summary,
            file_size,
            tags,
        });
    }

    sessions.sort_by(|a, b| b.last_activity.partial_cmp(&a.last_activity).unwrap_or(std::cmp::Ordering::Equal));
    sessions
}

pub async fn get_projects(state: &AppState) -> Vec<String> {
    let entries = {
        let cache = state.history_cache.read().await;
        match cache.as_ref() {
            Some(entries) => entries.clone(),
            None => {
                drop(cache);
                load_history_cache(state).await
            }
        }
    };

    let mut projects: Vec<String> = entries
        .iter()
        .filter(|e| !e.project.is_empty())
        .map(|e| e.project.clone())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();

    projects.sort();
    projects
}

pub async fn get_conversation(state: &AppState, session_id: &str) -> Vec<ConversationMessage> {
    let file_path = match find_session_file(state, session_id).await {
        Some(p) => p,
        None => return Vec::new(),
    };

    let content = match fs::read_to_string(&file_path).await {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };

    let mut messages = Vec::new();
    let mut summaries = Vec::new();
    let mut queue_ops = Vec::new();

    // Collect task-ids from real user messages to deduplicate queue-operations
    let mut seen_task_ids = HashSet::new();

    for line in content.lines() {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(msg) = serde_json::from_str::<ConversationMessage>(line) {
            match msg.msg_type.as_str() {
                "user" | "assistant" => {
                    // Track task-ids from user messages containing task-notifications
                    if msg.msg_type == "user" {
                        if let Some(ref message) = msg.message {
                            let text = match &message.content {
                                Some(MessageContent::Text(t)) => Some(t.as_str()),
                                _ => None,
                            };
                            if let Some(t) = text {
                                if let Some(tid) = extract_task_id(t) {
                                    seen_task_ids.insert(tid);
                                }
                            }
                        }
                    }
                    messages.push(msg);
                }
                "summary" => summaries.push(msg),
                "queue-operation" => {
                    if let Some(m) = queue_op_to_user_message(&msg) {
                        queue_ops.push(m);
                    }
                }
                _ => {}
            }
        }
    }

    // Only add queue-op notifications that don't already have a real user message
    for m in queue_ops {
        if let Some(ref message) = m.message {
            let text = match &message.content {
                Some(MessageContent::Text(t)) => Some(t.as_str()),
                _ => None,
            };
            if let Some(t) = text {
                if let Some(tid) = extract_task_id(t) {
                    if seen_task_ids.contains(&tid) {
                        continue;
                    }
                }
            }
        }
        messages.push(m);
    }

    // Summaries go at the beginning (unshift behavior)
    summaries.extend(messages);
    summaries
}

pub async fn get_conversation_stream(
    state: &AppState,
    session_id: &str,
    from_offset: u64,
) -> StreamResult {
    let file_path = match find_session_file(state, session_id).await {
        Some(p) => p,
        None => {
            return StreamResult {
                messages: Vec::new(),
                next_offset: 0,
            }
        }
    };

    let file = match tokio::fs::File::open(&file_path).await {
        Ok(f) => f,
        Err(_) => {
            return StreamResult {
                messages: Vec::new(),
                next_offset: from_offset,
            }
        }
    };

    let file_size = match file.metadata().await {
        Ok(m) => m.len(),
        Err(_) => {
            return StreamResult {
                messages: Vec::new(),
                next_offset: from_offset,
            }
        }
    };

    if from_offset >= file_size {
        return StreamResult {
            messages: Vec::new(),
            next_offset: from_offset,
        };
    }

    let mut file = file;
    if from_offset > 0
        && file
            .seek(std::io::SeekFrom::Start(from_offset))
            .await
            .is_err()
    {
        return StreamResult {
            messages: Vec::new(),
            next_offset: from_offset,
        };
    }

    let reader = BufReader::new(file);
    let mut lines = reader.lines();
    let mut messages = Vec::new();
    let mut bytes_consumed: u64 = 0;

    while let Ok(Some(line)) = lines.next_line().await {
        let line_bytes = line.len() as u64 + 1; // +1 for newline

        if line.trim().is_empty() {
            bytes_consumed += line_bytes;
            continue;
        }

        match serde_json::from_str::<ConversationMessage>(&line) {
            Ok(msg) => {
                if msg.msg_type == "user" || msg.msg_type == "assistant" || msg.msg_type == "summary" {
                    messages.push(msg);
                } else if msg.msg_type == "queue-operation" {
                    if let Some(m) = queue_op_to_user_message(&msg) {
                        messages.push(m);
                    }
                }
                bytes_consumed += line_bytes;
            }
            Err(_) => {
                // Likely a partially written line at the end — stop here
                // and retry from this offset on next file change
                break;
            }
        }
    }

    let actual_offset = from_offset + bytes_consumed;
    let next_offset = if actual_offset > file_size {
        file_size
    } else {
        actual_offset
    };

    StreamResult {
        messages,
        next_offset,
    }
}

/// Get the last N messages from a conversation file (for initial load).
/// Returns messages, the byte offset where they start, and whether there are more.
pub async fn get_conversation_tail(
    state: &AppState,
    session_id: &str,
    limit: usize,
) -> PaginatedResult {
    let file_path = match find_session_file(state, session_id).await {
        Some(p) => p,
        None => {
            return PaginatedResult {
                messages: Vec::new(),
                start_offset: 0,
                end_offset: 0,
                has_more: false,
            }
        }
    };

    // Read entire file to parse all messages with their byte offsets
    let content = match fs::read(&file_path).await {
        Ok(c) => c,
        Err(_) => {
            return PaginatedResult {
                messages: Vec::new(),
                start_offset: 0,
                end_offset: 0,
                has_more: false,
            }
        }
    };

    let file_size = content.len() as u64;

    // Parse all lines, tracking byte offsets
    let mut entries: Vec<(u64, u64, ConversationMessage)> = Vec::new(); // (start, end, msg)
    let mut offset: u64 = 0;

    for line in content.split(|&b| b == b'\n') {
        let line_len = line.len() as u64;
        let line_end = offset + line_len + 1; // +1 for newline

        if !line.is_empty() {
            if let Ok(line_str) = std::str::from_utf8(line) {
                if let Ok(msg) = serde_json::from_str::<ConversationMessage>(line_str) {
                    if msg.msg_type == "user" || msg.msg_type == "assistant" || msg.msg_type == "summary" {
                        entries.push((offset, line_end, msg));
                    } else if msg.msg_type == "queue-operation" {
                        if let Some(m) = queue_op_to_user_message(&msg) {
                            entries.push((offset, line_end, m));
                        }
                    }
                }
            }
        }

        offset = line_end;
    }

    if entries.is_empty() {
        return PaginatedResult {
            messages: Vec::new(),
            start_offset: 0,
            end_offset: file_size,
            has_more: false,
        };
    }

    let total = entries.len();
    let take_count = limit.min(total);
    let skip_count = total - take_count;
    let has_more = skip_count > 0;

    let start_offset = if has_more {
        entries[skip_count].0
    } else {
        0
    };

    let messages: Vec<ConversationMessage> = entries
        .into_iter()
        .skip(skip_count)
        .map(|(_, _, msg)| msg)
        .collect();

    PaginatedResult {
        messages,
        start_offset,
        end_offset: file_size,
        has_more,
    }
}

/// Get messages in a byte range (for loading older messages).
pub async fn get_conversation_range(
    state: &AppState,
    session_id: &str,
    end_offset: u64,
    limit: usize,
) -> PaginatedResult {
    let file_path = match find_session_file(state, session_id).await {
        Some(p) => p,
        None => {
            return PaginatedResult {
                messages: Vec::new(),
                start_offset: 0,
                end_offset: 0,
                has_more: false,
            }
        }
    };

    if end_offset == 0 {
        return PaginatedResult {
            messages: Vec::new(),
            start_offset: 0,
            end_offset: 0,
            has_more: false,
        };
    }

    // Read up to end_offset
    let content = match fs::read(&file_path).await {
        Ok(c) => c,
        Err(_) => {
            return PaginatedResult {
                messages: Vec::new(),
                start_offset: 0,
                end_offset,
                has_more: false,
            }
        }
    };

    let read_end = (end_offset as usize).min(content.len());
    let content = &content[..read_end];

    // Parse all lines up to end_offset
    let mut entries: Vec<(u64, u64, ConversationMessage)> = Vec::new();
    let mut offset: u64 = 0;

    for line in content.split(|&b| b == b'\n') {
        let line_len = line.len() as u64;
        let line_end = offset + line_len + 1;

        if line_end > end_offset {
            break;
        }

        if !line.is_empty() {
            if let Ok(line_str) = std::str::from_utf8(line) {
                if let Ok(msg) = serde_json::from_str::<ConversationMessage>(line_str) {
                    if msg.msg_type == "user" || msg.msg_type == "assistant" || msg.msg_type == "summary" {
                        entries.push((offset, line_end, msg));
                    } else if msg.msg_type == "queue-operation" {
                        if let Some(m) = queue_op_to_user_message(&msg) {
                            entries.push((offset, line_end, m));
                        }
                    }
                }
            }
        }

        offset = line_end;
    }

    if entries.is_empty() {
        return PaginatedResult {
            messages: Vec::new(),
            start_offset: 0,
            end_offset,
            has_more: false,
        };
    }

    let total = entries.len();
    let take_count = limit.min(total);
    let skip_count = total - take_count;
    let has_more = skip_count > 0;

    let start_offset = if has_more {
        entries[skip_count].0
    } else {
        0
    };

    let messages: Vec<ConversationMessage> = entries
        .into_iter()
        .skip(skip_count)
        .map(|(_, _, msg)| msg)
        .collect();

    PaginatedResult {
        messages,
        start_offset,
        end_offset,
        has_more,
    }
}

pub async fn delete_session(state: &AppState, session_id: &str) -> bool {
    let history_path = format!("{}/history.jsonl", state.claude_dir);

    let content = match fs::read_to_string(&history_path).await {
        Ok(c) => c,
        Err(_) => return false,
    };

    let lines: Vec<&str> = content.lines().filter(|l| !l.trim().is_empty()).collect();
    let mut filtered = Vec::new();

    for line in &lines {
        if let Ok(entry) = serde_json::from_str::<HistoryEntry>(line) {
            if entry.session_id.as_deref() == Some(session_id) {
                continue;
            }
        }
        filtered.push(*line);
    }

    // Also accept deletion if the session exists in file_index but not in history
    let in_file_index = state.file_index.contains_key(session_id);
    if filtered.len() == lines.len() && !in_file_index {
        return false;
    }

    if filtered.len() != lines.len() {
        let new_content = filtered.join("\n") + "\n";
        if fs::write(&history_path, new_content).await.is_err() {
            return false;
        }
    }

    // Remove from file_index and mark hidden so watcher doesn't resurrect it
    state.file_index.remove(session_id);
    state.hidden_sessions.insert(session_id.to_string(), ());
    state.summary_cache.remove(session_id);
    crate::tags::remove_session_tags(state, session_id).await;
    state.invalidate_history_cache();

    // Persist to disk so deletion survives restart
    let deleted_path = format!("{}/deleted_sessions", state.claude_dir);
    if let Ok(mut f) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&deleted_path)
        .await
    {
        use tokio::io::AsyncWriteExt;
        let _ = f.write_all(format!("{}\n", session_id).as_bytes()).await;
    }

    true
}

pub async fn get_subagent_map(state: &AppState, session_id: &str) -> Vec<SubagentInfo> {
    let file_path = match find_session_file(state, session_id).await {
        Some(p) => p,
        None => return Vec::new(),
    };

    let content = match fs::read_to_string(&file_path).await {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };

    let mut infos = Vec::new();
    let mut seen = HashSet::new();

    for line in content.lines() {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(raw) = serde_json::from_str::<RawJsonLine>(line) {
            if raw.msg_type.as_deref() == Some("progress") {
                if let Some(ref data) = raw.data {
                    if data.data_type.as_deref() == Some("agent_progress") {
                        if let (Some(ref agent_id), Some(ref tool_use_id)) =
                            (&data.agent_id, &raw.parent_tool_use_id)
                        {
                            if seen.insert(agent_id.clone()) {
                                infos.push(SubagentInfo {
                                    agent_id: agent_id.clone(),
                                    tool_use_id: tool_use_id.clone(),
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    infos
}

pub async fn get_subagent_conversation(
    state: &AppState,
    session_id: &str,
    agent_id: &str,
) -> Vec<ConversationMessage> {
    let file_path = match find_session_file(state, session_id).await {
        Some(p) => p,
        None => return Vec::new(),
    };

    // Session file: <projects>/<encoded>/<sessionId>.jsonl
    // Subagent: <projects>/<encoded>/<sessionId>/subagents/agent-<agentId>.jsonl
    let session_dir = file_path.trim_end_matches(".jsonl");
    let subagent_path = format!("{}/subagents/agent-{}.jsonl", session_dir, agent_id);

    let content = match fs::read_to_string(&subagent_path).await {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };

    content
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|line| {
            let msg: ConversationMessage = serde_json::from_str(line).ok()?;
            if msg.msg_type == "user" || msg.msg_type == "assistant" {
                Some(msg)
            } else {
                None
            }
        })
        .collect()
}

pub async fn get_plan_session_map(state: &AppState, session_id: &str) -> Vec<PlanSessionInfo> {
    // 1. Get the slug for this session
    let slug = match get_session_slug(state, session_id).await {
        Some(s) => s,
        None => return Vec::new(),
    };

    // 2. Find ExitPlanMode tool_use IDs in this session
    let file_path = match find_session_file(state, session_id).await {
        Some(p) => p,
        None => return Vec::new(),
    };
    let content = match fs::read_to_string(&file_path).await {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };

    let mut exit_plan_tool_ids = Vec::new();
    for line in content.lines() {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(msg) = serde_json::from_str::<ConversationMessage>(line) {
            if msg.msg_type == "assistant" {
                if let Some(ref message) = msg.message {
                    if let Some(MessageContent::Blocks(ref blocks)) = message.content {
                        for block in blocks {
                            if block.name.as_deref() == Some("ExitPlanMode") {
                                if let Some(ref id) = block.id {
                                    exit_plan_tool_ids.push(id.clone());
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if exit_plan_tool_ids.is_empty() {
        return Vec::new();
    }

    // 3. Find other sessions with the same slug
    let mut plan_sessions = Vec::new();
    for entry in state.file_index.iter() {
        let other_id = entry.key().clone();
        if other_id == session_id {
            continue;
        }
        if let Some(other_slug) = get_session_slug(state, &other_id).await {
            if other_slug == slug {
                plan_sessions.push(other_id);
            }
        }
    }

    if plan_sessions.is_empty() {
        return Vec::new();
    }

    // 4. Map: use the first ExitPlanMode tool_use ID → first plan session
    // (usually there's only one ExitPlanMode and one implementation session per slug)
    let mut result = Vec::new();
    for (i, tool_id) in exit_plan_tool_ids.iter().enumerate() {
        if let Some(plan_session_id) = plan_sessions.get(i).or(plan_sessions.last()) {
            result.push(PlanSessionInfo {
                tool_use_id: tool_id.clone(),
                session_id: plan_session_id.clone(),
            });
        }
    }

    result
}

fn extract_text_from_content(content: &MessageContent) -> String {
    match content {
        MessageContent::Text(s) => s.clone(),
        MessageContent::Blocks(blocks) => {
            let mut texts = Vec::new();
            for block in blocks {
                if let Some(ref text) = block.text {
                    texts.push(text.clone());
                }
                if let Some(ref thinking) = block.thinking {
                    texts.push(thinking.clone());
                }
                if let Some(ref nested) = block.content {
                    match nested {
                        ContentBlockContent::Text(s) => texts.push(s.clone()),
                        ContentBlockContent::Blocks(b) => {
                            texts.push(extract_text_from_content(&MessageContent::Blocks(
                                b.clone(),
                            )));
                        }
                    }
                }
                if let Some(ref input) = block.input {
                    if input.is_object() {
                        texts.push(input.to_string());
                    }
                }
            }
            texts.join(" ")
        }
    }
}

fn extract_message_text(msg: &ConversationMessage) -> String {
    if let Some(ref summary) = msg.summary {
        return summary.clone();
    }
    if let Some(ref message) = msg.message {
        if let Some(ref content) = message.content {
            return extract_text_from_content(content);
        }
    }
    String::new()
}

fn create_snippet(text: &str, query: &str, context_length: usize) -> String {
    let lower_text = text.to_lowercase();
    let lower_query = query.to_lowercase();

    let index = match lower_text.find(&lower_query) {
        Some(i) => i,
        None => return text.chars().take(context_length * 2).collect(),
    };

    let start = index.saturating_sub(context_length);
    let end = (index + query.len() + context_length).min(text.len());

    // Ensure we don't split multi-byte characters
    let start = text.floor_char_boundary(start);
    let end = text.ceil_char_boundary(end);

    let mut snippet = text[start..end].to_string();
    if start > 0 {
        snippet = format!("...{}", snippet);
    }
    if end < text.len() {
        snippet = format!("{}...", snippet);
    }
    snippet
}

async fn search_session_file(
    file_path: &str,
    _session_id: &str,
    query: &str,
) -> Vec<SearchMatch> {
    let content = match fs::read_to_string(file_path).await {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };

    let lower_query = query.to_lowercase();
    let mut matches = Vec::new();
    let mut message_index = 0;

    for line in content.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let msg: ConversationMessage = match serde_json::from_str(line) {
            Ok(m) => m,
            Err(_) => continue,
        };

        if msg.msg_type != "user" && msg.msg_type != "assistant" {
            continue;
        }

        let text = extract_message_text(&msg);
        if text.to_lowercase().contains(&lower_query) {
            let truncated: String = text.chars().take(200).collect();
            matches.push(SearchMatch {
                message_index,
                text: truncated,
                snippet: create_snippet(&text, query, 60),
            });
        }
        message_index += 1;
    }

    matches
}

pub async fn search_conversations(state: &Arc<AppState>, query: &str) -> Vec<SearchResult> {
    let query = query.trim();
    if query.is_empty() {
        return Vec::new();
    }

    let sessions = get_sessions(state).await;

    let mut handles = Vec::new();
    for session in &sessions {
        let session_id = session.id.clone();
        let display = session.display.clone();
        let project_name = session.project_name.clone();
        let timestamp = session.timestamp;
        let query = query.to_string();
        let state = state.clone();

        handles.push(tokio::spawn(async move {
            let file_path = match find_session_file(&state, &session_id).await {
                Some(p) => p,
                None => return None,
            };

            let matches = search_session_file(&file_path, &session_id, &query).await;
            if matches.is_empty() {
                return None;
            }

            Some(SearchResult {
                session_id,
                display,
                project_name,
                timestamp,
                matches,
            })
        }));
    }

    let mut results = Vec::new();
    for handle in handles {
        if let Ok(Some(result)) = handle.await {
            results.push(result);
        }
    }

    results.sort_by(|a, b| b.timestamp.partial_cmp(&a.timestamp).unwrap_or(std::cmp::Ordering::Equal));
    results
}

