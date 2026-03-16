import { useState, useRef, useCallback, useEffect, useMemo, memo } from "react";
import type { ConversationMessage, ContentBlock } from "@claude-run/api";
import {
  Wrench,
  Check,
  X,
  Terminal,
  Search,
  Pencil,
  FolderOpen,
  Globe,
  MessageSquare,
  ListTodo,
  FilePlus2,
  FileCode,
  GitBranch,
  Database,
  HardDrive,
  Bot,
  ShieldX,
  FileCode2,
  Scissors,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleCheck,
  CircleX,
  Loader2,
  Square,
} from "lucide-react";
import { sanitizeText } from "../utils";
import { ShareButton } from "./share-button";
import { TtsButton } from "./tts-button";
import { Message, MessageContent, MessageResponse } from "./ai-elements/message";
import { Reasoning, ReasoningTrigger, ReasoningContent } from "./ai-elements/reasoning";
import {
  TodoRenderer,
  EditRenderer,
  WriteRenderer,
  BashRenderer,
  BashResultRenderer,
  GrepRenderer,
  GlobRenderer,
  SearchResultRenderer,
  ReadRenderer,
  FileContentRenderer,
  AskQuestionRenderer,
  TaskRenderer,
} from "./tool-renderers";

const PROSE_CLASSES = "prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0";

const RESIZE_SCRIPT = '<script>new ResizeObserver(function(){parent.postMessage({t:"r",h:document.documentElement.scrollHeight},"*")}).observe(document.documentElement)</script>';

function HtmlPreviewBlock({ html }: { html: string }) {
  const [view, setView] = useState<"preview" | "source">("preview");
  const [height, setHeight] = useState(200);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.t === "r" && e.source === iframeRef.current?.contentWindow) {
        setHeight(Math.max(100, e.data.h));
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const srcDoc = html.replace("</body>", RESIZE_SCRIPT + "</body>");

  return (
    <div className="my-3 rounded-xl border border-border overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 border-b border-border">
        <div className="flex items-center gap-0.5 bg-muted rounded p-0.5">
          <button
            onClick={() => setView("preview")}
            className={`px-2 py-0.5 rounded text-[10px] transition-colors cursor-pointer ${
              view === "preview" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >Preview</button>
          <button
            onClick={() => setView("source")}
            className={`px-2 py-0.5 rounded text-[10px] transition-colors cursor-pointer ${
              view === "source" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >Source</button>
        </div>
      </div>
      {view === "preview" ? (
        <iframe ref={iframeRef} sandbox="allow-scripts" srcDoc={srcDoc} className="w-full border-0" style={{ height }} />
      ) : (
        <pre className="text-xs font-mono p-3 overflow-x-auto max-h-[400px] overflow-y-auto text-foreground">{html}</pre>
      )}
    </div>
  );
}

function resolveImageSrc(raw: string): string {
  const s = raw.trim();
  if (s.startsWith("file:///")) {
    return `/api/image?path=${encodeURIComponent(s.slice(7))}`;
  }
  if (s.startsWith("/") && !s.startsWith("/api/")) {
    return `/api/image?path=${encodeURIComponent(s)}`;
  }
  return s;
}

function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const imgRef = useRef<HTMLImageElement>(null);
  const stateRef = useRef({ scale: 1, x: 0, y: 0, startDist: 0, startScale: 1, startX: 0, startY: 0, startTouchX: 0, startTouchY: 0, panning: false });

  const apply = useCallback(() => {
    const img = imgRef.current;
    const s = stateRef.current;
    if (img) img.style.transform = `translate(${s.x}px, ${s.y}px) scale(${s.scale})`;
  }, []);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const s = stateRef.current;
    if (e.touches.length === 2) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      s.startDist = Math.hypot(dx, dy);
      s.startScale = s.scale;
    } else if (e.touches.length === 1 && s.scale > 1) {
      s.panning = true;
      s.startTouchX = e.touches[0].clientX;
      s.startTouchY = e.touches[0].clientY;
      s.startX = s.x;
      s.startY = s.y;
    }
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    const s = stateRef.current;
    if (e.touches.length === 2) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      s.scale = Math.max(1, Math.min(10, s.startScale * (dist / s.startDist)));
      apply();
    } else if (e.touches.length === 1 && s.panning) {
      s.x = s.startX + (e.touches[0].clientX - s.startTouchX);
      s.y = s.startY + (e.touches[0].clientY - s.startTouchY);
      apply();
    }
  }, [apply]);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    const s = stateRef.current;
    s.panning = false;
    if (s.scale <= 1) {
      s.scale = 1;
      s.x = 0;
      s.y = 0;
      apply();
    }
  }, [apply]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={onClose}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={{ touchAction: "none" }}
    >
      <img
        ref={imgRef}
        src={src}
        alt=""
        className="max-w-[95vw] max-h-[95vh] object-contain"
        style={{ transformOrigin: "center center" }}
        onClick={(e) => e.stopPropagation()}
        draggable={false}
      />
    </div>
  );
}

