import { useState, useMemo, useRef } from "react";
import type { ConversationMessage } from "@claude-run/api";
import { ChevronDown, ChevronUp } from "lucide-react";

const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  "claude-sonnet-4-5-20250514": 200_000,
  "claude-opus-4-5-20250514": 200_000,
  "claude-haiku-3-5-20241022": 200_000,
  "claude-sonnet-4-6-20250627": 200_000,
  "claude-opus-4-6-20250627": 1_000_000,
};

function getContextLimit(model?: string): number {
  if (!model) return 200_000;
  // Exact match
  if (MODEL_CONTEXT_LIMITS[model]) return MODEL_CONTEXT_LIMITS[model];
  // Prefix match (e.g. "claude-opus-4-6" matches "claude-opus-4-6-20250627")
  for (const [key, limit] of Object.entries(MODEL_CONTEXT_LIMITS)) {
    if (model.startsWith(key.replace(/-\d{8}$/, ""))) return limit;
  }
  // Default heuristic: 1M for opus 4.6, 200k otherwise
  if (model.includes("opus-4-6") || model.includes("opus-4.6")) return 1_000_000;
  return 200_000;
}

function formatModelName(model: string): string {
  if (model.includes("opus-4-6") || model.includes("opus-4.6")) return "Opus 4.6";
  if (model.includes("sonnet-4-6") || model.includes("sonnet-4.6")) return "Sonnet 4.6";
  if (model.includes("opus-4-5") || model.includes("opus-4.5")) return "Opus 4.5";
  if (model.includes("sonnet-4-5") || model.includes("sonnet-4.5")) return "Sonnet 4.5";
  if (model.includes("haiku-3-5") || model.includes("haiku-3.5")) return "Haiku 3.5";
  if (model.includes("haiku-4-5") || model.includes("haiku-4.5")) return "Haiku 4.5";
  return model;
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}

