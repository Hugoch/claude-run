export type SessionStatus =
  | "active"
  | "responding"
  | "notification"
  | "permission"
  | "compacting"
  | null;

export interface Session {
  id: string;
  display: string;
  timestamp: number;
  lastActivity: number;
  project: string;
  projectName: string;
  messageCount: number;
  status: SessionStatus;
  paneId?: string;
  paneVerified?: boolean;
  zellijSession?: string;
  permissionMessage?: string;
  questionData?: unknown;
  slug?: string;
  gitBranch?: string;
  summary?: string;
  fileSize?: number;
}

export interface ConversationMessage {
  type: "user" | "assistant" | "summary" | "file-history-snapshot";
  uuid?: string;
  parentUuid?: string;
  timestamp?: string;
  sessionId?: string;
  message?: {
    role: string;
    content: string | ContentBlock[];
    model?: string;
    usage?: TokenUsage;
  };
  summary?: string;
}

export interface ContentBlock {
  type: "text" | "thinking" | "tool_use" | "tool_result";
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string | ContentBlock[];
  is_error?: boolean;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface SubagentInfo {
  agentId: string;
  toolUseId: string;
}

export interface PlanSessionInfo {
  toolUseId: string;
  sessionId: string;
}

export interface SearchResult {
  sessionId: string;
  display: string;
  projectName: string;
  timestamp: number;
  matches: SearchMatch[];
}

export interface SearchMatch {
  messageIndex: number;
  text: string;
  snippet: string;
}
