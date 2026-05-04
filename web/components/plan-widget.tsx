import { useState } from "react";
import type { Session } from "@claude-run/api";
import {
  FileCode2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import { MessageResponse } from "./ai-elements/message";
import { formatTime } from "../utils";

export interface PlanItem {
  id: string;
  content: string;
  source: "exit" | "implement";
}

interface PlanWidgetProps {
  plans: PlanItem[];
  olderSlugSessions?: Session[];
  onNavigateSession?: (sessionId: string) => void;
}

export function PlanWidget({
  plans,
  olderSlugSessions,
  onNavigateSession,
}: PlanWidgetProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (plans.length === 0) return null;

  const latest = plans[plans.length - 1];

  return (
    <div className="bg-card/95 backdrop-blur border border-border rounded-lg overflow-hidden shadow-xl">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 w-full px-3 py-2 border-b border-border bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer"
      >
        <FileCode2 size={14} className="text-muted-foreground" />
        <span className="text-xs font-medium text-foreground">Plan</span>
        <span className="text-muted-foreground ml-auto">
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>

      {!collapsed && (
        <div className="max-h-64 overflow-y-auto">
          <div className="px-3 py-2">
            <MessageResponse>{latest.content}</MessageResponse>
          </div>
          {olderSlugSessions &&
            olderSlugSessions.length > 0 &&
            onNavigateSession && (
              <div className="px-3 py-2 border-t border-border/50 flex flex-col gap-1">
                {olderSlugSessions.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => onNavigateSession(s.id)}
                    className="flex items-center gap-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  >
                    <ExternalLink size={11} />
                    <span className="truncate">{s.summary || s.display}</span>
                    <span className="text-muted-foreground/60 shrink-0">
                      {formatTime(s.lastActivity)}
                    </span>
                  </button>
                ))}
              </div>
            )}
        </div>
      )}
    </div>
  );
}