interface ContextTurn {
  turnIndex: number;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheCreation: number;
  fresh: number;
  isCompaction: boolean;
  timestamp: number | null; // epoch ms
  elapsedMs: number | null; // ms since first turn
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return `${min}m${sec > 0 ? String(sec).padStart(2, "0") : ""}`;
  const hr = Math.floor(min / 60);
  const rm = min % 60;
  return `${hr}h${rm > 0 ? String(rm).padStart(2, "0") : ""}`;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function useContextData(messages: ConversationMessage[]) {
  return useMemo(() => {
    const turns: ContextTurn[] = [];
    let totalOutput = 0;
    let totalCacheRead = 0;
    let totalInput = 0;
    let compacts = 0;
    let lastInput = 0;
    let nextIsCompaction = false;
    let peakInput = 0;
    let turnIdx = 0;
    let firstTs: number | null = null;
    let model: string | undefined;

    for (const m of messages) {
      if (m.type === "summary") {
        compacts++;
        nextIsCompaction = true;
        continue;
      }
      if (m.type !== "assistant") continue;
      if (m.message?.model) model = m.message.model;
      const usage = m.message?.usage;
      if (!usage) continue;

      const inputTokens = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
      const outputTokens = usage.output_tokens || 0;
      const cacheRead = usage.cache_read_input_tokens || 0;
      const cacheCreation = usage.cache_creation_input_tokens || 0;
      const fresh = inputTokens - cacheRead - cacheCreation;

      const ts = m.timestamp ? new Date(m.timestamp).getTime() : null;
      if (ts && firstTs === null) firstTs = ts;

      turns.push({
        turnIndex: turnIdx++,
        inputTokens,
        outputTokens,
        cacheRead,
        cacheCreation,
        fresh: Math.max(0, fresh),
        isCompaction: nextIsCompaction,
        timestamp: ts,
        elapsedMs: ts && firstTs ? ts - firstTs : null,
      });

      totalOutput += outputTokens;
      totalCacheRead += cacheRead;
      totalInput += inputTokens;
      lastInput = inputTokens;
      peakInput = Math.max(peakInput, inputTokens);
      nextIsCompaction = false;
    }

    const contextLimit = getContextLimit(model);
    const contextPct = Math.round((lastInput / contextLimit) * 100);
    const cacheHitRate = totalInput > 0 ? Math.round((totalCacheRead / totalInput) * 100) : 0;

    const lastTurn = turns[turns.length - 1];
    const totalDurationMs = lastTurn?.elapsedMs ?? null;

    return { turns, totalOutput, totalInput, totalCacheRead, compacts, lastInput, contextPct, cacheHitRate, peakInput, totalDurationMs, model, contextLimit };
  }, [messages]);
}

// SVG stacked area chart
const CHART_W = 600;
const CHART_H = 120;
const PAD_L = 40;
const PAD_R = 8;
const PAD_T = 8;
const PAD_B = 20;
const PLOT_W = CHART_W - PAD_L - PAD_R;
const PLOT_H = CHART_H - PAD_T - PAD_B;

function buildAreaPath(turns: ContextTurn[], getValue: (t: ContextTurn) => number, yMax: number): string {
  if (turns.length === 0) return "";
  const n = turns.length;
  const xStep = n === 1 ? PLOT_W : PLOT_W / (n - 1);
  const points = turns.map((t, i) => {
    const x = PAD_L + i * xStep;
    const y = PAD_T + PLOT_H - (getValue(t) / yMax) * PLOT_H;
    return `${x},${y}`;
  });
  const baseline = turns.map((_, i) => {
    const x = PAD_L + i * xStep;
    return `${x},${PAD_T + PLOT_H}`;
  }).reverse();
  return `M${points.join(" L")} L${baseline.join(" L")}Z`;
}

function buildStackedPaths(turns: ContextTurn[], yMax: number) {
  // Bottom layer: cache_read (green)
  // Middle layer: cache_creation (blue), stacked on cache_read
  // Top layer: fresh (gray), stacked on cache_read + cache_creation

  const n = turns.length;
  if (n === 0) return { cachePath: "", creationPath: "", freshPath: "" };
  const xStep = n === 1 ? PLOT_W : PLOT_W / (n - 1);

  const toY = (val: number) => PAD_T + PLOT_H - (Math.min(val, yMax) / yMax) * PLOT_H;
  const toX = (i: number) => PAD_L + i * xStep;

  // Layer 1: cache_read
  const cacheTop = turns.map((t, i) => `${toX(i)},${toY(t.cacheRead)}`);
  const cacheBottom = turns.map((_, i) => `${toX(i)},${toY(0)}`).reverse();
  const cachePath = `M${cacheTop.join(" L")} L${cacheBottom.join(" L")}Z`;

  // Layer 2: cache_creation (stacked)
  const creationTop = turns.map((t, i) => `${toX(i)},${toY(t.cacheRead + t.cacheCreation)}`);
  const creationBottom = [...cacheTop].reverse();
  const creationPath = `M${creationTop.join(" L")} L${creationBottom.join(" L")}Z`;

  // Layer 3: fresh (stacked)
  const freshTop = turns.map((t, i) => `${toX(i)},${toY(t.cacheRead + t.cacheCreation + t.fresh)}`);
  const freshBottom = [...creationTop].reverse();
  const freshPath = `M${freshTop.join(" L")} L${freshBottom.join(" L")}Z`;

  return { cachePath, creationPath, freshPath };
}

interface ContextPanelProps {
  messages: ConversationMessage[];
}

export function ContextPanel({ messages }: ContextPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const data = useContextData(messages);

  if (data.lastInput === 0) return null;

  const { turns, totalOutput, compacts, lastInput, contextPct, cacheHitRate, peakInput, totalDurationMs, model, contextLimit } = data;
  const yMax = Math.max(contextLimit, peakInput * 1.05);
  const { cachePath, creationPath, freshPath } = buildStackedPaths(turns, yMax);

  const n = turns.length;
  const xStep = n <= 1 ? PLOT_W : PLOT_W / (n - 1);

  const handleSvgMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || n === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * CHART_W;
    const idx = Math.round((svgX - PAD_L) / xStep);
    setHoverIdx(idx >= 0 && idx < n ? idx : null);
  };

  const hoveredTurn = hoverIdx !== null ? turns[hoverIdx] : null;