function ImagePreviewBlock({ src }: { src: string }) {
  const [open, setOpen] = useState(false);
  const url = resolveImageSrc(src);

  return (
    <>
      <div className="my-3 rounded-xl border border-border overflow-hidden max-h-[600px] cursor-zoom-in" onClick={() => setOpen(true)}>
        <img src={url} alt="" className="w-full h-auto object-contain bg-black/5 dark:bg-white/5" loading="lazy" />
      </div>
      {open && <ImageLightbox src={url} onClose={() => setOpen(false)} />}
    </>
  );
}

type Segment =
  | { type: "text"; content: string }
  | { type: "html"; content: string }
  | { type: "img"; content: string };

function RichMessageResponse({ children }: { children: string }) {
  const segments = useMemo(() => {
    const parts: Segment[] = [];
    let lastIndex = 0;
    const regex = /```(html|img):preview\n([\s\S]*?)```/g;
    let match;
    while ((match = regex.exec(children)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ type: "text", content: children.slice(lastIndex, match.index) });
      }
      parts.push({ type: match[1] as "html" | "img", content: match[2].trim() });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < children.length) {
      parts.push({ type: "text", content: children.slice(lastIndex) });
    }
    return parts;
  }, [children]);

  if (segments.length === 1 && segments[0].type === "text") {
    return <MessageResponse>{children}</MessageResponse>;
  }

  return (
    <>
      {segments.map((seg, i) =>
        seg.type === "text" ? (
          <MessageResponse key={i}>{seg.content}</MessageResponse>
        ) : seg.type === "html" ? (
          <HtmlPreviewBlock key={i} html={seg.content} />
        ) : (
          <ImagePreviewBlock key={i} src={seg.content} />
        )
      )}
    </>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  const remainSec = Math.round(sec % 60);
  return `${min}m${remainSec > 0 ? `${remainSec}s` : ""}`;
}


interface MessageBlockProps {
  message: ConversationMessage;
  sessionId?: string;
  subagentMap?: Map<string, string>;

  onNavigateSession?: (sessionId: string) => void;
  onOpenFile?: (filePath: string) => void;
  questionPending?: boolean;
  taskNotifications?: Map<string, { status: string; summary: string; toolUseId?: string }>;
  toolResultMap?: Map<string, { content: string; isError: boolean }>;
  taskSubjects?: Map<string, string>;
  highlightedTaskId?: string | null;
  onHighlightTask?: (taskId: string | null) => void;
  toolDurationMap?: Map<string, number>;
}

function buildToolMap(content: ContentBlock[]): Map<string, string> {
  const toolMap = new Map<string, string>();
  for (const block of content) {
    if (block.type === "tool_use" && block.id && block.name) {
      toolMap.set(block.id, block.name);
    }
  }
  return toolMap;
}

interface TaskNotificationData {
  taskId?: string;
  toolUseId?: string;
  status: string;
  summary: string;
}

function parseTaskNotification(raw: string): TaskNotificationData | null {
  const match = raw.match(/<task-notification>([\s\S]*?)<\/task-notification>/);
  if (!match) return null;
  const inner = match[1];
  const taskId = inner.match(/<task-id>(.*?)<\/task-id>/)?.[1] || undefined;
  const status = inner.match(/<status>(.*?)<\/status>/)?.[1] || "";
  const summary = inner.match(/<summary>(.*?)<\/summary>/)?.[1] || "";
  return { taskId, status, summary };
}

function TaskNotificationPill({ data }: { data: TaskNotificationData }) {
  const failed = data.status === "failed" || data.status === "killed";
  const handleClick = () => {
    if (!data.taskId) return;
    // Try to scroll to the tool_use first, fallback to tool_result
    const toolUseId = data.toolUseId;
    const el = toolUseId
      ? document.querySelector(`[data-tool-use-id="${toolUseId}"]`)
      : document.querySelector(`[data-bg-task-id="${data.taskId}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("highlight-flash");
    setTimeout(() => el.classList.remove("highlight-flash"), 2000);
  };
  return (
    <div
      onClick={handleClick}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] border ${
        data.taskId ? "cursor-pointer" : ""
      } ${
        failed
          ? "bg-secondary text-red-600 border-border"
          : "bg-secondary text-green-600 border-border"
      }`}
    >
      {failed ? <CircleX size={12} className="opacity-70" /> : <CircleCheck size={12} className="opacity-70" />}
      <span className="font-medium">{data.summary}</span>
    </div>
  );
}

