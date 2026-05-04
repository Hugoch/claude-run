import {
  useEffect,
  useState,
  useRef,
  useCallback,
  useMemo,
  useLayoutEffect,
} from "react";
import type {
  ConversationMessage,
  Session,
  SubagentInfo,
} from "@claude-run/api";
import {
  SendHorizonal,
  ShieldCheck,
  ShieldX,
  MessageCircleQuestion,
  Loader2,
  CircleCheck,
  CircleX,
  Square,
} from "lucide-react";
import MessageBlock from "./message-block";
import ScrollToBottomButton from "./scroll-to-bottom-button";
import { MarkdownExportButton } from "./markdown-export";
import { TaskListWidget, buildTaskState } from "./task-list-widget";
import { ContextPanel } from "./context-panel";
import { TailPanel } from "./tail-panel";

const SCROLL_THRESHOLD_PX = 100;

const THINKING_VERBS = [
  "Thinking",
  "Processing",
  "Analyzing",
  "Working",
  "Computing",
  "Reasoning",
];

function ThinkingIndicator() {
  const [index, setIndex] = useState(0);
  const [fade, setFade] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setIndex((i) => (i + 1) % THINKING_VERBS.length);
        setFade(true);
      }, 300);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-center gap-2 px-1 py-2">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-muted-foreground opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-muted-foreground" />
      </span>
      <span
        className={`text-[11px] text-muted-foreground font-medium transition-opacity duration-300 ${fade ? "opacity-100" : "opacity-0"}`}
      >
        {THINKING_VERBS[index]}...
      </span>
    </div>
  );
}

interface SessionViewProps {
  sessionId: string;
  session: Session;
  onNavigateSession?: (sessionId: string) => void;
  onOpenFile?: (filePath: string) => void;
  olderSlugSessions?: Session[];
  pendingInsert?: string | null;
  onConsumeInsert?: () => void;
  onResurrect?: () => void;
}

