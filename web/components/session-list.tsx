import { useState, useMemo, memo, useRef, useEffect } from "react";
import type { Session } from "@claude-run/api";
import { formatTime } from "../utils";

interface SessionListProps {
  sessions: Session[];
  selectedSession: string | null;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  onResurrectSession?: (sessionId: string, project: string, name: string) => void;
  onUpdateTags?: (sessionId: string, tags: string[]) => void;
  loading?: boolean;
  selectedProject?: string | null;
}

function normalizeTag(raw: string): string | null {
  const trimmed = raw.trim().replace(/^#/, "").trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase();
}

function TagsRow({
  sessionId,
  tags,
  onUpdateTags,
  suggestions,
  activeFilters,
  onToggleFilter,
}: {
  sessionId: string;
  tags: string[];
  onUpdateTags?: (id: string, tags: string[]) => void;
  suggestions: string[];
  activeFilters: string[];
  onToggleFilter?: (tag: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const datalistId = `tags-suggestions-${sessionId}`;

  const addTag = (raw: string) => {
    if (!onUpdateTags) return;
    const t = normalizeTag(raw);
    if (!t) return;
    if (tags.includes(t)) return;
    onUpdateTags(sessionId, [...tags, t]);
  };

  const removeTag = (tag: string) => {
    if (!onUpdateTags) return;
    onUpdateTags(sessionId, tags.filter((t) => t !== tag));
  };

  const canEdit = !!onUpdateTags;
  if (!canEdit && tags.length === 0) return null;

  return (
    <div className="flex items-center flex-wrap gap-1 mt-1">
      {tags.map((tag) => {
        const isActive = activeFilters.includes(tag);
        return (
          <span
            key={tag}
            className={`group/tag inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded border transition-colors ${
              isActive
                ? "border-blue-500/50 bg-blue-500/15 text-blue-700 dark:text-blue-300"
                : "border-border/60 bg-muted/50 text-muted-foreground hover:text-foreground"
            }`}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleFilter?.(tag);
              }}
              className="cursor-pointer"
              title={isActive ? `Remove "${tag}" filter` : `Filter by "${tag}"`}
            >
              {tag}
            </button>
            {canEdit && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeTag(tag);
                }}
                className="opacity-0 group-hover/tag:opacity-100 hover:text-red-500 transition-opacity"
                title="Remove tag"
              >
                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </span>
        );
      })}
      {canEdit && (
        editing ? (
          <>
            <input
              ref={inputRef}
              type="text"
              value={draft}
              list={datalistId}
              onChange={(e) => setDraft(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag(draft);
                  setDraft("");
                } else if (e.key === "Escape") {
                  setDraft("");
                  setEditing(false);
                }
              }}
              onBlur={() => {
                if (draft.trim()) addTag(draft);
                setDraft("");
                setEditing(false);
              }}
              placeholder="tag..."
              className="px-1 py-0.5 text-[10px] rounded border border-border/60 bg-background text-foreground focus:outline-none focus:border-blue-500/60 w-20"
            />
            <datalist id={datalistId}>
              {suggestions.filter((s) => !tags.includes(s)).map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setEditing(true);
            }}
            className="opacity-0 group-hover:opacity-100 inline-flex items-center justify-center w-4 h-4 text-[10px] rounded border border-dashed border-border/60 text-muted-foreground hover:text-foreground hover:border-foreground/60 transition-all"
            title="Add tag"
          >
            +
          </button>
        )
      )}
    </div>
  );
}

interface ListItem {
  session: Session;
  isChild: boolean;
  olderSessions?: Session[];
}

type ViewMode = "recent" | "folder";

