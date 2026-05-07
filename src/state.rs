use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Instant;

use dashmap::DashMap;
use tokio::sync::{broadcast, Mutex, RwLock};

use crate::models::{HistoryEntry, PushSubscription, SessionStatus, UsageResponse};

pub struct AppState {
    pub claude_dir: String,
    pub projects_dir: String,
    pub dev_mode: bool,

    // sessionId → file path
    pub file_index: DashMap<String, String>,
    // sessionId → status
    pub session_statuses: DashMap<String, SessionStatus>,
    // sessionId → (pane ID, zellij session name, verified via hook)
    pub session_panes: DashMap<String, (String, Option<String>, bool)>,
    // sessionId → permission request message
    pub permission_messages: DashMap<String, String>,
    // sessionId → AskUserQuestion data (questions array from tool_input)
    pub question_data: DashMap<String, serde_json::Value>,
    // sessionId → slug (plan name, cached from JSONL)
    pub slug_cache: DashMap<String, Option<String>>,
    // sessionId → git branch (cached from JSONL)
    pub git_branch_cache: DashMap<String, Option<String>>,
    // (project, branch) → (PR URL, PR number) (cached from gh CLI)
    pub pr_cache: DashMap<(String, String), Option<(String, u64)>>,
    // sessionId → (message_count, file_size) — invalidated when file grows
    pub message_count_cache: DashMap<String, (usize, u64)>,
    // sessionId → (summary, message_count_at_generation)
    pub summary_cache: DashMap<String, (String, usize)>,
    // sessionId → true while generating (avoid duplicate spawns)
    pub summary_pending: DashMap<String, bool>,
    // sessionId → user-assigned tags (lowercase, deduped)
    pub tags_cache: DashMap<String, Vec<String>>,
    // Sessions hidden from UI (deleted by user)
    pub hidden_sessions: DashMap<String, ()>,
    // Parsed history.jsonl cache
    pub history_cache: RwLock<Option<Vec<HistoryEntry>>>,
    pub history_dirty: AtomicBool,
    // Usage API cache (response, fetched_at)
    pub usage_cache: Mutex<Option<(Instant, UsageResponse)>>,

    // Last ping timestamps (unix epoch secs) — 0 = never
    pub last_mobile_ping: AtomicU64,
    pub last_desktop_ping: AtomicU64,

    // Push notifications
    pub push_subscriptions: DashMap<String, PushSubscription>,
    pub vapid_private_pem: Vec<u8>,
    pub vapid_public_base64: String,

    // Broadcast channels for SSE
    pub history_tx: broadcast::Sender<()>,
    pub session_tx: broadcast::Sender<(String, String)>, // (sessionId, filePath)
    pub status_tx: broadcast::Sender<(String, SessionStatus)>,
    pub url_tx: broadcast::Sender<String>,
}

impl AppState {
    pub fn new(claude_dir: String, dev_mode: bool, vapid_private_pem: Vec<u8>, vapid_public_base64: String) -> Arc<Self> {
        let projects_dir = format!("{}/projects", claude_dir);
        let (history_tx, _) = broadcast::channel(64);
        let (session_tx, _) = broadcast::channel(256);
        let (status_tx, _) = broadcast::channel(64);
        let (url_tx, _) = broadcast::channel(16);

        Arc::new(Self {
            claude_dir,
            projects_dir,
            dev_mode,
            file_index: DashMap::new(),
            session_statuses: DashMap::new(),
            session_panes: DashMap::new(),
            permission_messages: DashMap::new(),
            question_data: DashMap::new(),
            slug_cache: DashMap::new(),
            git_branch_cache: DashMap::new(),
            pr_cache: DashMap::new(),
            message_count_cache: DashMap::new(),
            summary_cache: DashMap::new(),
            summary_pending: DashMap::new(),
            tags_cache: DashMap::new(),
            hidden_sessions: DashMap::new(),
            last_mobile_ping: AtomicU64::new(0),
            last_desktop_ping: AtomicU64::new(0),
            push_subscriptions: DashMap::new(),
            vapid_private_pem,
            vapid_public_base64,
            history_cache: RwLock::new(None),
            history_dirty: AtomicBool::new(false),
            usage_cache: Mutex::new(None),
            history_tx,
            session_tx,
            status_tx,
            url_tx,
        })
    }

    pub fn invalidate_history_cache(&self) {
        self.history_dirty.store(true, Ordering::Release);
    }

    pub fn set_session_status(&self, id: &str, status: SessionStatus, pane_id: Option<String>, zellij_session: Option<String>) {
        match &status {
            None => {
                self.session_statuses.remove(id);
                self.session_panes.remove(id);
            }
            Some(_) => {
                self.session_statuses.insert(id.to_string(), status.clone());
                if let Some(pane) = pane_id {
                    self.session_panes.insert(id.to_string(), (pane, zellij_session, true));
                }
            }
        }
        let _ = self.status_tx.send((id.to_string(), status));
    }

    pub fn get_session_status(&self, id: &str) -> SessionStatus {
        self.session_statuses
            .get(id)
            .map(|v| v.value().clone())
            .unwrap_or(None)
    }

    pub fn get_session_pane(&self, id: &str) -> Option<(String, Option<String>, bool)> {
        self.session_panes.get(id).map(|v| v.value().clone())
    }
}
