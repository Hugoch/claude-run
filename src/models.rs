use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub display: String,
    pub timestamp: f64,
    pub project: String,
    #[serde(rename = "sessionId", skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SessionStatusValue {
    Active,
    Responding,
    Notification,
    Permission,
    Compacting,
}

pub type SessionStatus = Option<SessionStatusValue>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub display: String,
    pub timestamp: f64,
    pub last_activity: f64,
    pub project: String,
    pub project_name: String,
    pub message_count: usize,
    pub status: SessionStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pane_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pane_verified: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zellij_session: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub question_data: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slug: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenUsage {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_creation_input_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_read_input_tokens: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentBlock {
    #[serde(rename = "type")]
    pub block_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_use_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<ContentBlockContent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_error: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ContentBlockContent {
    Text(String),
    Blocks(Vec<ContentBlock>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum MessageContent {
    Text(String),
    Blocks(Vec<ContentBlock>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageBody {
    pub role: Option<String>,
    pub content: Option<MessageContent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<TokenUsage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationMessage {
    #[serde(rename = "type")]
    pub msg_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uuid: Option<String>,
    #[serde(rename = "parentUuid", skip_serializing_if = "Option::is_none")]
    pub parent_uuid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
    #[serde(rename = "sessionId", skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<MessageBody>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    // Preserve all other fields for faithful round-tripping
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubagentInfo {
    pub agent_id: String,
    pub tool_use_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanSessionInfo {
    pub tool_use_id: String,
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamResult {
    pub messages: Vec<ConversationMessage>,
    pub next_offset: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaginatedResult {
    pub messages: Vec<ConversationMessage>,
    /// Byte offset where these messages start (use to load older)
    pub start_offset: u64,
    /// Byte offset after last message (use for SSE updates)
    pub end_offset: u64,
    /// True if there are older messages before start_offset
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub message_index: usize,
    pub text: String,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub session_id: String,
    pub display: String,
    pub project_name: String,
    pub timestamp: f64,
    pub matches: Vec<SearchMatch>,
}

// Raw JSON line struct for subagent detection
#[derive(Debug, Deserialize)]
pub struct RawJsonLine {
    #[serde(rename = "type")]
    pub msg_type: Option<String>,
    pub data: Option<AgentProgressData>,
    #[serde(rename = "parentToolUseID")]
    pub parent_tool_use_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AgentProgressData {
    #[serde(rename = "type")]
    pub data_type: Option<String>,
    #[serde(rename = "agentId")]
    pub agent_id: Option<String>,
}

// API request/response types
#[derive(Debug, Deserialize)]
pub struct StatusUpdateRequest {
    pub event: String,
    pub pane_id: Option<String>,
    pub zellij_session: Option<String>,
    pub tool_name: Option<String>,
    pub notification_type: Option<String>,
    pub tool_input: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct SearchRequest {
    pub query: String,
}

#[derive(Debug, Deserialize)]
pub struct SendMessageRequest {
    pub message: String,
}

#[derive(Debug, Deserialize)]
pub struct SendKeysRequest {
    pub keys: Vec<Vec<u8>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnswerQuestionRequest {
    pub option_index: Option<usize>,
    pub text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageResponse {
    pub five_hour_pct: f64,
    pub seven_day_pct: f64,
    pub resets_at: Option<String>,
    pub seven_day_resets_at: Option<String>,
    pub extra_usage_cents: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchRequest {
    pub project: Option<String>,
    pub prompt: Option<String>,
    pub model: Option<String>,
    pub target_tab_id: Option<u64>,
    pub dangerously_skip_permissions: Option<bool>,
    pub zellij_session: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushSubscription {
    pub endpoint: String,
    pub keys: PushSubscriptionKeys,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushSubscriptionKeys {
    pub p256dh: String,
    pub auth: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResurrectRequest {
    pub project: String,
    pub target_tab_id: Option<u64>,
    pub dangerously_skip_permissions: Option<bool>,
    pub zellij_session: Option<String>,
}