function PlanImplementationMessage({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="flex justify-end min-w-0">
      <div className={expanded ? "max-w-[85%] min-w-0 w-full" : ""}>
        <button
          onClick={() => setExpanded(!expanded)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-secondary hover:bg-accent text-[11px] text-muted-foreground transition-colors border border-border cursor-pointer"
        >
          <FileCode2 size={12} className="opacity-70" />
          <span className="font-medium">Plan implementation</span>
          <span className="text-[10px] opacity-40 ml-0.5">{expanded ? "▼" : "▶"}</span>
        </button>
        {expanded && (
          <div className="mt-2 rounded-lg border border-border bg-card/80 p-3">
            <div className={PROSE_CLASSES}>
              <MessageResponse>{text}</MessageResponse>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CompactMessage({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="w-full">
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-border" />
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] text-muted-foreground bg-muted/60 hover:bg-muted border border-border transition-colors cursor-pointer"
        >
          <Scissors size={11} className="text-muted-foreground" />
          <span>Context compacted</span>
          {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </button>
        <div className="flex-1 h-px bg-border" />
      </div>
      {expanded && (
        <div className="mt-2 bg-card/80 border border-border rounded-lg p-3 text-muted-foreground">
          <div className={PROSE_CLASSES}>
            <MessageResponse>{text}</MessageResponse>
          </div>
        </div>
      )}
    </div>
  );
}

const MessageBlock = memo(function MessageBlock(props: MessageBlockProps) {
  const { message, sessionId, subagentMap, onNavigateSession, onOpenFile, questionPending, taskNotifications, toolResultMap, taskSubjects, highlightedTaskId, onHighlightTask, toolDurationMap } = props;

  const isUser = message.type === "user";
  const content = message.message?.content;

  const getTextBlocks = (): ContentBlock[] => {
    if (!content || typeof content === "string") {
      return [];
    }
    return content.filter((b) => b.type === "text");
  };

  const getToolBlocks = (): ContentBlock[] => {
    if (!content || typeof content === "string") {
      return [];
    }
    return content.filter(
      (b) =>
        b.type === "tool_use" || b.type === "tool_result" || b.type === "thinking"
    );
  };

  const getVisibleTextBlocks = (): ContentBlock[] => {
    return getTextBlocks().filter(
      (b) => b.text && sanitizeText(b.text).length > 0
    );
  };

  const hasVisibleText = (): boolean => {
    if (typeof content === "string") {
      return sanitizeText(content).length > 0;
    }
    return getVisibleTextBlocks().length > 0;
  };

  const toolBlocks = getToolBlocks();
  const visibleTextBlocks = getVisibleTextBlocks();
  const hasText = hasVisibleText();
  const hasTools = toolBlocks.length > 0;

  const toolMap = Array.isArray(content) ? buildToolMap(content) : new Map<string, string>();

  if (!hasText && hasTools) {
    return (
      <div className="flex flex-col gap-1 empty:hidden">
        {toolBlocks.map((block, index) => (
          <ContentBlockRenderer key={index} block={block} toolMap={toolMap} sessionId={sessionId} subagentMap={subagentMap} onNavigateSession={onNavigateSession} onOpenFile={onOpenFile} questionPending={questionPending} taskNotifications={taskNotifications} toolResultMap={toolResultMap} taskSubjects={taskSubjects} highlightedTaskId={highlightedTaskId} onHighlightTask={onHighlightTask} toolDurationMap={toolDurationMap} />
        ))}
      </div>
    );
  }

  // Get raw (unsanitized) text for special message detection
  const rawText = useMemo(() => {
    if (!isUser) return null;
    if (typeof content === "string") return content;
    const blocks = Array.isArray(content) ? content.filter((b) => b.type === "text" && b.text) : [];
    return blocks.map((b) => b.text || "").join("\n");
  }, [isUser, content]);

  // Detect task notification (before hasText check — sanitizeText strips these)
  const taskNotification = useMemo(() => {
    if (!rawText) return null;
    const parsed = parseTaskNotification(rawText);
    if (!parsed) return null;
    // Enrich with toolUseId from taskNotifications map
    if (parsed.taskId && taskNotifications) {
      const enriched = taskNotifications.get(parsed.taskId);
      if (enriched?.toolUseId) parsed.toolUseId = enriched.toolUseId;
    }
    return parsed;
  }, [rawText, taskNotifications]);

  if (taskNotification) {
    // Hide standalone notification if it's attached to a parent tool_use (shown there instead)
    if (taskNotification.toolUseId) return null;
    return <TaskNotificationPill data={taskNotification} />;
  }

  // Detect context compaction message
  if (rawText?.startsWith("This session is being continued from a previous conversation")) {
    return <CompactMessage text={rawText} />;
  }

  // Detect user bash command (! command)
  const bashInput = rawText?.match(/^<bash-input>([\s\S]*?)<\/bash-input>$/);
  if (bashInput) {
    return (
      <div className="flex justify-end min-w-0">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] bg-muted/40 text-foreground border border-border">
          <Terminal size={12} className="opacity-60" />
          <span className="font-mono">{bashInput[1]}</span>
        </div>
      </div>
    );
  }

  // Detect bash output (stdout/stderr from ! command)
  const bashOutput = rawText?.match(/^<bash-stdout>([\s\S]*?)<\/bash-stdout><bash-stderr>([\s\S]*?)<\/bash-stderr>$/);
  if (bashOutput) {
    const stdout = bashOutput[1];
    const stderr = bashOutput[2];
    const output = (stdout + stderr).trim();
    if (!output) return null;
    return (
      <BashResultRenderer content={output} isError={!!stderr.trim() && !stdout.trim()} />
    );
  }

  // Hide claude-run bootstrap message
  if (rawText?.includes("** Session started from claude-run **")) {
    return null;
  }

  // Detect user interrupt
  if (isUser && rawText?.includes("[Request interrupted by user]")) {
    return (
      <div className="flex justify-end min-w-0">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] bg-secondary text-muted-foreground border border-border">
          <Square size={12} className="opacity-70" />
          <span className="font-medium">Interrupted</span>
        </div>
      </div>
    );
  }

  // Detect plan implementation prompt
  if (isUser && rawText) {
    const sanitizedRaw = sanitizeText(rawText);
    if (sanitizedRaw.startsWith("Implement the following plan:")) {
      return <PlanImplementationMessage text={sanitizedRaw} />;
    }
  }

  if (!hasText && !hasTools) {
    return null;
  }

  return (
    <div className="min-w-0">
      <Message from={isUser ? "user" : "assistant"}>
        <MessageContent>
          {typeof content === "string" ? (
            isUser ? (
              <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">
                {sanitizeText(content)}
              </div>
            ) : (
              <MessageResponse>{sanitizeText(content)}</MessageResponse>
            )
          ) : (
            <div className="flex flex-col gap-1">
              {visibleTextBlocks.map((block, index) => (
                <ContentBlockRenderer key={index} block={block} isUser={isUser} toolMap={toolMap} sessionId={sessionId} subagentMap={subagentMap} onNavigateSession={onNavigateSession} onOpenFile={onOpenFile} questionPending={questionPending} taskNotifications={taskNotifications} toolResultMap={toolResultMap} taskSubjects={taskSubjects} highlightedTaskId={highlightedTaskId} onHighlightTask={onHighlightTask} toolDurationMap={toolDurationMap} />
              ))}
            </div>
          )}
        </MessageContent>
      </Message>

      {!isUser && (() => {
        const plainText = typeof content === "string"
          ? content
          : (Array.isArray(content) ? content.filter((b) => b.type === "text" && b.text).map((b) => b.text).join("\n") : "");
        return plainText.trim() ? (
          <div className="flex justify-start gap-0.5 mt-0.5">
            <TtsButton text={plainText} />
            <ShareButton text={plainText} />
          </div>
        ) : null;
      })()}

      {hasTools && (
        <div className="flex flex-col gap-1 mt-1 empty:hidden">
          {toolBlocks.map((block, index) => (
            <ContentBlockRenderer key={index} block={block} toolMap={toolMap} sessionId={sessionId} subagentMap={subagentMap} onNavigateSession={onNavigateSession} onOpenFile={onOpenFile} questionPending={questionPending} taskNotifications={taskNotifications} toolResultMap={toolResultMap} taskSubjects={taskSubjects} highlightedTaskId={highlightedTaskId} onHighlightTask={onHighlightTask} toolDurationMap={toolDurationMap} />
          ))}
        </div>
      )}
    </div>
  );
});

interface ContentBlockRendererProps {
  block: ContentBlock;
  isUser?: boolean;
  toolMap?: Map<string, string>;
  sessionId?: string;
  subagentMap?: Map<string, string>;

  onNavigateSession?: (sessionId: string) => void;
  onOpenFile?: (filePath: string) => void;
  questionPending?: boolean;
  taskNotifications?: Map<string, { status: string; summary: string; toolUseId?: string }>;
  toolResultMap?: Map<string, { content: string; isError: boolean }>;
  taskSubjects?: Map<string, string>;
  highlightedTaskId?: string | null;
  onHighlightTask?: (taskId: string | null) => void;
  toolDurationMap?: Map<string, number>;
}

const TOOL_ICONS: Record<string, typeof Wrench> = {
  todowrite: ListTodo,
  read: FileCode,
  bash: Terminal,
  grep: Search,
  edit: Pencil,
  write: FilePlus2,
  glob: FolderOpen,
  task: Bot,
};

const TOOL_ICON_PATTERNS: Array<{ patterns: string[]; icon: typeof Wrench }> = [
  { patterns: ["web", "fetch", "url"], icon: Globe },
  { patterns: ["ask", "question"], icon: MessageSquare },
  { patterns: ["git", "commit"], icon: GitBranch },
  { patterns: ["sql", "database", "query"], icon: Database },
  { patterns: ["file", "disk"], icon: HardDrive },
];

function getToolIcon(toolName: string) {
  const name = toolName.toLowerCase();

  if (TOOL_ICONS[name]) {
    return TOOL_ICONS[name];
  }

  for (const { patterns, icon } of TOOL_ICON_PATTERNS) {
    if (patterns.some((p) => name.includes(p))) {
      return icon;
    }
  }

  return Wrench;
}

function getFilePathPreview(filePath: string): string {
  const parts = filePath.split("/");
  return parts.slice(-2).join("/");
}

type PreviewHandler = (input: Record<string, unknown>) => string | null;

const TOOL_PREVIEW_HANDLERS: Record<string, PreviewHandler> = {
  read: (input) => input.file_path ? getFilePathPreview(String(input.file_path)) : null,
  edit: (input) => input.file_path ? getFilePathPreview(String(input.file_path)) : null,
  write: (input) => input.file_path ? getFilePathPreview(String(input.file_path)) : null,
  bash: (input) => {
    if (!input.command) {
      return null;
    }
    const cmd = String(input.command);
    return cmd.length > 50 ? cmd.slice(0, 50) + "..." : cmd;
  },
  grep: (input) => input.pattern ? `"${String(input.pattern)}"` : null,
  glob: (input) => input.pattern ? String(input.pattern) : null,
  task: (input) => input.description ? String(input.description) : null,
};

function getToolPreview(toolName: string, input: Record<string, unknown> | undefined): string | null {
  if (!input) {
    return null;
  }

  const name = toolName.toLowerCase();
  const handler = TOOL_PREVIEW_HANDLERS[name];

  if (handler) {
    return handler(input);
  }

  if (name.includes("web") && input.url) {
    try {
      const url = new URL(String(input.url));
      return url.hostname;
    } catch {
      return String(input.url).slice(0, 30);
    }
  }

  return null;
}

interface ToolInputRendererProps {
  toolName: string;
  input: Record<string, unknown>;
  sessionId?: string;
  agentId?: string;
  status?: "done" | "error";
  duration?: number;
  onOpenFile?: (filePath: string) => void;
}

function ToolInputRenderer(props: ToolInputRendererProps) {
  const { toolName, input, sessionId, agentId, status, duration, onOpenFile } = props;
  const name = toolName.toLowerCase();

  if (name === "todowrite" && input.todos) {
    return <TodoRenderer todos={input.todos as Array<{ content: string; status: "pending" | "in_progress" | "completed" }>} />;
  }

  if (name === "edit" && input.file_path) {
    return <EditRenderer input={input as { file_path: string; old_string: string; new_string: string }} onOpenFile={onOpenFile} />;
  }

  if (name === "write" && input.file_path) {
    return <WriteRenderer input={input as { file_path: string; content: string }} onOpenFile={onOpenFile} />;
  }

  if (name === "bash" && input.command) {
    return <BashRenderer input={input as { command: string; description?: string }} />;
  }

  if (name === "grep" && input.pattern) {
    return <GrepRenderer input={input as { pattern: string; path?: string; glob?: string; type?: string }} />;
  }

  if (name === "glob" && input.pattern) {
    return <GlobRenderer input={input as { pattern: string; path?: string }} />;
  }

  if (name === "read" && input.file_path) {
    return <ReadRenderer input={input as { file_path: string; offset?: number; limit?: number }} onOpenFile={onOpenFile} />;
  }

  if (name === "askuserquestion" && input.questions) {
    return <AskQuestionRenderer input={input as { questions: Array<{ header: string; question: string; options: Array<{ label: string; description: string }>; multiSelect: boolean }> }} />;
  }

  if (name === "task" && input.prompt) {
    return <TaskRenderer input={input as { description: string; prompt: string; subagent_type: string; model?: string; run_in_background?: boolean; resume?: string }} sessionId={sessionId} agentId={agentId} status={status} duration={duration} />;
  }

  return (
    <pre className="text-xs text-foreground/80 bg-card border border-border rounded-lg p-3 mt-2 overflow-x-auto whitespace-pre-wrap break-all">
      {JSON.stringify(input, null, 2)}
    </pre>
  );
}

interface ToolResultRendererProps {
  toolName: string;
  content: string;
  isError?: boolean;
}

function ToolResultRenderer(props: ToolResultRendererProps) {
  const { toolName, content, isError } = props;
  const name = toolName.toLowerCase();

  if (name === "bash") {
    return <BashResultRenderer content={content} isError={isError} />;
  }

  if (name === "glob") {
    return <SearchResultRenderer content={content} isFileList />;
  }

  if (name === "grep") {
    return <SearchResultRenderer content={content} />;
  }

  if (name === "read") {
    return <FileContentRenderer content={content} />;
  }

  if (!content || content.trim().length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-card border border-border rounded-lg mt-2">
        <Check size={14} className="text-green-600" />
        <span className="text-xs text-muted-foreground">Completed successfully</span>
      </div>
    );
  }

  const maxLength = 2000;
  const truncated = content.length > maxLength;
  const displayContent = truncated ? content.slice(0, maxLength) : content;

  return (
    <pre
      className={`text-xs rounded-lg p-3 mt-2 overflow-x-auto whitespace-pre-wrap break-all border ${
        isError
          ? "bg-destructive/10 text-foreground/80 border-destructive/20"
          : "bg-card text-foreground/80 border-border"
      }`}
    >
      {displayContent}
      {truncated && <span className="text-muted-foreground">... ({content.length - maxLength} more chars)</span>}
    </pre>
  );
}

function ContentBlockRenderer(props: ContentBlockRendererProps) {
  const { block, isUser, toolMap, sessionId, subagentMap, onNavigateSession, onOpenFile, questionPending, taskNotifications, toolResultMap, taskSubjects, highlightedTaskId, onHighlightTask, toolDurationMap } = props;
  const [expanded, setExpanded] = useState(false);

  if (block.type === "text" && block.text) {
    const sanitized = sanitizeText(block.text);
    if (!sanitized) {
      return null;
    }

    // Collapse skill prompt content (injected as a large user text block)
    const skillMatch = sanitized.match(/^Base directory for this skill:\s*\S+\s*\n+#\s+(.+)/);
    if (skillMatch) {
      return (
        <div className={expanded ? "w-full" : ""}>
          <button
            onClick={() => setExpanded(!expanded)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-secondary hover:bg-accent text-[11px] text-muted-foreground transition-colors border border-border cursor-pointer"
          >
            <Wrench size={12} className="opacity-70" />
            <span className="font-medium">Skill: {skillMatch[1]}</span>
            <span className="text-[10px] opacity-40 ml-0.5">{expanded ? "▼" : "▶"}</span>
          </button>
          {expanded && (
            <div className="mt-2 rounded-lg border border-border bg-card/80 p-3">
              <div className={PROSE_CLASSES}>
                <MessageResponse>{sanitized}</MessageResponse>
              </div>
            </div>
          )}
        </div>
      );
    }

    // Collapse plan implementation prompts
    const planMatch = sanitized.match(/^Implement the following plan:/);
    if (planMatch) {
      return (
        <div className={expanded ? "w-full" : ""}>
          <button
            onClick={() => setExpanded(!expanded)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-secondary hover:bg-accent text-[11px] text-muted-foreground transition-colors border border-border cursor-pointer"
          >
            <FileCode2 size={12} className="opacity-70" />
            <span className="font-medium">Plan implementation</span>
            <span className="text-[10px] opacity-40 ml-0.5">{expanded ? "▼" : "▶"}</span>
          </button>
          {expanded && (
            <div className="mt-2 rounded-lg border border-border bg-card/80 p-3">
              <div className={PROSE_CLASSES}>
                <MessageResponse>{sanitized}</MessageResponse>
              </div>
            </div>
          )}
        </div>
      );
    }

    if (isUser) {
      return (
        <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">
          {sanitized}
        </div>
      );
    }
    return (
      <RichMessageResponse>{sanitized}</RichMessageResponse>
    );
  }

  if (block.type === "thinking" && block.thinking) {
    return (
      <Reasoning defaultOpen={false}>
        <ReasoningTrigger />
        <ReasoningContent>
          <div className="whitespace-pre-wrap">{block.thinking}</div>
        </ReasoningContent>
      </Reasoning>
    );
  }

  if (block.type === "tool_use") {
    const input =
      block.input && typeof block.input === "object" ? block.input as Record<string, unknown> : undefined;
    const hasInput = input && Object.keys(input).length > 0;
    const Icon = getToolIcon(block.name || "");
    const preview = getToolPreview(block.name || "", input);
    const toolName = block.name?.toLowerCase() || "";

    // Hide AskUserQuestion while the question is pending (live widget handles it)
    if (toolName === "askuserquestion" && questionPending) {
      return null;
    }

    // Hide EnterPlanMode (just a mode transition, no useful content)
    if (toolName === "enterplanmode") {
      return null;
    }

    // ExitPlanMode: render inline plan card
    if (toolName === "exitplanmode" && input) {
      const plan = typeof input.plan === "string" ? input.plan : null;
      const result = block.id && toolResultMap ? toolResultMap.get(block.id) : undefined;
      const approved = result && !result.isError;
      const feedbackMatch = result?.isError && result.content.match(/the user said:\n(.+)/is);
      const feedback = feedbackMatch ? feedbackMatch[1].trim() : null;
      const pendingApproval = !result;
      const showPlan = expanded || pendingApproval;

      return (
        <div className="w-full">
          <button
            onClick={() => setExpanded(!showPlan)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] border cursor-pointer transition-colors ${
              approved
                ? "bg-secondary text-green-600 border-border hover:bg-accent"
                : result?.isError
                  ? "bg-secondary text-red-600 border-border hover:bg-accent"
                  : "bg-secondary text-muted-foreground border-border hover:bg-accent"
            }`}
          >
            <FileCode2 size={12} className="opacity-70" />
            <span className="font-medium">Plan</span>
            {approved && <Check size={12} className="text-green-600" />}
            {feedback && <span className="text-muted-foreground font-normal truncate max-w-[200px]">{feedback}</span>}
            {plan && <span className="text-[10px] opacity-40 ml-0.5">{showPlan ? "▼" : "▶"}</span>}
            {block.id && toolDurationMap?.get(block.id) != null && (
              <span className="text-muted-foreground/60 font-normal ml-0.5">
                {formatDuration(toolDurationMap.get(block.id)!)}
              </span>
            )}
          </button>
          {showPlan && plan && (
            <div className="mt-2 rounded-lg border border-border bg-card/80 p-3 max-h-64 overflow-y-auto">
              <div className={PROSE_CLASSES}>
                <MessageResponse>{plan}</MessageResponse>
              </div>
            </div>
          )}
        </div>
      );
    }

    // Hide background Bash tasks while still running — shown in the bottom bar
    // But keep Task subagents visible inline (they don't appear in the bottom bar)
    const isBgParent = block.id && taskNotifications && [...taskNotifications.values()].some(n => n.toolUseId === block.id);
    if (input?.run_in_background && block.id && !isBgParent && toolName !== "task") {
      return null;
    }

    // Task management tools — show compact status chips
    if (toolName === "tasklist" || toolName === "taskget") {
      return null;
    }
    if (toolName === "taskcreate" && input) {
      const subj = String(input.subject);
      // Reverse lookup: find taskId from subject
      const tid = taskSubjects ? [...taskSubjects.entries()].find(([, s]) => s === subj)?.[0] : undefined;
      const isHighlighted = tid != null && highlightedTaskId === tid;
      return (
        <button
          onClick={() => onHighlightTask?.(isHighlighted ? null : tid ?? null)}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] border cursor-pointer transition-all ${
            isHighlighted
              ? "bg-accent text-foreground border-ring ring-1 ring-ring/30"
              : "bg-secondary text-muted-foreground border-border hover:bg-accent"
          }`}
        >
          <Circle size={12} className="opacity-70" />
          <span className="text-muted-foreground">Created:</span>
          <span className="font-medium">{subj}</span>
        </button>
      );
    }
    if (toolName === "taskupdate" && input) {
      const tid = String(input.taskId);
      const subject = taskSubjects?.get(tid);
      const label = subject || `Task #${tid}`;
      const isHighlighted = highlightedTaskId === tid;
      const toggle = () => onHighlightTask?.(isHighlighted ? null : tid);
      if (input.status === "in_progress") {
        return (
          <button
            onClick={toggle}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] border cursor-pointer transition-all ${
              isHighlighted
                ? "bg-accent text-foreground border-ring ring-1 ring-ring/30"
                : "bg-secondary text-muted-foreground border-border hover:bg-accent"
            }`}
          >
            <Loader2 size={12} className="opacity-70 animate-spin" />
            <span className="text-muted-foreground">In progress:</span>
            <span className="font-medium">{label}</span>
          </button>
        );
      }
      if (input.status === "completed") {
        return (
          <button
            onClick={toggle}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] border cursor-pointer transition-all ${
              isHighlighted
                ? "bg-accent text-foreground border-ring ring-1 ring-ring/30"
                : "bg-secondary text-green-600 border-border hover:bg-accent"
            }`}
          >
            <CircleCheck size={12} className="opacity-70" />
            <span className="text-muted-foreground">Completed:</span>
            <span className="font-medium">{label}</span>
          </button>
        );
      }
      return null;
    }

    const hasSpecialRenderer =
      toolName === "todowrite" ||
      toolName === "edit" ||
      toolName === "write" ||
      toolName === "bash" ||
      toolName === "grep" ||
      toolName === "glob" ||
      toolName === "read" ||
      toolName === "askuserquestion" ||
      toolName === "task";

    const shouldAutoExpand = toolName === "todowrite" || toolName === "askuserquestion" || toolName === "task";
    const isExpanded = expanded || shouldAutoExpand;

    const isBgRunning = !!(input?.run_in_background && block.id && taskNotifications && !taskNotifications.has(
      // Find taskId for this tool_use_id — reverse lookup from taskNotifications
      [...taskNotifications.entries()].find(([, n]) => n.toolUseId === block.id)?.[0] || ""
    ));
    // A bg task that launched but hasn't received its notification yet
    const isBgPending = !!(input?.run_in_background && block.id && !isBgParent);

    // Result status from toolResultMap
    const toolResult = block.id && toolResultMap ? toolResultMap.get(block.id) : undefined;
    // For bg tasks, the notification status determines the dot color, not the immediate tool_result
    const bgNotificationStatus = isBgParent && block.id && taskNotifications
      ? [...taskNotifications.entries()].find(([, n]) => n.toolUseId === block.id)?.[1]
      : undefined;

    const statusDot = isBgPending ? (
      <span className="relative flex h-1.5 w-1.5 shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-muted-foreground opacity-75" />
        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-muted-foreground" />
      </span>
    ) : bgNotificationStatus ? (
      bgNotificationStatus.status === "failed" || bgNotificationStatus.status === "killed" ? (
        <span className="w-1.5 h-1.5 bg-red-600 rounded-full shrink-0" />
      ) : (
        <span className="w-1.5 h-1.5 bg-green-600 rounded-full shrink-0" />
      )
    ) : toolResult ? (
      toolResult.isError ? (
        <span className="w-1.5 h-1.5 bg-red-600 rounded-full shrink-0" />
      ) : (
        <span className="w-1.5 h-1.5 bg-green-600 rounded-full shrink-0" />
      )
    ) : (
      <span className="relative flex h-1.5 w-1.5 shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-muted-foreground opacity-75" />
        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-muted-foreground" />
      </span>
    );

    // Task tools: skip the pill, render TaskRenderer directly with status
    if (shouldAutoExpand && toolName === "task" && hasInput && hasSpecialRenderer) {
      return (
        <div className="w-full" {...(block.id ? { "data-tool-use-id": block.id } : {})}>
          <ToolInputRenderer toolName={block.name || ""} input={input} sessionId={sessionId} agentId={block.id && subagentMap ? subagentMap.get(block.id) : undefined} status={toolResult ? (toolResult.isError ? "error" : "done") : undefined} duration={block.id && toolDurationMap?.get(block.id) != null ? toolDurationMap.get(block.id) : undefined} onOpenFile={onOpenFile} />
        </div>
      );
    }

    return (
      <div className={isExpanded ? "w-full" : ""} {...(block.id ? { "data-tool-use-id": block.id } : {})}>
        <button
          onClick={() => !shouldAutoExpand && setExpanded(!expanded)}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] transition-colors border cursor-pointer ${
            toolResult
              ? toolResult.isError
                ? "bg-secondary hover:bg-accent text-foreground border-border"
                : "bg-secondary hover:bg-accent text-foreground border-border"
              : "bg-secondary hover:bg-accent text-foreground border-border"
          }`}
        >
          {statusDot}
          <Icon size={12} className="opacity-60" />
          <span className="font-medium text-foreground">{block.name}</span>
          {preview && !bgNotificationStatus && (
            <span className="text-muted-foreground font-normal truncate max-w-[200px]">
              {preview}
            </span>
          )}
          {bgNotificationStatus && (
            <span className="text-muted-foreground font-normal truncate max-w-[300px]">
              {bgNotificationStatus.summary}
            </span>
          )}
          {block.id && toolDurationMap?.get(block.id) != null && (
            <span className="text-muted-foreground/60 font-normal ml-0.5">
              {formatDuration(toolDurationMap.get(block.id)!)}
            </span>
          )}
          {!shouldAutoExpand && (
            <span className="text-[10px] opacity-40 ml-0.5">
              {expanded ? "▼" : "▶"}
            </span>
          )}
        </button>
        {isExpanded && hasInput && hasSpecialRenderer ? (
          <ToolInputRenderer toolName={block.name || ""} input={input} sessionId={sessionId} agentId={block.id && subagentMap ? subagentMap.get(block.id) : undefined} onOpenFile={onOpenFile} />
        ) : (
          expanded &&
          hasInput && (
            <pre className="text-xs text-foreground/80 bg-card border border-border rounded-lg p-3 mt-2 overflow-x-auto whitespace-pre-wrap break-all">
              {JSON.stringify(input, null, 2)}
            </pre>
          )
        )}
        {expanded && toolResult && (
          <ToolResultRenderer toolName={block.name || ""} content={sanitizeText(toolResult.content)} isError={toolResult.isError} />
        )}
      </div>
    );
  }

  if (block.type === "tool_result") {
    const isError = block.is_error;
    const rawContent =
      typeof block.content === "string"
        ? block.content
        : JSON.stringify(block.content, null, 2);
    const resultContent = sanitizeText(rawContent);
    const hasContent = resultContent.length > 0;
    const previewLength = 60;
    const contentPreview =
      hasContent && !expanded
        ? resultContent.slice(0, previewLength) + (resultContent.length > previewLength ? "..." : "")
        : null;

    const toolName = block.tool_use_id && toolMap ? toolMap.get(block.tool_use_id) || "" : "";

    // Hide task management tool results — the sticky TaskListWidget handles display
    const tn = toolName.toLowerCase();
    if (tn === "taskcreate" || tn === "taskupdate" || tn === "tasklist" || tn === "taskget") {
      return null;
    }

    // Hide EnterPlanMode/ExitPlanMode results — handled by the tool_use pill
    if (tn === "enterplanmode" || tn === "exitplanmode") {
      return null;
    }

    // Match background task result and attach notification pill
    const bgMatch = rawContent.match(/Command running in background with ID:\s*([a-z0-9]+)/);
    const bgNotification = bgMatch && taskNotifications?.get(bgMatch[1]);

    // AskUserQuestion result: "User has answered your questions: "Q"="A"..."
    const askMatch = resultContent.match(/^User has answered your questions:\s*(.+?)\.\s*You can now continue/);
    if (askMatch) {
      // Extract all "question"="answer" pairs
      const pairs = [...askMatch[1].matchAll(/"([^"]+)"="([^"]+)"/g)];
      const answers = pairs.map(m => m[2]);
      const answerText = answers.length > 0 ? answers.join(", ") : askMatch[1];
      return (
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] bg-secondary text-foreground border border-border">
          <MessageSquare size={12} className="opacity-70" />
          <span className="font-medium">{answerText}</span>
        </div>
      );
    }

    const isDenied = isError && resultContent.match(/user (denied|rejected|chose not to)/i);
    const isInterrupted = isError && resultContent.match(/doesn't want to proceed|does not want to proceed/i);

    if (isDenied) {
      return (
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] bg-secondary text-red-600 border border-border">
          <ShieldX size={12} className="opacity-70" />
          <span className="font-medium">Denied</span>
        </div>
      );
    }

    if (isInterrupted) {
      return null;
    }

    const resultButton = (
      <button
        onClick={() => hasContent && setExpanded(!expanded)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] transition-colors border ${
          isError
            ? "bg-secondary hover:bg-accent text-red-600 border-border"
            : "bg-secondary hover:bg-accent text-green-600 border-border"
        }`}
      >
        {isError ? (
          <X size={12} className="opacity-70" />
        ) : (
          <Check size={12} className="opacity-70" />
        )}
        <span className="font-medium">{isError ? "error" : "result"}</span>
        {contentPreview && !expanded && (
          <span
            className={`font-normal truncate max-w-[200px] ${isError ? "text-red-600/70" : "text-muted-foreground"}`}
          >
            {contentPreview}
          </span>
        )}
        {hasContent && (
          <span className="text-[10px] opacity-40 ml-0.5">
            {expanded ? "▼" : "▶"}
          </span>
        )}
      </button>
    );

    // Background tasks: hide the tool_result entirely — the tool_use pill handles status
    if (bgMatch) {
      return null;
    }

    // Hide normal results — tool_use pill now shows status dot + result on expand
    if (toolResultMap) {
      return null;
    }

    return (
      <div className={expanded ? "w-full" : ""}>
        {resultButton}
        {expanded && hasContent && (
          <ToolResultRenderer toolName={toolName} content={resultContent} isError={isError} />
        )}
      </div>
    );
  }

  return null;
}

export default MessageBlock;