  return (
    <div className="border-t border-border/40">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-1 flex items-center justify-end gap-1.5 cursor-pointer hover:bg-card/50 transition-colors"
      >
        <span className="text-[10px] text-muted-foreground/60">
          {model && <>{formatModelName(model)} · </>}{contextPct}% of {formatTokenCount(contextLimit)} · {formatTokenCount(lastInput)} in · {formatTokenCount(totalOutput)} out{compacts > 0 && ` · ${compacts}x compact`}
        </span>
        {expanded ? (
          <ChevronDown className="w-3 h-3 text-muted-foreground/60" />
        ) : (
          <ChevronUp className="w-3 h-3 text-muted-foreground/60" />
        )}
      </button>

      {expanded && turns.length > 1 && (
        <div className="px-4 pb-3">
          <div className="relative">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${CHART_W} ${CHART_H}`}
              width="100%"
              className="block"
              onMouseMove={handleSvgMove}
              onMouseLeave={() => setHoverIdx(null)}
            >
              {/* Y-axis labels */}
              <text x={PAD_L - 4} y={PAD_T + 4} textAnchor="end" className="fill-muted-foreground/60 text-[9px]">
                {formatTokenCount(yMax)}
              </text>
              <text x={PAD_L - 4} y={PAD_T + PLOT_H} textAnchor="end" className="fill-muted-foreground/60 text-[9px]">
                0
              </text>

              {/* Context limit line */}
              <line
                x1={PAD_L} y1={PAD_T + PLOT_H - (contextLimit / yMax) * PLOT_H}
                x2={PAD_L + PLOT_W} y2={PAD_T + PLOT_H - (contextLimit / yMax) * PLOT_H}
                stroke="#ef4444" strokeWidth={0.5} strokeDasharray="4,3" opacity={0.4}
              />
              <text
                x={PAD_L + PLOT_W + 2}
                y={PAD_T + PLOT_H - (contextLimit / yMax) * PLOT_H + 3}
                className="fill-red-500/40 text-[7px]"
              >
                {formatTokenCount(contextLimit)}
              </text>

              {/* Stacked areas */}
              <path d={freshPath} fill="#52525b" opacity={0.4} />
              <path d={creationPath} fill="#3b82f6" opacity={0.35} />
              <path d={cachePath} fill="#22c55e" opacity={0.35} />

              {/* Compaction markers */}
              {turns.map((t, i) => t.isCompaction && (
                <line
                  key={`c-${i}`}
                  x1={PAD_L + i * xStep} y1={PAD_T}
                  x2={PAD_L + i * xStep} y2={PAD_T + PLOT_H}
                  stroke="#ef4444" strokeWidth={1} opacity={0.5}
                />
              ))}

              {/* Hover line */}
              {hoverIdx !== null && (
                <line
                  x1={PAD_L + hoverIdx * xStep} y1={PAD_T}
                  x2={PAD_L + hoverIdx * xStep} y2={PAD_T + PLOT_H}
                  stroke="#a1a1aa" strokeWidth={0.5} opacity={0.5}
                />
              )}

              {/* X-axis labels (sparse) — elapsed time or turn number */}
              {turns.filter((_, i) => i === 0 || i === n - 1 || (n > 10 && i % Math.ceil(n / 5) === 0)).map((t) => (
                <text
                  key={`x-${t.turnIndex}`}
                  x={PAD_L + t.turnIndex * xStep}
                  y={CHART_H - 2}
                  textAnchor="middle"
                  className="fill-muted-foreground/60 text-[8px]"
                >
                  {t.elapsedMs != null ? formatElapsed(t.elapsedMs) : t.turnIndex + 1}
                </text>
              ))}
            </svg>

            {/* Tooltip */}
            {hoveredTurn && (
              <div
                className="absolute top-0 bg-muted/95 border border-border rounded px-2 py-1.5 text-[10px] text-foreground pointer-events-none z-10 whitespace-nowrap"
                style={{
                  left: `${((PAD_L + hoverIdx! * xStep) / CHART_W) * 100}%`,
                  transform: hoverIdx! > n / 2 ? "translateX(-105%)" : "translateX(5%)",
                }}
              >
                <div className="font-medium text-foreground mb-0.5">
                  Turn {hoveredTurn.turnIndex + 1}{hoveredTurn.isCompaction && " (post-compact)"}
                  {hoveredTurn.timestamp && <span className="text-muted-foreground font-normal ml-1.5">{formatTime(hoveredTurn.timestamp)}</span>}
                  {hoveredTurn.elapsedMs != null && <span className="text-muted-foreground/60 font-normal ml-1">+{formatElapsed(hoveredTurn.elapsedMs)}</span>}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-sm bg-green-500/60" />
                  Cache read: {formatTokenCount(hoveredTurn.cacheRead)}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-sm bg-blue-500/60" />
                  Cache new: {formatTokenCount(hoveredTurn.cacheCreation)}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-sm bg-muted-foreground/40" />
                  Fresh: {formatTokenCount(hoveredTurn.fresh)}
                </div>
                <div className="text-muted-foreground mt-0.5">
                  Total: {formatTokenCount(hoveredTurn.inputTokens)} · Out: {formatTokenCount(hoveredTurn.outputTokens)}
                </div>
              </div>
            )}
          </div>

          {/* Legend + stats */}
          <div className="flex items-center gap-4 mt-2 text-[10px] text-muted-foreground">
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-green-500/60" />
              <span>Cached</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-blue-500/60" />
              <span>New cache</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-muted-foreground/40" />
              <span>Fresh</span>
            </div>
            <span className="ml-auto">
              Cache hit: {cacheHitRate}% · Peak: {formatTokenCount(peakInput)} · {turns.length} turns
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