function SessionItem({
  session,
  isChild,
  isSelected,
  isFirst,
  onSelect,
  onDelete,
  onResurrect,
  onUpdateTags,
  tagSuggestions,
  activeTagFilters,
  onToggleTagFilter,
  hideProject,
  olderCount,
  isExpanded,
  onToggleOlder,
}: {
  session: Session;
  isChild: boolean;
  isSelected: boolean;
  isFirst: boolean;
  onSelect: () => void;
  onDelete?: (id: string) => void;
  onResurrect?: (id: string, project: string, name: string) => void;
  onUpdateTags?: (id: string, tags: string[]) => void;
  tagSuggestions: string[];
  activeTagFilters: string[];
  onToggleTagFilter?: (tag: string) => void;
  hideProject?: boolean;
  olderCount?: number;
  isExpanded?: boolean;
  onToggleOlder?: () => void;
}) {
  const { status, paneId, paneVerified } = session;
  return (
    <div
      className={`group text-left transition-colors overflow-hidden cursor-pointer ${
        isChild ? "pl-6 pr-3 py-2 border-l-2 border-l-border ml-2 border-b border-border/20" : "px-3 py-3.5 border-b border-border/40"
      } ${
        isSelected
          ? "bg-accent"
          : "hover:bg-muted/60"
      } ${isFirst ? "border-t border-t-border/40" : ""}`}
      onClick={onSelect}
    >
      <div className="flex items-center justify-between mb-1">
        <span className={`text-[10px] text-muted-foreground font-medium flex items-center gap-1.5`}>
          {status === "responding" ? (
            <svg className="w-3 h-3 text-amber-500 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          ) : status === "permission" && session.questionData ? (
            <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full flex-shrink-0 animate-pulse" />
          ) : status === "permission" ? (
            <span className="w-1.5 h-1.5 bg-orange-500 rounded-full flex-shrink-0 animate-pulse" />
          ) : status === "notification" ? (
            <span className="w-1.5 h-1.5 bg-red-500 rounded-full flex-shrink-0 animate-pulse" />
          ) : status === "active" ? (
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full flex-shrink-0 animate-pulse" />
          ) : null}
          {isChild ? "plan impl" : hideProject ? null : session.projectName}
        </span>
        <span className="text-[10px] text-muted-foreground/60 h-4 flex items-center gap-1">
          <span>{formatTime(session.lastActivity)}</span>
          <span>·</span>
          <span>{session.messageCount} msgs</span>
          {(onDelete || onResurrect) && (
            <span className="flex items-center gap-0.5 ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              {!status && onResurrect && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onResurrect(session.id, session.project, session.summary || session.display);
                  }}
                  className="flex items-center justify-center h-4 w-4 rounded text-muted-foreground hover:text-green-600 dark:hover:text-green-400 hover:bg-muted transition-colors"
                  title="Resume session"
                >
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </button>
              )}
              {onDelete && !session.status && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm("Delete this session from history?")) {
                      onDelete(session.id);
                    }
                  }}
                  className="flex items-center justify-center h-4 w-4 rounded text-muted-foreground hover:text-red-600 dark:hover:text-red-400 hover:bg-muted transition-colors"
                  title="Delete session"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              )}
            </span>
          )}
        </span>
      </div>
      <p className={`text-[12px] leading-snug line-clamp-2 break-words ${isChild ? "text-muted-foreground line-clamp-1" : "text-foreground"}`}>
        {session.summary || session.display}
      </p>
      {!isChild && (
        <TagsRow
          sessionId={session.id}
          tags={session.tags ?? []}
          onUpdateTags={onUpdateTags}
          suggestions={tagSuggestions}
          activeFilters={activeTagFilters}
          onToggleFilter={onToggleTagFilter}
        />
      )}
      <div className="flex items-center gap-1.5 mt-1">
        {(session.zellijSession || paneId) && (
          <span className={`px-1 text-[10px] rounded ${paneVerified ? "text-green-600 bg-green-600/10" : "text-muted-foreground/60 bg-muted opacity-50"}`}>
            {session.zellijSession && paneId
              ? `${session.zellijSession}:${paneId}${!paneVerified ? "?" : ""}`
              : session.zellijSession
                ? session.zellijSession
                : `p${paneId}${!paneVerified ? "?" : ""}`}
          </span>
        )}
        {olderCount && olderCount > 0 && onToggleOlder && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleOlder(); }}
            className="flex items-center gap-0.5 px-1 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <svg className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-90" : ""}`} fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
            {olderCount} older
          </button>
        )}
      </div>
    </div>
  );
}


const SessionList = memo(function SessionList(props: SessionListProps) {
  const { sessions, selectedSession, onSelectSession, onDeleteSession, onResurrectSession, onUpdateTags, loading: sessionsLoading, selectedProject } = props;
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>(() => (localStorage.getItem("cl:viewMode") as ViewMode) || "recent");
  const [toggledProjects, setToggledProjects] = useState<Map<string, boolean>>(new Map());
  const [onlyActive, setOnlyActive] = useState(() => localStorage.getItem("cl:onlyActive") === "true");
  const [expandedSlugs, setExpandedSlugs] = useState<Set<string>>(new Set());
  const [activeTagFilters, setActiveTagFilters] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem("cl:activeTags");
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const s of sessions) s.tags?.forEach((t) => set.add(t));
    return [...set].sort();
  }, [sessions]);

  // Drop active filters that no longer exist in any session
  useEffect(() => {
    setActiveTagFilters((prev) => {
      const filtered = prev.filter((t) => allTags.includes(t));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [allTags]);

  const toggleTagFilter = (tag: string) => {
    setActiveTagFilters((prev) => {
      const next = prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag];
      localStorage.setItem("cl:activeTags", JSON.stringify(next));
      return next;
    });
  };

  // Search filtering + slug parent/child grouping
  // Preserves input order from parent (already stable across SSE updates)
  const listItems = useMemo((): ListItem[] => {
    let list = onlyActive ? sessions.filter(s => s.status) : sessions;
    if (activeTagFilters.length > 0) {
      list = list.filter((s) => {
        const t = s.tags ?? [];
        return activeTagFilters.every((f) => t.includes(f));
      });
    }
    if (search.trim()) {
      const query = search.toLowerCase();
      list = list.filter(
        (s) =>
          s.display.toLowerCase().includes(query) ||
          s.projectName.toLowerCase().includes(query) ||
          (s.tags ?? []).some((t) => t.includes(query))
      );
    }
    // Group sessions by slug — only show the latest, older ones go in dropdown
    const slugGroups = new Map<string, Session[]>();
    for (const s of list) {
      if (s.slug) {
        const group = slugGroups.get(s.slug) || [];
        group.push(s);
        slugGroups.set(s.slug, group);
      }
    }
    // Build result preserving input order
    const seenSlugs = new Set<string>();
    const result: ListItem[] = [];
    for (const s of list) {
      if (s.slug) {
        if (seenSlugs.has(s.slug)) continue;
        seenSlugs.add(s.slug);
        const group = slugGroups.get(s.slug)!;
        if (group.length > 1) {
          group.sort((a, b) => b.lastActivity - a.lastActivity);
          result.push({ session: group[0], isChild: false, olderSessions: group.slice(1) });
        } else {
          result.push({ session: s, isChild: false });
        }
      } else {
        result.push({ session: s, isChild: false });
      }
    }
    return result;
  }, [sessions, search, onlyActive, activeTagFilters]);

  // Folder view: group listItems by projectName
  const projectGroups = useMemo(() => {
    if (viewMode !== "folder") return [];
    const groups = new Map<string, ListItem[]>();
    for (const item of listItems) {
      const name = item.session.projectName;
      const group = groups.get(name) || [];
      group.push(item);
      groups.set(name, group);
    }
    return [...groups.entries()].sort((a, b) => {
      const maxA = Math.max(...a[1].map(i => i.session.lastActivity));
      const maxB = Math.max(...b[1].map(i => i.session.lastActivity));
      return maxB - maxA;
    });
  }, [listItems, viewMode]);

  const isProjectCollapsed = (projectName: string, items: ListItem[]) => {
    const userToggle = toggledProjects.get(projectName);
    if (userToggle !== undefined) return !userToggle;
    // Default: collapsed if no session has an active status
    return !items.some(i => i.session.status);
  };

  const toggleProjectCollapse = (projectName: string, items: ListItem[]) => {
    setToggledProjects(prev => {
      const next = new Map(prev);
      const currentlyCollapsed = isProjectCollapsed(projectName, items);
      next.set(projectName, currentlyCollapsed); // expand if collapsed, collapse if expanded
      return next;
    });
  };

  const isSearchActive = search.trim().length > 0;

  const tagProps = {
    onUpdateTags,
    tagSuggestions: allTags,
    activeTagFilters,
    onToggleTagFilter: toggleTagFilter,
  };

  // Whether to show project headers in folder view (hide if single project filtered)
  const showProjectHeaders = !selectedProject;

  const renderFolderView = () => {
    if (!showProjectHeaders) {
      // Single project filtered — render flat like recent view
      let itemIndex = 0;
      return (
        <div>
          {listItems.map(({ session, isChild, olderSessions }, index) => {
            const isExpanded = session.slug ? expandedSlugs.has(session.slug) : false;
            return (
              <div key={session.id}>
                <SessionItem
                  session={session}
                  isChild={isChild}
                  isSelected={selectedSession === session.id}
                  isFirst={index === 0}
                  onSelect={() => onSelectSession(session.id)}
                  onDelete={onDeleteSession}
                  onResurrect={onResurrectSession} {...tagProps}
                  hideProject
                  olderCount={olderSessions?.length}
                  isExpanded={isExpanded}
                  onToggleOlder={session.slug ? () => toggleSlug(session.slug!) : undefined}
                />
                {isExpanded && olderSessions?.map(older => (
                  <SessionItem
                    key={older.id}
                    session={older}
                    isChild
                    isSelected={selectedSession === older.id}
                    isFirst={false}
                    onSelect={() => onSelectSession(older.id)}
                    onDelete={onDeleteSession}
                    onResurrect={onResurrectSession} {...tagProps}
                    hideProject
                  />
                ))}
              </div>
            );
          })}
        </div>
      );
    }

    return (
      <div>
        {projectGroups.map(([projectName, items]) => {
          const isCollapsed = isProjectCollapsed(projectName, items);
          return (
            <div key={projectName}>
              <button
                onClick={() => toggleProjectCollapse(projectName, items)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left bg-card/50 border-b border-border/40 hover:bg-muted/50 transition-colors"
              >
                <svg className={`w-3 h-3 text-muted-foreground transition-transform flex-shrink-0 ${isCollapsed ? "" : "rotate-90"}`} fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
                <span className="text-[11px] text-muted-foreground font-medium truncate">{projectName}</span>
                <span className="text-[10px] text-muted-foreground/60 ml-auto flex-shrink-0">{items.length}</span>
              </button>
              {!isCollapsed && items.map(({ session, isChild, olderSessions }) => {
                const isExpanded = session.slug ? expandedSlugs.has(session.slug) : false;
                return (
                  <div key={session.id}>
                    <SessionItem
                      session={session}
                      isChild={isChild}
                      isSelected={selectedSession === session.id}
                      isFirst={false}
                      onSelect={() => onSelectSession(session.id)}
                      onDelete={onDeleteSession}
                      onResurrect={onResurrectSession} {...tagProps}
                      hideProject
                      olderCount={olderSessions?.length}
                      isExpanded={isExpanded}
                      onToggleOlder={session.slug ? () => toggleSlug(session.slug!) : undefined}
                    />
                    {isExpanded && olderSessions?.map(older => (
                      <SessionItem
                        key={older.id}
                        session={older}
                        isChild
                        isSelected={selectedSession === older.id}
                        isFirst={false}
                        onSelect={() => onSelectSession(older.id)}
                        onDelete={onDeleteSession}
                        onResurrect={onResurrectSession} {...tagProps}
                        hideProject
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    );
  };

  const toggleSlug = (slug: string) => {
    setExpandedSlugs(prev => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug); else next.add(slug);
      return next;
    });
  };

  const renderRecentView = () => (
    <div>
      {listItems.map(({ session, isChild, olderSessions }, index) => {
        const isExpanded = session.slug ? expandedSlugs.has(session.slug) : false;
        return (
          <div key={session.id}>
            <SessionItem
              session={session}
              isChild={isChild}
              isSelected={selectedSession === session.id}
              isFirst={index === 0}
              onSelect={() => onSelectSession(session.id)}
              onDelete={onDeleteSession}
              onResurrect={onResurrectSession} {...tagProps}
              olderCount={olderSessions?.length}
              isExpanded={isExpanded}
              onToggleOlder={session.slug ? () => toggleSlug(session.slug!) : undefined}
            />
            {isExpanded && olderSessions?.map(older => (
              <SessionItem
                key={older.id}
                session={older}
                isChild
                isSelected={selectedSession === older.id}
                isFirst={false}
                onSelect={() => onSelectSession(older.id)}
                onDelete={onDeleteSession}
                onResurrect={onResurrectSession} {...tagProps}
              />
            ))}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="h-full overflow-hidden bg-background flex flex-col">
      <div className="px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2 text-muted-foreground mb-2">
          <svg
            className="w-4 h-4 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sessions..."
            className="flex-1 bg-transparent text-sm text-foreground placeholder-muted-foreground focus:outline-none"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="text-muted-foreground/60 hover:text-muted-foreground transition-colors"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
        </div>
        <div className="flex gap-2 items-center">
          <button
            onClick={() => { setViewMode("recent"); localStorage.setItem("cl:viewMode", "recent"); }}
            className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
              viewMode === "recent"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Recent
          </button>
          <button
            onClick={() => { setViewMode("folder"); localStorage.setItem("cl:viewMode", "folder"); }}
            className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
              viewMode === "folder"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Folder
          </button>
          <span className="mx-1 h-3 w-px bg-border" />
          <button
            onClick={() => setOnlyActive(v => { const next = !v; localStorage.setItem("cl:onlyActive", String(next)); return next; })}
            className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
              onlyActive
                ? "bg-green-600/15 text-green-700 dark:text-green-300"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Active
          </button>
        </div>
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {allTags.map((tag) => {
              const isActive = activeTagFilters.includes(tag);
              return (
                <button
                  key={tag}
                  onClick={() => toggleTagFilter(tag)}
                  className={`px-1.5 py-0.5 text-[10px] rounded border transition-colors ${
                    isActive
                      ? "border-blue-500/50 bg-blue-500/15 text-blue-700 dark:text-blue-300"
                      : "border-border/60 bg-muted/50 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tag}
                </button>
              );
            })}
            {activeTagFilters.length > 0 && (
              <button
                onClick={() => {
                  setActiveTagFilters([]);
                  localStorage.setItem("cl:activeTags", "[]");
                }}
                className="px-1.5 py-0.5 text-[10px] rounded text-muted-foreground/70 hover:text-foreground transition-colors"
                title="Clear tag filters"
              >
                clear
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {sessionsLoading ? (
          <div className="flex items-center justify-center py-8">
            <svg
              className="w-5 h-5 text-muted-foreground/60 animate-spin"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          </div>
        ) : listItems.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground/60">
            {isSearchActive ? "No sessions match" : onlyActive ? "No active sessions" : "No sessions found"}
          </p>
        ) : viewMode === "folder" ? (
          renderFolderView()
        ) : (
          renderRecentView()
        )}
      </div>

      <div className="px-3 py-2 border-t border-border">
        <div className="text-[10px] text-muted-foreground/60 text-center">
          {`${sessions.length} session${sessions.length !== 1 ? "s" : ""}`}
        </div>
      </div>
    </div>
  );
});

export default SessionList;
