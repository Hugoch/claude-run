use std::collections::BTreeSet;

use tokio::fs;

use crate::state::AppState;

fn tags_dir(state: &AppState) -> String {
    format!("{}/tags", state.claude_dir)
}

fn tags_path(state: &AppState, session_id: &str) -> String {
    format!("{}/{}", tags_dir(state), session_id)
}

pub fn normalize(raw: &str) -> Option<String> {
    let trimmed = raw.trim().trim_start_matches('#').trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_lowercase())
}

fn dedupe_keep_order(tags: Vec<String>) -> Vec<String> {
    let mut seen = BTreeSet::new();
    let mut out = Vec::with_capacity(tags.len());
    for t in tags {
        if seen.insert(t.clone()) {
            out.push(t);
        }
    }
    out
}

pub async fn load_tags(state: &AppState) {
    let dir = tags_dir(state);
    let mut entries = match fs::read_dir(&dir).await {
        Ok(e) => e,
        Err(_) => return,
    };

    while let Ok(Some(entry)) = entries.next_entry().await {
        let session_id = entry.file_name().to_string_lossy().to_string();
        if session_id.starts_with('.') {
            continue;
        }
        let content = match fs::read_to_string(entry.path()).await {
            Ok(c) => c,
            Err(_) => continue,
        };
        let tags: Vec<String> = content.lines().filter_map(normalize).collect();
        let tags = dedupe_keep_order(tags);
        if !tags.is_empty() {
            state.tags_cache.insert(session_id, tags);
        }
    }
}

pub fn get_tags(state: &AppState, session_id: &str) -> Option<Vec<String>> {
    state.tags_cache.get(session_id).map(|v| v.clone())
}

pub async fn set_tags(state: &AppState, session_id: &str, tags: Vec<String>) -> Vec<String> {
    let normalized: Vec<String> = tags.into_iter().filter_map(|t| normalize(&t)).collect();
    let normalized = dedupe_keep_order(normalized);

    let path = tags_path(state, session_id);
    if normalized.is_empty() {
        let _ = fs::remove_file(&path).await;
        state.tags_cache.remove(session_id);
    } else {
        let _ = fs::create_dir_all(tags_dir(state)).await;
        let content = normalized.join("\n") + "\n";
        let _ = fs::write(&path, content).await;
        state
            .tags_cache
            .insert(session_id.to_string(), normalized.clone());
    }
    normalized
}

pub async fn remove_session_tags(state: &AppState, session_id: &str) {
    let path = tags_path(state, session_id);
    let _ = fs::remove_file(&path).await;
    state.tags_cache.remove(session_id);
}

pub fn all_tags(state: &AppState) -> Vec<String> {
    let mut set: BTreeSet<String> = BTreeSet::new();
    for entry in state.tags_cache.iter() {
        for tag in entry.value() {
            set.insert(tag.clone());
        }
    }
    set.into_iter().collect()
}
