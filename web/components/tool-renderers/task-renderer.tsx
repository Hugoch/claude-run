import { useState, useCallback } from "react";
import type { ConversationMessage } from "@claude-run/api";
import {
  Bot,
  Play,
  Pause,
  ArrowRight,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  MessageSquareText,
} from "lucide-react";
import MessageBlock from "../message-block";

interface TaskInput {
  description: string;
  prompt: string;
  subagent_type: string;
  model?: string;
  run_in_background?: boolean;
  resume?: string;
}

interface TaskRendererProps {
  input: TaskInput;
  sessionId?: string;
  agentId?: string;
  status?: "done" | "error";
  duration?: number;
}

function getAgentColor(_agentType: string): string {
  return "text-muted-foreground";
}

function getAgentBgColor(_agentType: string): string {
  return "bg-muted/50 border-border";
}

function getAgentBorderColor(_agentType: string): string {
  return "border-border";
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m${rem}s`;
}

export function TaskRenderer(props: TaskRendererProps) {
  const { input, sessionId, agentId, status, duration } = props;
  const [showConversation, setShowConversation] = useState(false);
  const [subMessages, setSubMessages] = useState<ConversationMessage[] | null>(
    null,
  );
  const [loadingMessages, setLoadingMessages] = useState(false);

  const toggleConversation = useCallback(() => {
    if (!sessionId || !agentId) return;

    if (showConversation) {
      setShowConversation(false);
      return;
    }

    if (subMessages !== null) {
      setShowConversation(true);
      return;
    }

    setLoadingMessages(true);
    setShowConversation(true);

    fetch(`/api/conversation/${sessionId}/subagent/${agentId}`)
      .then((r) => r.json())
      .then((messages: ConversationMessage[]) => {
        setSubMessages(messages);
        setLoadingMessages(false);
      })
      .catch(() => {
        setSubMessages([]);
        setLoadingMessages(false);
      });
  }, [sessionId, agentId, showConversation, subMessages]);

  if (!input) {
    return null;
  }

  const agentColor = getAgentColor(input.subagent_type);
  const agentBgColor = getAgentBgColor(input.subagent_type);
  const agentBorderColor = getAgentBorderColor(input.subagent_type);
  const hasSubagent = !!(sessionId && agentId);

  return (
    <div className="w-full mt-2">
      <div className="bg-card/80 border border-border rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/50">
          {status === "done" ? (
            <span className="w-2 h-2 bg-emerald-500 rounded-full shrink-0" />
          ) : status === "error" ? (
            <span className="w-2 h-2 bg-red-500 rounded-full shrink-0" />
          ) : (
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500" />
            </span>
          )}
          <Bot size={14} className={agentColor} />
          <span className={`text-xs font-medium ${agentColor}`}>
            {input.subagent_type}
          </span>
          {input.description && (
            <>
              <ArrowRight size={10} className="text-muted-foreground/60" />
              <span className="text-xs text-muted-foreground">
                {input.description}
              </span>
            </>
          )}
          {duration != null && (
            <span className="text-[10px] text-zinc-600">
              {formatDuration(duration)}
            </span>
          )}
          <div className="flex items-center gap-1.5 ml-auto">
            {input.resume && (
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                <RefreshCw size={10} />
                resume
              </span>
            )}
            {input.run_in_background && (
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                <Pause size={10} />
                background
              </span>
            )}
            {input.model && (
              <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                {input.model}
              </span>
            )}
          </div>
        </div>
        <div className="p-3">
          <div
            className={`flex items-start gap-2 px-3 py-2 rounded-lg border ${agentBgColor}`}
          >
            <Play size={12} className={`${agentColor} mt-0.5 flex-shrink-0`} />
            <p className="text-xs text-foreground leading-relaxed whitespace-pre-wrap">
              {input.prompt}
            </p>
          </div>
        </div>

        {hasSubagent && (
          <div className="border-t border-border">
            <button
              onClick={toggleConversation}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              {showConversation ? (
                <ChevronDown size={12} />
              ) : (
                <ChevronRight size={12} />
              )}
              <MessageSquareText size={12} className={agentColor} />
              <span>
                {showConversation ? "Hide" : "View"} sub-agent conversation
              </span>
              {subMessages !== null && (
                <span className="text-[10px] text-muted-foreground/60 ml-1">
                  (
                  {
                    subMessages.filter(
                      (m) => m.type === "user" || m.type === "assistant",
                    ).length
                  }{" "}
                  messages)
                </span>
              )}
            </button>

            {showConversation && (
              <div className={`border-l-2 ${agentBorderColor} ml-3 mr-3 mb-3`}>
                {loadingMessages ? (
                  <div className="px-4 py-3 text-xs text-muted-foreground">
                    Loading conversation...
                  </div>
                ) : subMessages && subMessages.length > 0 ? (
                  <div className="flex flex-col gap-1.5 pl-3 pt-2">
                    {subMessages
                      .filter(
                        (m) => m.type === "user" || m.type === "assistant",
                      )
                      .map((msg, index) => (
                        <MessageBlock key={msg.uuid || index} message={msg} />
                      ))}
                  </div>
                ) : (
                  <div className="px-4 py-3 text-xs text-muted-foreground">
                    No conversation data available
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
