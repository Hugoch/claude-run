import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { Session } from "@claude-run/api";
import {
  PanelLeft,
  Plus,
  X,
  Bell,
  BellPlus,
  Square,
  Trash2,
  Loader2,
  ExternalLink,
  Sun,
  Moon,
  FolderOpen,
} from "lucide-react";
import { formatTime } from "./utils";
import SessionList from "./components/session-list";
import SessionView from "./components/session-view";
import { FilePanel } from "./components/file-panel";
import { useEventSource } from "./hooks/use-event-source";
import { usePush } from "./hooks/use-push";
import { useTheme } from "./hooks/use-theme";

interface SessionHeaderProps {
  session: Session;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)}KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)}MB`;
}

function SessionHeader(props: SessionHeaderProps) {
  const { session } = props;
  const [pr, setPr] = useState<{ url: string; number: number } | null>(null);

  useEffect(() => {
    if (!session.gitBranch) {
      setPr(null);
      return;
    }
    fetch(
      `/api/git/pr?project=${encodeURIComponent(session.project)}&branch=${encodeURIComponent(session.gitBranch)}`,
    )
      .then((r) => r.json())
      .then((data) =>
        setPr(data.url ? { url: data.url, number: data.number } : null),
      )
      .catch(() => setPr(null));
  }, [session.gitBranch, session.project]);

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <span className="text-[10px] text-muted-foreground bg-muted/80 px-1.5 py-0.5 rounded">
        {session.projectName}
      </span>
      {pr ? (
        <a
          href={pr.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-blue-600 dark:text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded hover:bg-blue-500/20 transition-colors"
          title={session.gitBranch}
        >
          PR#{pr.number}
        </a>
      ) : session.gitBranch ? (
        <span
          className="text-[10px] text-muted-foreground/60 bg-muted/60 px-1.5 py-0.5 rounded max-w-[120px] truncate"
          title={session.gitBranch}
        >
          {session.gitBranch}
        </span>
      ) : null}
      {session.fileSize != null && (
        <span className="text-[10px] text-muted-foreground/60 bg-muted/60 px-1.5 py-0.5 rounded">
          {formatFileSize(session.fileSize)}
        </span>
      )}
    </div>
  );
}

interface AttentionSession {
  id: string;
  display: string;
  status: string;
  permissionMessage?: string;
  projectName?: string;
  summary?: string;
}

function AttentionIndicator({
  sessions,
  onNavigate,
}: {
  sessions: AttentionSession[];
  onNavigate: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);

  if (sessions.length === 0) return null;

  const permCount = sessions.filter((s) => s.status === "permission").length;
  const notifCount = sessions.filter((s) => s.status === "notification").length;
  const urgentCount = permCount + notifCount;

  const bellColor =
    permCount > 0
      ? "text-orange-600 dark:text-orange-400"
      : notifCount > 0
        ? "text-red-600 dark:text-red-400"
        : sessions.some((s) => s.status === "responding")
          ? "text-amber-600 dark:text-amber-400"
          : "text-green-600 dark:text-green-400";

  const badgeColor =
    permCount > 0
      ? { ping: "bg-orange-400", solid: "bg-orange-500" }
      : { ping: "bg-red-400", solid: "bg-red-500" };

  return (
    <div className="relative shrink-0">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        className="relative p-1 hover:bg-muted rounded transition-colors cursor-pointer"
        title={`${sessions.length} session${sessions.length > 1 ? "s" : ""} alive`}
      >
        <Bell className={`w-4 h-4 ${bellColor}`} />
        {urgentCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
            <span
              className={`animate-ping absolute inline-flex h-full w-full rounded-full ${badgeColor.ping} opacity-75`}
            />
            <span
              className={`relative inline-flex rounded-full h-3 w-3 ${badgeColor.solid} text-[8px] text-white font-bold items-center justify-center`}
            >
              {urgentCount}
            </span>
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-8 z-50 w-64 bg-card border border-border rounded-lg shadow-xl py-1 max-h-60 overflow-y-auto">
            {sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  onNavigate(s.id);
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-2 hover:bg-muted transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  {s.status === "permission" ? (
                    <span className="w-1.5 h-1.5 bg-orange-500 rounded-full animate-pulse shrink-0" />
                  ) : s.status === "notification" ? (
                    <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse shrink-0" />
                  ) : s.status === "responding" ? (
                    <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse shrink-0" />
                  ) : (
                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full shrink-0" />
                  )}
                  <span className="text-[11px] text-foreground truncate">
                    {s.summary || s.display}
                  </span>
                </div>
                {s.projectName && (
                  <p className="text-[10px] text-zinc-600 truncate mt-0.5 ml-3.5">
                    {s.projectName}
                  </p>
                )}
                {s.permissionMessage && (
                  <p className="text-[10px] text-muted-foreground truncate mt-0.5 ml-3.5">
                    {s.permissionMessage}
                  </p>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function formatPct(v: number): string {
  return `${Math.round(v)}%`;
}

function elapsedPct(resetsAt?: string, periodHours?: number): number | null {
  if (!resetsAt || !periodHours) return null;
  try {
    const remainingMs = new Date(resetsAt).getTime() - Date.now();
    if (remainingMs <= 0) return null;
    const periodMs = periodHours * 3600_000;
    return Math.max(0, ((periodMs - remainingMs) / periodMs) * 100);
  } catch {
    return null;
  }
}

function driftPct(
  usagePct: number,
  resetsAt?: string,
  periodHours?: number,
): number | null {
  const elapsed = elapsedPct(resetsAt, periodHours);
  if (elapsed === null) return null;
  return Math.round(usagePct - elapsed);
}

function pctColor(
  usagePct: number,
  resetsAt?: string,
  periodHours?: number,
): string {
  const drift = driftPct(usagePct, resetsAt, periodHours);
  if (drift !== null) {
    if (drift > 30) return "text-red-600 dark:text-red-400";
    if (drift > 10) return "text-amber-600 dark:text-amber-400";
    return "text-muted-foreground";
  }
  if (usagePct > 80) return "text-red-600 dark:text-red-400";
  if (usagePct >= 50) return "text-amber-600 dark:text-amber-400";
  return "text-muted-foreground";
}

function driftColor(drift: number): string {
  if (drift > 30) return "text-red-600 dark:text-red-400";
  if (drift > 10) return "text-amber-600 dark:text-amber-400";
  if (drift < -10) return "text-emerald-600 dark:text-emerald-400";
  return "text-muted-foreground";
}

function formatDrift(drift: number): string {
  return drift >= 0 ? `+${drift}` : `${drift}`;
}

function formatRelativeTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = d.getTime() - now.getTime();
    if (diffMs <= 0) return "now";
    const diffMin = Math.round(diffMs / 60000);
    if (diffMin < 60) return `${diffMin}min`;
    const totalH = Math.floor(diffMin / 60);
    if (totalH >= 24) {
      const d2 = Math.floor(totalH / 24);
      const rh = totalH % 24;
      return rh > 0 ? `${d2}d${rh}h` : `${d2}d`;
    }
    const m = diffMin % 60;
    return m > 0 ? `${totalH}h${m.toString().padStart(2, "0")}` : `${totalH}h`;
  } catch {
    return "--";
  }
}

function DonutRing({
  cx,
  cy,
  r,
  sw,
  usagePct,
  elapsed,
  driftClr,
}: {
  cx: number;
  cy: number;
  r: number;
  sw: number;
  usagePct: number;
  elapsed: number | null;
  driftClr: string | null;
}) {
  const circ = 2 * Math.PI * r;
  const usage = Math.min(usagePct, 100);

  if (elapsed !== null && driftClr !== null) {
    const underPace = usage < elapsed;
    const basePct = underPace ? usage : Math.min(usage, elapsed);
    const overPct = underPace ? 0 : Math.max(0, usage - elapsed);
    const baseDash = (basePct / 100) * circ;
    const overDash = (overPct / 100) * circ;
    const baseColor = underPace
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-muted-foreground/50";
    // Tick: radial line at elapsed position
    const tickAngle = (elapsed / 100) * 360 - 90;
    const tickRad = (tickAngle * Math.PI) / 180;
    const tickLen = sw * 0.8;
    const t1x = cx + Math.cos(tickRad) * (r - tickLen);
    const t1y = cy + Math.sin(tickRad) * (r - tickLen);
    const t2x = cx + Math.cos(tickRad) * (r + tickLen);
    const t2y = cy + Math.sin(tickRad) * (r + tickLen);

    return (
      <>
        {baseDash > 0 && (
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            strokeWidth={sw}
            strokeLinecap="round"
            strokeDasharray={`${baseDash} ${circ}`}
            transform={`rotate(-90 ${cx} ${cy})`}
            stroke="currentColor"
            className={baseColor}
          />
        )}
        {overDash > 0 && (
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            strokeWidth={sw}
            strokeLinecap="round"
            strokeDasharray={`${overDash} ${circ}`}
            strokeDashoffset={-baseDash}
            transform={`rotate(-90 ${cx} ${cy})`}
            stroke="currentColor"
            className={driftClr}
          />
        )}
        <line
          x1={t1x}
          y1={t1y}
          x2={t2x}
          y2={t2y}
          strokeWidth={1.5}
          strokeLinecap="round"
          stroke="currentColor"
          className="text-foreground/70"
        />
      </>
    );
  }

  const dash = (usage / 100) * circ;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={r}
      fill="none"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeDasharray={`${dash} ${circ}`}
      transform={`rotate(-90 ${cx} ${cy})`}
      stroke="currentColor"
      className="text-muted-foreground/50"
    />
  );
}

function UsageDonut({
  pct5h,
  pct7d,
  elapsed5h,
  elapsed7d,
  drift5h,
  drift7d,
  extraCents,
}: {
  pct5h: number;
  pct7d: number;
  elapsed5h: number | null;
  elapsed7d: number | null;
  drift5h: number | null;
  drift7d: number | null;
  extraCents: number;
}) {
  const size = 34;
  const cx = size / 2;
  const cy = size / 2;
  const outerR = 14;
  const innerR = 9;
  const sw = 3;
  const driftClr5h = drift5h !== null ? driftColor(drift5h) : null;
  const driftClr7d = drift7d !== null ? driftColor(drift7d) : null;
  const bothFull = pct5h >= 100 || pct7d >= 100;
  const centerLabel = bothFull
    ? `$${(extraCents / 100).toFixed(0)}`
    : String(Math.round(pct5h));

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0"
    >
      {/* Track rings */}
      <circle
        cx={cx}
        cy={cy}
        r={outerR}
        fill="none"
        stroke="currentColor"
        strokeWidth={sw}
        className={
          bothFull
            ? "text-red-600/30 dark:text-red-400/30"
            : "text-muted-foreground/15"
        }
      />
      <circle
        cx={cx}
        cy={cy}
        r={innerR}
        fill="none"
        stroke="currentColor"
        strokeWidth={sw}
        className={
          bothFull
            ? "text-red-600/30 dark:text-red-400/30"
            : "text-muted-foreground/15"
        }
      />
      {/* 7d outer ring */}
      <DonutRing
        cx={cx}
        cy={cy}
        r={outerR}
        sw={sw}
        usagePct={pct7d}
        elapsed={elapsed7d}
        driftClr={driftClr7d}
      />
      {/* 5h inner ring */}
      <DonutRing
        cx={cx}
        cy={cy}
        r={innerR}
        sw={sw}
        usagePct={pct5h}
        elapsed={elapsed5h}
        driftClr={driftClr5h}
      />
      {/* Center label */}
      <text
        x={cx}
        y={cy}
        textAnchor="middle"
        dominantBaseline="central"
        fill="currentColor"
        className={`${bothFull ? "text-red-600 dark:text-red-400" : "text-foreground"} text-[7px] font-medium select-none`}
      >
        {centerLabel}
      </text>
    </svg>
  );
}

function UsageBadge() {
  const [usage, setUsage] = useState<{
    five_hour_pct: number;
    seven_day_pct: number;
    resets_at?: string;
    seven_day_resets_at?: string;
    extra_usage_cents?: number;
  } | null>(null);
  const [error, setError] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;
    const fetchUsage = () => {
      fetch("/api/usage")
        .then((r) => r.json())
        .then((data) => {
          if (!mounted) return;
          if (data.five_hour_pct !== undefined) {
            setUsage(data);
            setError(false);
          } else {
            setError(true);
          }
        })
        .catch(() => {
          if (mounted) setError(true);
        });
    };
    fetchUsage();
    const interval = setInterval(fetchUsage, 60_000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const handler = (e: MouseEvent) => {
      if (mobileRef.current && !mobileRef.current.contains(e.target as Node))
        setMobileOpen(false);
    };
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, [mobileOpen]);

  if (error || !usage) return null;

  const resetLabel = usage.resets_at
    ? formatRelativeTime(usage.resets_at)
    : null;
  const reset7dLabel = usage.seven_day_resets_at
    ? formatRelativeTime(usage.seven_day_resets_at)
    : null;
  const extra = usage.extra_usage_cents ?? 0;
  const elapsed5h = elapsedPct(usage.resets_at, 5);
  const elapsed7d = elapsedPct(usage.seven_day_resets_at, 168);
  const drift5h = driftPct(usage.five_hour_pct, usage.resets_at, 5);
  const drift7d = driftPct(usage.seven_day_pct, usage.seven_day_resets_at, 168);

  const donut = (
    <UsageDonut
      pct5h={usage.five_hour_pct}
      pct7d={usage.seven_day_pct}
      elapsed5h={elapsed5h}
      elapsed7d={elapsed7d}
      drift5h={drift5h}
      drift7d={drift7d}
      extraCents={extra}
    />
  );

  const dropdown = (
    <div className="absolute right-0 top-full mt-1 z-50 bg-popover border border-border rounded-lg shadow-lg px-3 py-2.5 grid grid-cols-[auto_auto_auto_auto] gap-x-2 gap-y-1.5 items-center text-[11px]">
      <span className={pctColor(usage.five_hour_pct, usage.resets_at, 5)}>
        5h
      </span>
      <span
        className={`text-right ${pctColor(usage.five_hour_pct, usage.resets_at, 5)}`}
      >
        {formatPct(usage.five_hour_pct)}
      </span>
      <span
        className={`text-right ${drift5h !== null ? driftColor(drift5h) : ""}`}
      >
        {drift5h !== null ? formatDrift(drift5h) : ""}
      </span>
      <span className="text-right text-muted-foreground">
        {resetLabel ?? ""}
      </span>

      <span
        className={pctColor(
          usage.seven_day_pct,
          usage.seven_day_resets_at,
          168,
        )}
      >
        7d
      </span>
      <span
        className={`text-right ${pctColor(usage.seven_day_pct, usage.seven_day_resets_at, 168)}`}
      >
        {formatPct(usage.seven_day_pct)}
      </span>
      <span
        className={`text-right ${drift7d !== null ? driftColor(drift7d) : ""}`}
      >
        {drift7d !== null ? formatDrift(drift7d) : ""}
      </span>
      <span className="text-right text-muted-foreground">
        {reset7dLabel ?? ""}
      </span>

      <span className="text-muted-foreground">extra</span>
      <span className="text-right text-muted-foreground col-span-3">
        ${(extra / 100).toFixed(2)}
      </span>
    </div>
  );

  return (
    <div
      ref={mobileRef}
      className="relative shrink-0"
      title={`5h: ${formatPct(usage.five_hour_pct)}${drift5h !== null ? ` (${formatDrift(drift5h)})` : ""} · 7d: ${formatPct(usage.seven_day_pct)}${drift7d !== null ? ` (${formatDrift(drift7d)})` : ""}`}
    >
      <button
        className="flex items-center gap-1.5 p-1 rounded-md hover:bg-muted/50 transition-colors cursor-pointer"
        onClick={() => setMobileOpen((v) => !v)}
      >
        {donut}
      </button>
      {mobileOpen && dropdown}
    </div>
  );
}

function PushButton() {
  const { state, subscribe } = usePush();

  // Hide when unsupported, denied, or already subscribed
  if (state !== "default" && state !== "subscribing") return null;

  return (
    <button
      onClick={subscribe}
      disabled={state === "subscribing"}
      className="p-1 hover:bg-muted rounded transition-colors cursor-pointer shrink-0"
      title="Enable push notifications"
    >
      <BellPlus
        className={`w-4 h-4 ${state === "subscribing" ? "text-muted-foreground/50 animate-pulse" : "text-muted-foreground"}`}
      />
    </button>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      className="p-1 hover:bg-muted rounded transition-colors cursor-pointer shrink-0"
      title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
    >
      {theme === "dark" ? (
        <Sun className="w-4 h-4 text-muted-foreground" />
      ) : (
        <Moon className="w-4 h-4 text-muted-foreground" />
      )}
    </button>
  );
}

function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<string | null>(() => {
    const hash = window.location.hash.slice(1);
    return hash || null;
  });
  const [loading, setLoading] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showLaunchModal, setShowLaunchModal] = useState(false);
  const [launchProject, setLaunchProject] = useState("");
  const [launchPrompt, setLaunchPrompt] = useState("");
  const [skipPermissions, setSkipPermissions] = useState(true);
  const [zellijSession, setZellijSession] = useState("");
  const [pendingUrls, setPendingUrls] = useState<string[]>([]);
  const [zellijSessions, setZellijSessions] = useState<string[]>([]);
  const [newZellijName, setNewZellijName] = useState("main");
  const [creatingZellij, setCreatingZellij] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [killing, setKilling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [openFile, setOpenFile] = useState<{
    filePath: string;
    project: string;
    browse?: boolean;
  } | null>(null);
  const [pendingInsert, setPendingInsert] = useState<string | null>(null);

  // Ping server every 15s so it knows we're actively viewing
  useEffect(() => {
    fetch("/api/ping").catch(() => {});
    const id = setInterval(() => fetch("/api/ping").catch(() => {}), 15000);
    return () => clearInterval(id);
  }, []);

  // Clear app badge + SW notifications when app is visible
  useEffect(() => {
    const clearBadge = () => {
      (navigator as any).clearAppBadge?.();
      navigator.serviceWorker?.ready.then((reg) =>
        reg.getNotifications().then((ns) => ns.forEach((n) => n.close())),
      );
    };
    // Clear on mount (app already open)
    if (!document.hidden) clearBadge();
    // Clear when switching back to app
    const handler = () => {
      if (!document.hidden) clearBadge();
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);
  const [resurrectData, setResurrectData] = useState<{
    id: string;
    project: string;
    name?: string;
  } | null>(null);
  const [resurrectSkip, setResurrectSkip] = useState(true);
  const [resurrecting, setResurrecting] = useState(false);

  const selectedSessionData = useMemo(() => {
    if (!selectedSession) {
      return null;
    }

    return sessions.find((s) => s.id === selectedSession) || null;
  }, [sessions, selectedSession]);

  // Find older sessions with the same slug (for plan navigation)
  const olderSlugSessions = useMemo(() => {
    if (!selectedSessionData?.slug) return [];
    return sessions
      .filter(
        (s) =>
          s.slug === selectedSessionData.slug &&
          s.id !== selectedSessionData.id,
      )
      .sort((a, b) => b.lastActivity - a.lastActivity);
  }, [sessions, selectedSessionData]);

  useEffect(() => {
    fetch("/api/projects")
      .then((res) => res.json())
      .then(setProjects)
      .catch(console.error);
  }, []);

  const handleSessionsFull = useCallback((event: MessageEvent) => {
    const data: Session[] = JSON.parse(event.data);
    setSessions(data);
    setLoading(false);
  }, []);

  const handleSessionsUpdate = useCallback((event: MessageEvent) => {
    const updates: Session[] = JSON.parse(event.data);
    setSessions((prev) => {
      const sessionMap = new Map(prev.map((s) => [s.id, s]));
      const prevIds = new Set(prev.map((s) => s.id));
      const newSessions = updates.filter((u) => !prevIds.has(u.id));
      for (const update of updates) {
        sessionMap.set(update.id, update);
      }
      // Update existing sessions in place, prepend new ones at the top
      const updated = prev.map((s) => sessionMap.get(s.id) || s);
      if (newSessions.length > 0) {
        const toInsert = newSessions
          .sort((a, b) => b.timestamp - a.timestamp)
          .map((s) => sessionMap.get(s.id) || s);
        return [...toInsert, ...updated];
      }
      return updated;
    });
  }, []);

  const handleStatusUpdate = useCallback((event: MessageEvent) => {
    const data = JSON.parse(event.data);
    setSessions((prev) => {
      const idx = prev.findIndex((s) => s.id === data.id);
      if (idx === -1) return prev;
      const updated = [...prev];
      updated[idx] = {
        ...updated[idx],
        status: data.status,
        paneId: data.paneId,
        paneVerified: data.paneVerified,
        permissionMessage: data.permissionMessage,
        questionData: data.questionData,
      };
      return updated;
    });
  }, []);

  const handleSessionsError = useCallback(() => {
    setLoading(false);
  }, []);

  const handleOpenUrl = useCallback((event: MessageEvent) => {
    const { url } = JSON.parse(event.data);
    if (url) setPendingUrls((prev) => [...prev, url]);
  }, []);

  useEventSource("/api/sessions/stream", {
    events: [
      { eventName: "sessions", onMessage: handleSessionsFull },
      { eventName: "sessionsUpdate", onMessage: handleSessionsUpdate },
      { eventName: "statusUpdate", onMessage: handleStatusUpdate },
      { eventName: "openUrl", onMessage: handleOpenUrl },
    ],
    onError: handleSessionsError,
  });

  const attentionSessions = useMemo((): AttentionSession[] => {
    return sessions
      .filter((s) => s.id !== selectedSession && s.status)
      .map((s) => ({
        id: s.id,
        display: s.display,
        status: s.status as string,
        permissionMessage: s.permissionMessage || undefined,
        projectName: s.projectName,
        summary: s.summary || undefined,
      }));
  }, [sessions, selectedSession]);

  const filteredSessions = useMemo(() => {
    if (!selectedProject) {
      return sessions;
    }
    return sessions.filter((s) => s.project === selectedProject);
  }, [sessions, selectedProject]);

  // Listen for hash changes (e.g. from push notification click)
  useEffect(() => {
    const handler = () => {
      const hash = window.location.hash.slice(1);
      if (hash) setSelectedSession(hash);
    };
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);

  // Handle ?share= param from PWA share target
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shared = params.get("share");
    if (shared) {
      setLaunchPrompt(shared);
      setShowLaunchModal(true);
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.hash,
      );
    }
  }, []);

  const handleSelectSession = useCallback((sessionId: string) => {
    setSelectedSession(sessionId);
    setOpenFile(null);
    window.history.replaceState(null, "", `#${sessionId}`);
    if (window.innerWidth < 1024) {
      setSidebarCollapsed(true);
    }
  }, []);

  const handleOpenFile = useCallback(
    (filePath: string) => {
      if (!selectedSessionData?.project) return;
      setOpenFile({ filePath, project: selectedSessionData.project });
    },
    [selectedSessionData?.project],
  );

  const handleCreateZellijSession = useCallback(async () => {
    if (!newZellijName.trim()) return;
    setCreatingZellij(true);
    try {
      const res = await fetch("/api/zellij/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newZellijName.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        setZellijSessions((prev) => [...prev, newZellijName.trim()]);
        setZellijSession(newZellijName.trim());
      }
    } catch (err) {
      console.error("Failed to create Zellij session:", err);
    } finally {
      setCreatingZellij(false);
    }
  }, [newZellijName]);

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      if (deleting) return;
      setDeleting(true);
      try {
        const res = await fetch(`/api/sessions/${sessionId}`, {
          method: "DELETE",
        });
        if (res.ok) {
          setSessions((prev) => prev.filter((s) => s.id !== sessionId));
          if (selectedSession === sessionId) {
            setSelectedSession(null);
            window.history.replaceState(null, "", window.location.pathname);
          }
        }
      } catch (err) {
        console.error("Failed to delete session:", err);
      } finally {
        setDeleting(false);
      }
    },
    [selectedSession, deleting],
  );

  const handleResurrectSession = useCallback(
    (sessionId: string, project: string, name?: string) => {
      setResurrectData({ id: sessionId, project, name });
      setResurrectSkip(true);
      fetch("/api/zellij/sessions")
        .then((r) => r.json())
        .then((d) => {
          const sessions = d.sessions || [];
          setZellijSessions(sessions);
          if (!zellijSession && sessions.length > 0)
            setZellijSession(sessions[0]);
        })
        .catch(() => {});
    },
    [zellijSession],
  );

  const handleResurrect = useCallback(async () => {
    if (!resurrectData) return;
    setResurrecting(true);
    try {
      const res = await fetch(`/api/sessions/${resurrectData.id}/resurrect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: resurrectData.project,
          dangerouslySkipPermissions: resurrectSkip || undefined,
          zellijSession: zellijSession || newZellijName.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setResurrectData(null);
      }
    } catch (err) {
      console.error("Failed to resurrect session:", err);
    } finally {
      setResurrecting(false);
    }
  }, [resurrectData, resurrectSkip, zellijSession, newZellijName]);

  const handleLaunch = useCallback(async () => {
    setLaunching(true);
    try {
      const res = await fetch("/api/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: launchProject || undefined,
          prompt: launchPrompt || undefined,
          dangerouslySkipPermissions: skipPermissions || undefined,
          zellijSession: zellijSession || newZellijName.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setShowLaunchModal(false);
        setLaunchProject("");
        setLaunchPrompt("");
      }
    } catch (err) {
      console.error("Failed to launch agent:", err);
    } finally {
      setLaunching(false);
    }
  }, [
    launchProject,
    zellijSession,
    skipPermissions,
    launchPrompt,
    newZellijName,
  ]);

  return (
    <div className="flex flex-col h-full bg-background text-foreground">
      {pendingUrls.map((url, i) => (
        <a
          key={`${url}-${i}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() =>
            setPendingUrls((prev) => prev.filter((_, j) => j !== i))
          }
          className="flex items-center gap-2 px-4 py-3 bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors shrink-0"
        >
          <ExternalLink size={16} />
          <span className="truncate flex-1">{url}</span>
          <span
            role="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setPendingUrls((prev) => prev.filter((_, j) => j !== i));
            }}
            className="p-1 hover:bg-primary-foreground/10 rounded"
          >
            <X size={14} />
          </span>
        </a>
      ))}
      <div className="flex flex-1 min-h-0 relative">
        {!sidebarCollapsed && (
          <aside className="w-80 border-r border-border flex flex-col bg-card max-lg:absolute max-lg:inset-y-0 max-lg:left-0 max-lg:z-40 max-lg:shadow-2xl">
            <div className="border-b border-border flex items-center">
              <label
                htmlFor={"select-project"}
                className="block flex-1 px-1 min-w-0"
              >
                <select
                  id={"select-project"}
                  value={selectedProject || ""}
                  onChange={(e) => setSelectedProject(e.target.value || null)}
                  className="w-full h-[50px] bg-transparent text-foreground text-sm focus:outline-none cursor-pointer px-4 py-4"
                >
                  <option value="">All Projects</option>
                  {projects.map((project) => {
                    const name = project.split("/").pop() || project;
                    return (
                      <option key={project} value={project}>
                        {name}
                      </option>
                    );
                  })}
                </select>
              </label>
              <button
                onClick={() => {
                  setLaunchProject(projects[0] || "");
                  setShowLaunchModal(true);
                  fetch("/api/zellij/sessions")
                    .then((r) => r.json())
                    .then((d) => {
                      const sessions = d.sessions || [];
                      setZellijSessions(sessions);
                      if (!zellijSession && sessions.length > 0)
                        setZellijSession(sessions[0]);
                    })
                    .catch(() => {});
                }}
                className="p-2 mr-2 hover:bg-muted rounded transition-colors cursor-pointer shrink-0"
                title="Launch new Claude agent"
              >
                <Plus className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
            <SessionList
              sessions={filteredSessions}
              selectedSession={selectedSession}
              onSelectSession={handleSelectSession}
              onDeleteSession={handleDeleteSession}
              onResurrectSession={handleResurrectSession}
              loading={loading}
              selectedProject={selectedProject}
            />
          </aside>
        )}

        <main
          className="flex-1 overflow-hidden bg-background flex flex-col"
          onClick={() => {
            if (!sidebarCollapsed && window.innerWidth < 1024)
              setSidebarCollapsed(true);
          }}
        >
          <div className="border-b border-border px-3 py-1.5">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                className="p-1 hover:bg-muted rounded transition-colors cursor-pointer shrink-0"
                aria-label={
                  sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
                }
              >
                <PanelLeft className="w-4 h-4 text-muted-foreground" />
              </button>
              {selectedSessionData && (
                <SessionHeader session={selectedSessionData} />
              )}
              <span className="flex-1" />
              <div className="flex items-center">
                <AttentionIndicator
                  sessions={attentionSessions}
                  onNavigate={handleSelectSession}
                />
                <ThemeToggle />
                <PushButton />
              </div>
              <UsageBadge />
            </div>
            {selectedSessionData && (
              <div className="flex items-center gap-1.5 mt-1 pl-8">
                <span className="text-[11px] text-muted-foreground truncate flex-1">
                  {selectedSessionData.summary || selectedSessionData.display}
                </span>
                <button
                  onClick={() =>
                    setOpenFile({
                      filePath: "",
                      project: selectedSessionData.project,
                      browse: true,
                    })
                  }
                  className="p-1 hover:bg-muted rounded transition-colors cursor-pointer shrink-0"
                  title="Browse files"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
                {selectedSessionData.status ? (
                  <button
                    disabled={killing}
                    onClick={async () => {
                      if (!confirm("Kill this session?")) return;
                      setKilling(true);
                      try {
                        await fetch(
                          `/api/sessions/${selectedSessionData.id}/kill`,
                          { method: "POST" },
                        );
                      } finally {
                        setKilling(false);
                      }
                    }}
                    className={`p-1 rounded transition-colors shrink-0 ${killing ? "cursor-not-allowed opacity-50" : "hover:bg-red-600/10 cursor-pointer"}`}
                    title="Kill session"
                  >
                    {killing ? (
                      <Loader2 className="w-3.5 h-3.5 text-red-600 dark:text-red-400 animate-spin" />
                    ) : (
                      <Square className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
                    )}
                  </button>
                ) : (
                  <button
                    disabled={deleting}
                    onClick={() => handleDeleteSession(selectedSessionData.id)}
                    className={`p-1 rounded transition-colors shrink-0 ${deleting ? "cursor-not-allowed opacity-50" : "hover:bg-red-600/10 cursor-pointer"}`}
                    title="Delete session"
                  >
                    {deleting ? (
                      <Loader2 className="w-3.5 h-3.5 text-red-600 dark:text-red-400 animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-red-600 dark:hover:text-red-400" />
                    )}
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="flex-1 overflow-hidden flex">
            <div className="flex-1 overflow-hidden">
              {selectedSession && selectedSessionData ? (
                <SessionView
                  sessionId={selectedSession}
                  session={selectedSessionData}
                  onNavigateSession={handleSelectSession}
                  onOpenFile={handleOpenFile}
                  olderSlugSessions={olderSlugSessions}
                  pendingInsert={pendingInsert}
                  onConsumeInsert={() => setPendingInsert(null)}
                  onResurrect={() => {
                    handleResurrectSession(
                      selectedSessionData.id,
                      selectedSessionData.project,
                      selectedSessionData.summary ||
                        selectedSessionData.display,
                    );
                  }}
                />
              ) : (
                <div className="flex h-full items-center justify-center text-muted-foreground/60">
                  <div className="text-center">
                    <div className="text-base mb-2 text-muted-foreground">
                      Select a session
                    </div>
                    <div className="text-sm text-muted-foreground/60">
                      Choose a session from the list to view the conversation
                    </div>
                  </div>
                </div>
              )}
            </div>
            {openFile && (
              <FilePanel
                filePath={openFile.filePath}
                project={openFile.project}
                browse={openFile.browse}
                onClose={() => setOpenFile(null)}
                onInsertRef={(ref) => {
                  setPendingInsert(ref);
                  setOpenFile(null);
                }}
              />
            )}
          </div>
        </main>

        {resurrectData && (
          <div
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
            onClick={() => setResurrectData(null)}
          >
            <div
              className="bg-card border border-border rounded-lg p-6 w-[420px] shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-medium text-foreground">
                  Resume session
                </h2>
                <button
                  onClick={() => setResurrectData(null)}
                  className="p-1 hover:bg-muted rounded transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
              <div className="space-y-4">
                {resurrectData.name && (
                  <p className="text-sm text-foreground line-clamp-2">
                    {resurrectData.name}
                  </p>
                )}
                <div>
                  <span className="block text-xs text-muted-foreground mb-1.5">
                    Project
                  </span>
                  <span className="block text-sm text-foreground truncate">
                    {resurrectData.project.split("/").pop()}
                  </span>
                </div>
                <div>
                  <label
                    htmlFor="resurrect-zellij"
                    className="block text-xs text-muted-foreground mb-1.5"
                  >
                    Zellij session
                  </label>
                  {zellijSessions.length > 0 ? (
                    <select
                      id="resurrect-zellij"
                      value={zellijSession}
                      onChange={(e) => setZellijSession(e.target.value)}
                      className="w-full bg-muted border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:border-ring"
                    >
                      {zellijSessions.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        id="resurrect-zellij"
                        value={newZellijName}
                        onChange={(e) => setNewZellijName(e.target.value)}
                        placeholder="Session name"
                        className="flex-1 bg-muted border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:border-ring"
                      />
                      <button
                        onClick={handleCreateZellijSession}
                        disabled={creatingZellij || !newZellijName.trim()}
                        className="px-3 py-2 bg-primary text-primary-foreground text-sm rounded hover:bg-primary/90 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                      >
                        {creatingZellij ? "Creating..." : "Create"}
                      </button>
                    </div>
                  )}
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={resurrectSkip}
                    onChange={(e) => setResurrectSkip(e.target.checked)}
                    className="accent-muted-foreground"
                  />
                  <span className="text-xs text-muted-foreground">
                    --dangerously-skip-permissions
                  </span>
                </label>
                <button
                  onClick={handleResurrect}
                  disabled={resurrecting}
                  className="w-full py-2 bg-primary text-primary-foreground text-sm font-medium rounded hover:bg-primary/90 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {resurrecting ? "Resuming..." : "Resume"}
                </button>
              </div>
            </div>
          </div>
        )}

        {showLaunchModal && (
          <div
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
            onClick={() => setShowLaunchModal(false)}
          >
            <div
              className="bg-card border border-border rounded-lg p-6 w-[420px] shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-medium text-foreground">
                  Launch new agent
                </h2>
                <button
                  onClick={() => setShowLaunchModal(false)}
                  className="p-1 hover:bg-muted rounded transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="launch-project"
                    className="block text-xs text-muted-foreground mb-1.5"
                  >
                    Project
                  </label>
                  <select
                    id="launch-project"
                    value={launchProject}
                    onChange={(e) => setLaunchProject(e.target.value)}
                    className="w-full bg-muted border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:border-ring"
                  >
                    {projects.map((project) => {
                      const name = project.split("/").pop() || project;
                      return (
                        <option key={project} value={project}>
                          {name}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="launch-prompt"
                    className="block text-xs text-muted-foreground mb-1.5"
                  >
                    Initial prompt (optional)
                  </label>
                  <textarea
                    id="launch-prompt"
                    value={launchPrompt}
                    onChange={(e) => setLaunchPrompt(e.target.value)}
                    placeholder="Say hi..."
                    rows={2}
                    className="w-full bg-muted border border-border rounded px-3 py-2 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-ring resize-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor="launch-zellij"
                    className="block text-xs text-muted-foreground mb-1.5"
                  >
                    Zellij session
                  </label>
                  {zellijSessions.length > 0 ? (
                    <select
                      id="launch-zellij"
                      value={zellijSession}
                      onChange={(e) => setZellijSession(e.target.value)}
                      className="w-full bg-muted border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:border-ring"
                    >
                      {zellijSessions.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        id="launch-zellij"
                        value={newZellijName}
                        onChange={(e) => setNewZellijName(e.target.value)}
                        placeholder="Session name"
                        className="flex-1 bg-muted border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:border-ring"
                      />
                      <button
                        onClick={handleCreateZellijSession}
                        disabled={creatingZellij || !newZellijName.trim()}
                        className="px-3 py-2 bg-primary text-primary-foreground text-sm rounded hover:bg-primary/90 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                      >
                        {creatingZellij ? "Creating..." : "Create"}
                      </button>
                    </div>
                  )}
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={skipPermissions}
                    onChange={(e) => setSkipPermissions(e.target.checked)}
                    className="accent-muted-foreground"
                  />
                  <span className="text-xs text-muted-foreground">
                    --dangerously-skip-permissions
                  </span>
                </label>
                <button
                  onClick={handleLaunch}
                  disabled={launching}
                  className="w-full py-2 bg-primary text-primary-foreground text-sm font-medium rounded hover:bg-primary/90 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {launching ? "Launching..." : "Launch"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