function SessionView(props: SessionViewProps) {
  const {
    sessionId,
    session,
    onNavigateSession,
    onOpenFile,
    olderSlugSessions,
    pendingInsert,
    onConsumeInsert,
    onResurrect,
  } = props;

  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const autoScrollRef = useRef(true);
  const [subagentMap, setSubagentMap] = useState<Map<string, string>>(
    new Map(),
  );
  // Per-session drafts with localStorage persistence
  const draftsRef = useRef<Map<string, string>>(() => {
    try {
      const saved = localStorage.getItem("claude-run-drafts");
      return saved ? new Map(Object.entries(JSON.parse(saved))) : new Map();
    } catch {
      return new Map();
    }
  });
  // Initialize drafts map on first render
  if (typeof draftsRef.current === "function") {
    draftsRef.current = (
      draftsRef.current as unknown as () => Map<string, string>
    )();
  }
  const [inputValue, setInputValue] = useState(
    () => draftsRef.current.get(sessionId) || "",
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Switch draft when session changes
  useEffect(() => {
    setInputValue(draftsRef.current.get(sessionId) || "");
  }, [sessionId]);

  // Save draft on change
  const updateInput = useCallback(
    (value: string) => {
      setInputValue(value);
      if (value.trim()) {
        draftsRef.current.set(sessionId, value);
      } else {
        draftsRef.current.delete(sessionId);
      }
      try {
        localStorage.setItem(
          "claude-run-drafts",
          JSON.stringify(Object.fromEntries(draftsRef.current)),
        );
      } catch {}
    },
    [sessionId],
  );

  // Auto-grow textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 150) + "px";
  }, [inputValue]);

  // Consume pending insert from file panel
  useEffect(() => {
    if (pendingInsert && onConsumeInsert) {
      const prefix =
        inputValue && !inputValue.endsWith(" ") && !inputValue.endsWith("\n")
          ? " "
          : "";
      updateInput(inputValue + prefix + pendingInsert);
      onConsumeInsert();
      textareaRef.current?.focus();
    }
  }, [pendingInsert]);

  const [sending, setSending] = useState(false);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(
    null,
  );
  const [tailTarget, setTailTarget] = useState<{
    filePath: string;
    description: string;
  } | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastMessageRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0); // end offset for SSE updates
  const startOffsetRef = useRef(0); // start offset for loading older
  const isScrollingProgrammaticallyRef = useRef(false);
  const retryCountRef = useRef(0);
  const eventSourceRef = useRef<EventSource | null>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);

  const connectSSE = useCallback(() => {
    if (!mountedRef.current) return;

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const eventSource = new EventSource(
      `/api/conversation/${sessionId}/stream?offset=${offsetRef.current}`,
    );
    eventSourceRef.current = eventSource;

    eventSource.addEventListener("messages", (event) => {
      retryCountRef.current = 0;
      const data = JSON.parse(event.data);
      const newMessages: ConversationMessage[] = data.messages;
      offsetRef.current = data.offset;
      // Clear pending message if a new user message arrived
      if (newMessages.some((m: ConversationMessage) => m.type === "user")) {
        setPendingMessage(null);
      }
      setMessages((prev) => {
        const existingIds = new Set(prev.map((m) => m.uuid).filter(Boolean));
        const unique = newMessages.filter((m) => !existingIds.has(m.uuid));
        if (unique.length === 0) return prev;
        return [...prev, ...unique];
      });
    });

    eventSource.onerror = () => {
      eventSource.close();
      if (!mountedRef.current) return;
      const delay = Math.min(1000 * Math.pow(2, retryCountRef.current), 30000);
      retryCountRef.current++;
      retryTimeoutRef.current = setTimeout(() => connectSSE(), delay);
    };
  }, [sessionId]);

  // Load older messages when scrolling to top
  const loadOlder = useCallback(async () => {
    if (loadingOlder || !hasMore || startOffsetRef.current === 0) return;
    setLoadingOlder(true);

    try {
      const res = await fetch(
        `/api/conversation/${sessionId}/older?before=${startOffsetRef.current}&limit=50`,
      );
      const data = await res.json();
      if (!mountedRef.current) return;

      const olderMessages: ConversationMessage[] = data.messages;
      startOffsetRef.current = data.startOffset;
      setHasMore(data.hasMore);

      if (olderMessages.length > 0) {
        // Preserve scroll position when prepending
        const container = containerRef.current;
        const prevHeight = container?.scrollHeight || 0;

        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.uuid).filter(Boolean));
          const unique = olderMessages.filter((m) => !existingIds.has(m.uuid));
          if (unique.length === 0) return prev;
          return [...unique, ...prev];
        });

        // Restore scroll position after render
        requestAnimationFrame(() => {
          if (container) {
            const newHeight = container.scrollHeight;
            container.scrollTop = newHeight - prevHeight;
          }
        });
      }
    } catch (err) {
      console.error("Failed to load older messages:", err);
    } finally {
      setLoadingOlder(false);
    }
  }, [sessionId, loadingOlder, hasMore]);

  useEffect(() => {
    mountedRef.current = true;
    setLoading(true);
    setMessages([]);
    setSubagentMap(new Map());
    setHasMore(false);
    offsetRef.current = 0;
    startOffsetRef.current = 0;
    retryCountRef.current = 0;
    autoScrollRef.current = true;
    setAutoScroll(true);

    // Fetch subagents
    fetch(`/api/conversation/${sessionId}/subagents`)
      .then((r) => r.json())
      .then((infos: SubagentInfo[]) => {
        if (mountedRef.current) {
          const map = new Map<string, string>();
          for (const info of infos) {
            map.set(info.toolUseId, info.agentId);
          }
          setSubagentMap(map);
        }
      })
      .catch(() => {});

    // Load last N messages first, then connect SSE for updates
    fetch(`/api/conversation/${sessionId}/tail?limit=50`)
      .then((r) => r.json())
      .then((data) => {
        if (!mountedRef.current) return;
        setMessages(data.messages);
        offsetRef.current = data.endOffset;
        startOffsetRef.current = data.startOffset;
        setHasMore(data.hasMore);
        setLoading(false);
        connectSSE();
      })
      .catch(() => {
        if (mountedRef.current) {
          setLoading(false);
          connectSSE();
        }
      });

    return () => {
      mountedRef.current = false;
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [sessionId, connectSSE]);

  // Intersection observer for lazy loading older messages
  useEffect(() => {
    if (!hasMore || loadingOlder) return;
    const sentinel = topSentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadOlder();
        }
      },
      { root: containerRef.current, rootMargin: "200px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadingOlder, loadOlder]);

  const scrollToBottom = useCallback(() => {
    if (!lastMessageRef.current) {
      return;
    }
    isScrollingProgrammaticallyRef.current = true;
    lastMessageRef.current.scrollIntoView({ behavior: "instant" });
    requestAnimationFrame(() => {
      isScrollingProgrammaticallyRef.current = false;
    });
  }, []);

  useEffect(() => {
    if (autoScrollRef.current) {
      scrollToBottom();
    }
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (session.status === "responding" && autoScrollRef.current) {
      scrollToBottom();
    }
  }, [session.status, scrollToBottom]);

  const handleScroll = () => {
    if (!containerRef.current || isScrollingProgrammaticallyRef.current) {
      return;
    }

    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom =
      scrollHeight - scrollTop - clientHeight < SCROLL_THRESHOLD_PX;
    autoScrollRef.current = isAtBottom;
    setAutoScroll(isAtBottom);
  };

  const sendMessage = useCallback(async () => {
    const text = inputValue.trim();
    if (!text || sending || !session.paneId) return;

    setSending(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      if (res.ok) {
        setPendingMessage(text);
        updateInput("");
      }
    } catch (err) {
      console.error("Failed to send message:", err);
    } finally {
      setSending(false);
    }
  }, [inputValue, sending, session.paneId, sessionId]);

  const [permissionBusy, setPermissionBusy] = useState(false);

  const handleAllow = useCallback(async () => {
    if (!session.paneId || permissionBusy) return;
    setPermissionBusy(true);
    try {
      await fetch(`/api/sessions/${sessionId}/keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: [[13]] }),
      });
      await fetch(`/api/sessions/${sessionId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "UserPromptSubmit" }),
      });
    } catch (err) {
      console.error("Failed to send allow:", err);
    } finally {
      setPermissionBusy(false);
    }
  }, [session.paneId, sessionId, permissionBusy]);

  const handleDeny = useCallback(async () => {
    if (!session.paneId || permissionBusy) return;
    setPermissionBusy(true);
    try {
      await fetch(`/api/sessions/${sessionId}/keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: [[27, 91, 66], [27, 91, 66], [13]] }),
      });
      await fetch(`/api/sessions/${sessionId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "Stop" }),
      });
    } catch (err) {
      console.error("Failed to send deny:", err);
    } finally {
      setPermissionBusy(false);
    }
  }, [session.paneId, sessionId, permissionBusy]);

  const handleInterrupt = useCallback(async () => {
    if (!session.paneId) return;
    try {
      await fetch(`/api/sessions/${sessionId}/keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: [[27]] }),
      });
      await fetch(`/api/sessions/${sessionId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "Stop" }),
      });
    } catch (err) {
      console.error("Failed to interrupt:", err);
    }
  }, [session.paneId, sessionId]);

  // Escape key to interrupt responding session
  useEffect(() => {
    if (session.status !== "responding") return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleInterrupt();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [session.status, handleInterrupt]);

  const [answeringQuestion, setAnsweringQuestion] = useState(false);

  const handleAnswerQuestion = useCallback(
    async (optionIndex: number) => {
      if (!session.paneId || answeringQuestion) return;
      setAnsweringQuestion(true);
      try {
        await fetch(`/api/sessions/${sessionId}/answer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ optionIndex }),
        });
      } catch (err) {
        console.error("Failed to answer question:", err);
      } finally {
        setAnsweringQuestion(false);
      }
    },
    [session.paneId, sessionId, answeringQuestion],
  );

  const [questionText, setQuestionText] = useState("");
  const [sendingQuestion, setSendingQuestion] = useState(false);

  const handleAnswerFreeText = useCallback(async () => {
    const text = questionText.trim();
    if (!text || !session.paneId) return;
    setSendingQuestion(true);
    try {
      await fetch(`/api/sessions/${sessionId}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      setQuestionText("");
    } catch (err) {
      console.error("Failed to send free text answer:", err);
    } finally {
      setSendingQuestion(false);
    }
  }, [questionText, session.paneId, sessionId]);

  const summary = messages.find((m) => m.type === "summary");

  // Enrich subagentMap with agentIds from Task tool_results (for background tasks not in backend map)
  const enrichedSubagentMap = useMemo(() => {
    const map = new Map(subagentMap);
    for (const m of messages) {
      if (m.type !== "user") continue;
      const content = m.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (
          block.type !== "tool_result" ||
          !block.tool_use_id ||
          map.has(block.tool_use_id)
        )
          continue;
        // tool_result content can be a string or an array of {type, text} blocks
        const text =
          typeof block.content === "string"
            ? block.content
            : Array.isArray(block.content)
              ? block.content
                  .map((b: { text?: string }) => b.text || "")
                  .join("\n")
              : "";
        const agentMatch = text.match(/agentId:\s*([a-z0-9]+)/);
        if (agentMatch) {
          map.set(block.tool_use_id, agentMatch[1]);
        }
      }
    }
    return map;
  }, [messages, subagentMap]);

  // Build task notification map: taskId → { status, summary, toolUseId }
  const taskNotifications = useMemo(() => {
    const map = new Map<
      string,
      { status: string; summary: string; toolUseId?: string }
    >();

    // First pass: find taskId → toolUseId from tool_results
    const taskToToolUse = new Map<string, string>();
    for (const m of messages) {
      if (m.type !== "user") continue;
      const content = m.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block.type !== "tool_result" || !block.tool_use_id) continue;
        const text =
          typeof block.content === "string"
            ? block.content
            : Array.isArray(block.content)
              ? block.content
                  .map((b: { text?: string }) => b.text || "")
                  .join("\n")
              : "";
        // Bash background tasks: "Command running in background with ID: xxx"
        const bgMatch = text.match(
          /Command running in background with ID:\s*([a-z0-9]+)/,
        );
        if (bgMatch) {
          taskToToolUse.set(bgMatch[1], block.tool_use_id);
        }
        // Task subagents: "agentId: xxx"
        const agentMatch = text.match(/agentId:\s*([a-z0-9]+)/);
        if (agentMatch) {
          taskToToolUse.set(agentMatch[1], block.tool_use_id);
        }
      }
    }

    // Second pass: collect notifications
    for (const m of messages) {
      if (m.type !== "user") continue;
      const content = m.message?.content;
      // XML task-notification in string content
      if (typeof content === "string") {
        const match = content.match(
          /<task-notification>([\s\S]*?)<\/task-notification>/,
        );
        if (!match) continue;
        const taskId = match[1].match(/<task-id>(.*?)<\/task-id>/)?.[1];
        const status = match[1].match(/<status>(.*?)<\/status>/)?.[1] || "";
        const taskSummary =
          match[1].match(/<summary>(.*?)<\/summary>/)?.[1] || "";
        if (taskId)
          map.set(taskId, {
            status,
            summary: taskSummary,
            toolUseId: taskToToolUse.get(taskId),
          });
        continue;
      }
      // TaskStop result in tool_result blocks
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block.type !== "tool_result" || typeof block.content !== "string")
          continue;
        const stopMatch = block.content.match(/"task_id"\s*:\s*"([a-z0-9]+)"/);
        if (stopMatch && block.content.includes("Successfully stopped task")) {
          map.set(stopMatch[1], {
            status: "stopped",
            summary: "Task stopped",
            toolUseId: taskToToolUse.get(stopMatch[1]),
          });
        }
      }
    }
    return map;
  }, [messages]);

  // All background tasks (running + completed/failed)
  const bgTasksRaw = useMemo(() => {
    const taskToToolUse = new Map<string, string>();
    const toolUseDescriptions = new Map<string, string>();

    for (const m of messages) {
      const content = m.message?.content;
      if (m.type === "assistant" && Array.isArray(content)) {
        for (const block of content) {
          if (
            block.type === "tool_use" &&
            block.id &&
            block.input?.description
          ) {
            toolUseDescriptions.set(block.id, block.input.description);
          }
        }
      }
      if (m.type === "user" && Array.isArray(content)) {
        for (const block of content) {
          if (block.type !== "tool_result" || typeof block.content !== "string")
            continue;
          const bgMatch = block.content.match(
            /Command running in background with ID:\s*([a-z0-9]+)/,
          );
          if (bgMatch && block.tool_use_id) {
            taskToToolUse.set(bgMatch[1], block.tool_use_id);
          }
        }
      }
    }

    // Extract output file paths from tool_result content
    const taskOutputFiles = new Map<string, string>();
    for (const m of messages) {
      if (m.type !== "user") continue;
      const content = m.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block.type !== "tool_result" || typeof block.content !== "string")
          continue;
        const bgMatch = block.content.match(
          /Command running in background with ID:\s*([a-z0-9]+)/,
        );
        const fileMatch = block.content.match(
          /Output is being written to:\s*(\S+)/,
        );
        if (bgMatch && fileMatch) {
          taskOutputFiles.set(bgMatch[1], fileMatch[1]);
        }
      }
    }

    const all: {
      taskId: string;
      description: string;
      outputFile?: string;
      notification?: { status: string; summary: string };
    }[] = [];
    for (const [taskId, toolUseId] of taskToToolUse) {
      const notif = taskNotifications.get(taskId);
      all.push({
        taskId,
        description: toolUseDescriptions.get(toolUseId) || taskId,
        outputFile: taskOutputFiles.get(taskId),
        notification: notif
          ? { status: notif.status, summary: notif.summary }
          : undefined,
      });
    }
    return all;
  }, [messages, taskNotifications]);

  // Check alive status for orphaned bg tasks (no notification)
  const [deadTasks, setDeadTasks] = useState<Set<string>>(new Set());
  useEffect(() => {
    const orphans = bgTasksRaw.filter((t) => !t.notification);
    if (orphans.length === 0) return;
    let cancelled = false;
    Promise.all(
      orphans.map((t) =>
        fetch(`/api/tasks/${t.taskId}/alive`)
          .then((r) => r.json())
          .then((d) => ({ taskId: t.taskId, alive: d.alive }))
          .catch(() => ({ taskId: t.taskId, alive: false })),
      ),
    ).then((results) => {
      if (cancelled) return;
      const dead = new Set(
        results.filter((r) => !r.alive).map((r) => r.taskId),
      );
      if (dead.size > 0) setDeadTasks(dead);
    });
    return () => {
      cancelled = true;
    };
  }, [bgTasksRaw]);

  const bgTasks = useMemo(
    () =>
      bgTasksRaw.map((t) =>
        !t.notification && deadTasks.has(t.taskId)
          ? {
              ...t,
              notification: {
                status: "killed",
                summary: "Task no longer running",
              },
            }
          : t,
      ),
    [bgTasksRaw, deadTasks],
  );

  const conversationMessages = useMemo(() => {
    // Deduplicate task-notification messages: if a real user message and a
    // queue-operation-converted message both carry the same task-id, keep only
    // the last one (the real user message). Walk backward so the later message wins.
    const filtered = messages.filter(
      (m) => m.type === "user" || m.type === "assistant",
    );
    const result: typeof filtered = [];
    const taskIdsSeen = new Set<string>();
    for (let i = filtered.length - 1; i >= 0; i--) {
      const m = filtered[i];
      if (m.type === "user") {
        const text =
          typeof m.message?.content === "string" ? m.message.content : null;
        if (text) {
          const match = text.match(/<task-id>(.*?)<\/task-id>/);
          if (match) {
            const tid = match[1];
            if (taskIdsSeen.has(tid)) continue; // skip duplicate
            taskIdsSeen.add(tid);
          }
        }
      }
      result.push(m);
    }
    result.reverse();
    return result;
  }, [messages]);

  // Build tool_use_id → result map so tool_use pills can show status
  const toolResultMap = useMemo(() => {
    const map = new Map<string, { content: string; isError: boolean }>();
    for (const m of conversationMessages) {
      if (m.type !== "user") continue;
      const content = m.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block.type === "tool_result" && block.tool_use_id) {
          const raw =
            typeof block.content === "string"
              ? block.content
              : JSON.stringify(block.content, null, 2);
          map.set(block.tool_use_id, {
            content: raw,
            isError: !!block.is_error,
          });
        }
      }
    }
    return map;
  }, [conversationMessages]);

  // Compute durations: tool_use_id → ms, message uuid → ms (turn duration)
  const { toolDurationMap, turnDurationMap } = useMemo(() => {
    const toolDurations = new Map<string, number>();
    const turnDurations = new Map<string, number>();
    const toolUseTimestamps = new Map<string, number>();
    let prevTimestamp: number | null = null;

    for (const m of messages) {
      const ts = m.timestamp ? new Date(m.timestamp).getTime() : null;

      if (m.type === "assistant" && ts) {
        if (prevTimestamp && m.uuid) {
          turnDurations.set(m.uuid, ts - prevTimestamp);
        }
        const content = m.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "tool_use" && block.id) {
              toolUseTimestamps.set(block.id, ts);
            }
          }
        }
      }

      if (m.type === "user" && ts) {
        const content = m.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "tool_result" && block.tool_use_id) {
              const startTs = toolUseTimestamps.get(block.tool_use_id);
              if (startTs) {
                toolDurations.set(block.tool_use_id, ts - startTs);
              }
            }
          }
        }
      }

      if (ts) prevTimestamp = ts;
    }

    return { toolDurationMap: toolDurations, turnDurationMap: turnDurations };
  }, [messages]);

  const tasks = useMemo(
    () => buildTaskState(conversationMessages),
    [conversationMessages],
  );
  const taskSubjects = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of tasks) {
      map.set(t.id, t.subject);
    }
    return map;
  }, [tasks]);
  // Count messages AFTER the last TaskUpdate (from the end) to decide visibility
  const messagesAfterLastTaskUpdate = useMemo(() => {
    for (let i = conversationMessages.length - 1; i >= 0; i--) {
      const msg = conversationMessages[i];
      if (msg.type !== "assistant") continue;
      const content = msg.message?.content;
      if (typeof content === "string" || !content) continue;
      for (const block of content) {
        if (block.type === "tool_use" && block.name === "TaskUpdate") {
          return conversationMessages.length - 1 - i;
        }
      }
    }
    return -1; // no TaskUpdate found
  }, [conversationMessages]);
  const allCompleted =
    tasks.length > 0 && tasks.every((t) => t.status === "completed");
  const showTaskWidget =
    tasks.length > 0 &&
    (!allCompleted ||
      (messagesAfterLastTaskUpdate >= 0 && messagesAfterLastTaskUpdate <= 6));

  const hasExitPlan = useMemo(() => {
    return messages.some(
      (m) =>
        m.type === "assistant" &&
        Array.isArray(m.message?.content) &&
        m.message!.content.some(
          (b: any) => b.type === "tool_use" && b.name === "ExitPlanMode",
        ),
    );
  }, [messages]);

  // Detect pending ExitPlanMode (tool_use without matching tool_result)
  const pendingPlanApproval = useMemo(() => {
    const exitPlanIds = new Set<string>();
    for (const m of messages) {
      if (m.type !== "assistant") continue;
      const content = m.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (
          block.type === "tool_use" &&
          block.name === "ExitPlanMode" &&
          block.id
        ) {
          exitPlanIds.add(block.id);
        }
      }
    }
    if (exitPlanIds.size === 0) return false;
    for (const m of messages) {
      if (m.type !== "user") continue;
      const content = m.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block.type === "tool_result" && block.tool_use_id) {
          exitPlanIds.delete(block.tool_use_id);
        }
      }
    }
    return exitPlanIds.size > 0;
  }, [messages]);

  // Auto-restore permission state for pending ExitPlanMode after server reboot
  useEffect(() => {
    if (
      pendingPlanApproval &&
      session.paneId &&
      session.status !== "permission"
    ) {
      fetch(`/api/sessions/${sessionId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "PermissionRequest",
          tool_name: "ExitPlanMode",
        }),
      }).catch(() => {});
    }
  }, [pendingPlanApproval, session.paneId, session.status, sessionId]);

  // If this session ends with a plan (ExitPlanMode), find the next (newer) session to link to
  const nextSlugSession = useMemo(() => {
    if (!hasExitPlan || !olderSlugSessions?.length || !session.timestamp)
      return null;
    const newer = olderSlugSessions
      .filter((s) => s.timestamp > session.timestamp)
      .sort((a, b) => a.timestamp - b.timestamp);
    return newer[0] || null;
  }, [hasExitPlan, olderSlugSessions, session.timestamp]);

  useLayoutEffect(() => {
    if (autoScrollRef.current && conversationMessages.length > 0) {
      requestAnimationFrame(() => {
        lastMessageRef.current?.scrollIntoView({ behavior: "instant" });
      });
    }
  }, [conversationMessages.length]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  }

  return (
    <div className="relative h-full flex flex-col">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto bg-background"
      >
        <div className="mx-auto max-w-4xl px-4 py-4">
          <div className="flex items-center justify-between mb-4">
            {session.summary && (
              <h2 className="text-sm font-medium text-foreground leading-relaxed flex-1 mr-4">
                {session.summary}
              </h2>
            )}
            <div className="shrink-0 ml-auto">
              <MarkdownExportButton session={session} messages={messages} />
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
            {/* Sentinel for lazy loading older messages */}
            <div ref={topSentinelRef} className="h-px" />
            {loadingOlder && (
              <div className="flex items-center justify-center py-2">
                <Loader2
                  size={16}
                  className="animate-spin text-muted-foreground"
                />
              </div>
            )}
            {hasMore && !loadingOlder && (
              <button
                onClick={loadOlder}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors py-2"
              >
                Load older messages...
              </button>
            )}
            {conversationMessages.map((message, i) => (
              <MessageBlock
                key={message.uuid || i}
                message={message}
                sessionId={sessionId}
                subagentMap={enrichedSubagentMap}
                onNavigateSession={onNavigateSession}
                onOpenFile={onOpenFile}
                questionPending={
                  !!session.questionData && session.status === "permission"
                }
                taskNotifications={taskNotifications}
                toolResultMap={toolResultMap}
                taskSubjects={taskSubjects}
                highlightedTaskId={highlightedTaskId}
                onHighlightTask={setHighlightedTaskId}
                toolDurationMap={toolDurationMap}
              />
            ))}
          </div>
          {nextSlugSession && onNavigateSession && (
            <button
              onClick={() => onNavigateSession(nextSlugSession.id)}
              className="flex items-center gap-2 px-3 py-2 mt-2 rounded-lg border border-border bg-secondary hover:bg-accent transition-colors cursor-pointer"
            >
              <span className="text-xs text-foreground">
                Continue to implementation
              </span>
              <span className="text-[10px] text-muted-foreground truncate">
                {nextSlugSession.summary || nextSlugSession.display}
              </span>
              <svg
                className="w-3.5 h-3.5 text-foreground ml-auto shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </button>
          )}
          <div ref={lastMessageRef} />
          {pendingMessage && (
            <div className="flex justify-end min-w-0">
              <div className="max-w-[85%] min-w-0">
                <div className="px-3.5 py-2 rounded-2xl rounded-br-md bg-secondary text-muted-foreground">
                  <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">
                    {pendingMessage}
                  </div>
                </div>
              </div>
            </div>
          )}
          {session.status === "responding" && <ThinkingIndicator />}
          {session.status === "compacting" && (
            <div className="flex items-center gap-2 px-1 py-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-muted-foreground opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-muted-foreground" />
              </span>
              <span className="text-[11px] text-muted-foreground font-medium">
                Compacting context...
              </span>
            </div>
          )}
        </div>
        {showTaskWidget && (
          <div className="sticky bottom-0 mx-auto max-w-3xl px-4 pb-3">
            <TaskListWidget tasks={tasks} />
          </div>
        )}
      </div>

      {bgTasks.some((t) => !t.notification) && (
        <div className="border-t border-border bg-background/80 px-4 py-2">
          <div className="mx-auto max-w-3xl flex flex-col gap-1">
            {bgTasks
              .filter((t) => !t.notification)
              .map((t) => (
                <div
                  key={t.taskId}
                  className="flex items-center gap-2 text-[11px] text-muted-foreground"
                >
                  <Loader2
                    size={12}
                    className="animate-spin text-muted-foreground shrink-0"
                  />
                  <span className="truncate flex-1">{t.description}</span>
                  {t.outputFile && (
                    <button
                      onClick={() =>
                        setTailTarget({
                          filePath: t.outputFile!,
                          description: t.description,
                        })
                      }
                      className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium text-foreground bg-muted hover:bg-accent transition-colors cursor-pointer"
                    >
                      Tail
                    </button>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}

      {session.paneId && (
        <div className="border-t border-border bg-background px-4 py-3">
          <div className="mx-auto max-w-3xl flex items-end gap-2">
            {session.status === "permission" && session.questionData ? (
              (() => {
                const questions = session.questionData as Array<{
                  question: string;
                  header: string;
                  options: Array<{ label: string; description: string }>;
                  multiSelect: boolean;
                }>;
                const q = questions[0];
                if (!q) return null;
                return (
                  <div className="flex-1 flex flex-col gap-2">
                    <div className="flex items-center justify-center gap-2 text-xs text-foreground">
                      <MessageCircleQuestion className="w-3.5 h-3.5" />
                      <span>{q.question}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {q.options.map((opt, i) => (
                        <button
                          key={i}
                          disabled={answeringQuestion}
                          onClick={() => handleAnswerQuestion(i)}
                          className={`flex-1 min-w-[120px] flex flex-col items-center gap-0.5 rounded-lg px-3 py-2 text-sm border transition-colors ${
                            answeringQuestion
                              ? "text-muted-foreground bg-muted border-border cursor-not-allowed"
                              : "text-foreground bg-secondary hover:bg-accent border-border cursor-pointer"
                          }`}
                          title={opt.description}
                        >
                          <span className="font-medium">{opt.label}</span>
                          <span className="text-[10px] text-muted-foreground leading-tight">
                            {opt.description}
                          </span>
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Type something..."
                        value={questionText}
                        onChange={(e) => setQuestionText(e.target.value)}
                        className="flex-1 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-ring"
                        onKeyDown={(e) => {
                          if (
                            e.key === "Enter" &&
                            navigator.maxTouchPoints === 0
                          ) {
                            e.preventDefault();
                            handleAnswerFreeText();
                          }
                        }}
                      />
                      <button
                        disabled={!questionText.trim() || sendingQuestion}
                        onClick={() => handleAnswerFreeText()}
                        className={`shrink-0 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                          questionText.trim() && !sendingQuestion
                            ? "bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer"
                            : "bg-muted text-muted-foreground cursor-not-allowed"
                        }`}
                      >
                        <SendHorizonal className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })()
            ) : session.status === "permission" ? (
              <div className="flex-1 flex flex-col gap-2">
                {session.permissionMessage && (
                  <p className="text-xs text-muted-foreground text-center">
                    {session.permissionMessage}
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={handleAllow}
                    disabled={permissionBusy}
                    className={`flex-1 flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                      permissionBusy
                        ? "text-orange-600/50 dark:text-orange-400/50 bg-orange-600/10 cursor-not-allowed"
                        : "text-orange-700 dark:text-orange-300 bg-orange-600/15 hover:bg-orange-600/25 cursor-pointer"
                    }`}
                    title="Allow permission request"
                  >
                    {permissionBusy ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <ShieldCheck className="w-4 h-4" />
                    )}
                    <span>Allow</span>
                  </button>
                  <button
                    onClick={handleDeny}
                    disabled={permissionBusy}
                    className={`flex-1 flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                      permissionBusy
                        ? "text-red-600/50 dark:text-red-400/50 bg-red-600/10 cursor-not-allowed"
                        : "text-red-700 dark:text-red-300 bg-red-600/15 hover:bg-red-600/25 cursor-pointer"
                    }`}
                    title="Deny permission request"
                  >
                    {permissionBusy ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <ShieldX className="w-4 h-4" />
                    )}
                    <span>Deny</span>
                  </button>
                </div>
              </div>
            ) : (
              <>
                {session.status === "responding" && (
                  <button
                    onClick={handleInterrupt}
                    className="shrink-0 self-stretch rounded-lg px-2 transition-colors bg-red-900/40 text-red-300 hover:bg-red-800/50 cursor-pointer"
                    title="Stop responding (Esc)"
                  >
                    <Square className="w-4 h-4" />
                  </button>
                )}
                <textarea
                  ref={textareaRef}
                  placeholder="Send a message to pane..."
                  rows={1}
                  value={inputValue}
                  onChange={(e) => updateInput(e.target.value)}
                  className="flex-1 resize-none rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-ring"
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.ctrlKey &&
                      !e.metaKey &&
                      navigator.maxTouchPoints === 0
                    ) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                />
                <button
                  disabled={!inputValue.trim() || sending}
                  onClick={sendMessage}
                  className={`shrink-0 self-stretch rounded-lg px-2 transition-colors ${
                    inputValue.trim() && !sending
                      ? "bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer"
                      : "bg-muted text-muted-foreground cursor-not-allowed"
                  }`}
                  title="Send to Zellij pane"
                >
                  <SendHorizonal className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {!session.status && onResurrect && (
        <div className="border-t border-border bg-background px-4 py-3">
          <div className="mx-auto max-w-3xl">
            <button
              onClick={onResurrect}
              className="w-full flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm text-green-700 dark:text-green-400 bg-green-600/10 hover:bg-green-600/20 transition-colors cursor-pointer"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
              <span>Resume session</span>
            </button>
          </div>
        </div>
      )}

      {tailTarget && (
        <TailPanel
          filePath={tailTarget.filePath}
          description={tailTarget.description}
          onClose={() => setTailTarget(null)}
        />
      )}

      <ContextPanel messages={messages} />

      {!autoScroll && (
        <ScrollToBottomButton
          onClick={() => {
            autoScrollRef.current = true;
            setAutoScroll(true);
            scrollToBottom();
          }}
        />
      )}
    </div>
  );
}

export default SessionView;
