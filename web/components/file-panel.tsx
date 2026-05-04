import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import {
  X,
  FileCode,
  Loader2,
  AlertCircle,
  ChevronRight,
  Folder,
  ArrowLeft,
  FolderOpen,
  MessageSquarePlus,
  ChevronUp,
  ChevronDown,
  Search,
  WrapText,
} from "lucide-react";

interface FilePanelProps {
  filePath: string;
  project: string;
  browse?: boolean;
  onClose: () => void;
  onInsertRef?: (ref: string) => void;
}

interface DirEntry {
  name: string;
  is_dir: boolean;
  size?: number;
}

type Mode =
  | { type: "browse"; dirPath: string }
  | { type: "file"; filePath: string; returnDir?: string };

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

function relativePath(fullPath: string, project: string): string {
  // Strip project prefix to get relative path
  if (fullPath.startsWith(project)) {
    const rel = fullPath.slice(project.length);
    return rel.startsWith("/") ? rel.slice(1) : rel;
  }
  return fullPath;
}

function Breadcrumbs({
  path,
  project,
  onNavigate,
}: {
  path: string;
  project: string;
  onNavigate: (dir: string) => void;
}) {
  const rel = relativePath(path, project);
  const segments = rel ? rel.split("/") : [];

  return (
    <div className="flex items-center gap-0.5 text-xs font-mono overflow-x-auto flex-1 min-w-0">
      <button
        onClick={() => onNavigate(project)}
        className="text-muted-foreground hover:text-foreground transition-colors shrink-0 cursor-pointer"
      >
        ~
      </button>
      {segments.map((seg, i) => {
        const segPath = project + "/" + segments.slice(0, i + 1).join("/");
        const isLast = i === segments.length - 1;
        return (
          <span key={i} className="flex items-center gap-0.5 shrink-0">
            <span className="text-muted-foreground/40">/</span>
            {isLast ? (
              <span className="text-foreground">{seg}</span>
            ) : (
              <button
                onClick={() => onNavigate(segPath)}
                className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                {seg}
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}

interface GitChangedFiles {
  added: Set<string>;
  modified: Set<string>;
  deleted: Set<string>;
}

function BrowseView({
  dirPath,
  project,
  onOpenFile,
  onNavigate,
}: {
  dirPath: string;
  project: string;
  onOpenFile: (filePath: string, returnDir: string) => void;
  onNavigate: (dir: string) => void;
}) {
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState<GitChangedFiles | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(
      `/api/files?path=${encodeURIComponent(dirPath)}&project=${encodeURIComponent(project)}`,
    )
      .then((r) => {
        if (!r.ok) {
          if (r.status === 403) throw new Error("Access denied");
          if (r.status === 404) throw new Error("Directory not found");
          throw new Error(`Error ${r.status}`);
        }
        return r.json();
      })
      .then((data) => setEntries(data.entries))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [dirPath, project]);

  // Fetch changed files once per project
  useEffect(() => {
    fetch(`/api/git/changed-files?project=${encodeURIComponent(project)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setChanged({
            added: new Set(data.added),
            modified: new Set(data.modified),
            deleted: new Set(data.deleted),
          });
        }
      })
      .catch(() => {});
  }, [project]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 size={18} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 text-xs text-red-600">
        <AlertCircle size={14} />
        <span>{error}</span>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
        Empty directory
      </div>
    );
  }

  // Check if a file or any file inside a directory is changed
  const getStatus = (
    name: string,
    isDir: boolean,
  ): "added" | "modified" | "deleted" | null => {
    if (!changed) return null;
    const rel = relativePath(dirPath + "/" + name, project);
    if (!isDir) {
      if (changed.added.has(rel)) return "added";
      if (changed.modified.has(rel)) return "modified";
      if (changed.deleted.has(rel)) return "deleted";
      return null;
    }
    // For directories, check if any file inside is changed
    const prefix = rel + "/";
    for (const f of changed.added) {
      if (f.startsWith(prefix)) return "added";
    }
    for (const f of changed.modified) {
      if (f.startsWith(prefix)) return "modified";
    }
    for (const f of changed.deleted) {
      if (f.startsWith(prefix)) return "deleted";
    }
    return null;
  };

  const statusColor = (s: "added" | "modified" | "deleted" | null) => {
    if (s === "added") return "text-green-600 dark:text-green-400";
    if (s === "modified") return "text-blue-600 dark:text-blue-400";
    if (s === "deleted") return "text-red-600 dark:text-red-400";
    return "text-foreground";
  };

  const iconColor = (s: "added" | "modified" | "deleted" | null) => {
    if (s === "added") return "text-green-600 dark:text-green-400";
    if (s === "modified") return "text-blue-600 dark:text-blue-400";
    if (s === "deleted") return "text-red-600 dark:text-red-400";
    return "text-muted-foreground";
  };

  return (
    <div className="divide-y divide-border">
      {entries.map((entry) => {
        const status = getStatus(entry.name, entry.is_dir);
        return (
          <button
            key={entry.name}
            onClick={() => {
              const fullPath = dirPath + "/" + entry.name;
              if (entry.is_dir) {
                onNavigate(fullPath);
              } else {
                onOpenFile(fullPath, dirPath);
              }
            }}
            className="flex items-center gap-2.5 px-3 w-full text-left hover:bg-muted/50 transition-colors cursor-pointer"
            style={{ minHeight: 44 }}
          >
            {entry.is_dir ? (
              <Folder size={14} className={`${iconColor(status)} shrink-0`} />
            ) : (
              <FileCode size={14} className={`${iconColor(status)} shrink-0`} />
            )}
            <span
              className={`text-xs font-mono truncate flex-1 ${statusColor(status)}`}
            >
              {entry.name}
            </span>
            {!entry.is_dir && status && status !== "deleted" && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenFile(dirPath + "/" + entry.name, dirPath);
                }}
                className="p-0.5 hover:bg-muted rounded transition-colors cursor-pointer shrink-0"
                title="View changes"
              >
                <Search size={12} className={statusColor(status)} />
              </button>
            )}
            {status && (
              <span
                className={`text-[9px] font-medium shrink-0 ${statusColor(status)}`}
              >
                {status === "added" ? "A" : status === "modified" ? "M" : "D"}
              </span>
            )}
            {entry.is_dir ? (
              <ChevronRight
                size={14}
                className="text-muted-foreground/40 shrink-0"
              />
            ) : entry.size != null && !status ? (
              <span className="text-[10px] text-muted-foreground/50 shrink-0">
                {formatSize(entry.size)}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

// --- Syntax highlighting ---

type TokenType =
  | "keyword"
  | "string"
  | "comment"
  | "number"
  | "type"
  | "attr"
  | "punctuation";

const TOKEN_COLORS: Record<TokenType, [string, string]> = {
  // [light, dark]
  keyword: ["#d32f2f", "#ff7b72"],
  string: ["#2e7d32", "#a5d6ff"],
  comment: ["#6a737d", "#8b949e"],
  number: ["#1565c0", "#79c0ff"],
  type: ["#6f42c1", "#d2a8ff"],
  attr: ["#e36209", "#ffa657"],
  punctuation: ["#6e7781", "#8b949e"],
};

function getLang(filePath: string): string | null {
  const ext = filePath.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: "ts",
    tsx: "ts",
    js: "ts",
    jsx: "ts",
    mjs: "ts",
    cjs: "ts",
    rs: "rust",
    py: "python",
    go: "go",
    json: "json",
    toml: "toml",
    yaml: "yaml",
    yml: "yaml",
    html: "html",
    css: "css",
    scss: "css",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    fish: "shell",
    md: "md",
    mdx: "md",
    sql: "sql",
    dockerfile: "shell",
  };
  if (!ext) return null;
  // Handle Dockerfile, Makefile etc.
  const name = filePath.split("/").pop()?.toLowerCase() ?? "";
  if (name === "dockerfile") return "shell";
  if (name === "makefile") return "shell";
  return map[ext] ?? null;
}

const KEYWORDS: Record<string, Set<string>> = {
  ts: new Set([
    "import",
    "export",
    "from",
    "const",
    "let",
    "var",
    "function",
    "return",
    "if",
    "else",
    "for",
    "while",
    "do",
    "switch",
    "case",
    "break",
    "continue",
    "new",
    "this",
    "class",
    "extends",
    "implements",
    "interface",
    "type",
    "enum",
    "async",
    "await",
    "try",
    "catch",
    "finally",
    "throw",
    "typeof",
    "instanceof",
    "in",
    "of",
    "default",
    "yield",
    "void",
    "null",
    "undefined",
    "true",
    "false",
    "as",
    "is",
    "readonly",
    "declare",
    "abstract",
    "static",
    "private",
    "public",
    "protected",
    "super",
    "delete",
    "debugger",
    "satisfies",
  ]),
  rust: new Set([
    "fn",
    "let",
    "mut",
    "const",
    "if",
    "else",
    "for",
    "while",
    "loop",
    "match",
    "return",
    "use",
    "mod",
    "pub",
    "crate",
    "self",
    "super",
    "struct",
    "enum",
    "impl",
    "trait",
    "where",
    "async",
    "await",
    "move",
    "ref",
    "type",
    "as",
    "in",
    "unsafe",
    "extern",
    "dyn",
    "true",
    "false",
    "Some",
    "None",
    "Ok",
    "Err",
    "Self",
  ]),
  python: new Set([
    "def",
    "class",
    "if",
    "elif",
    "else",
    "for",
    "while",
    "return",
    "import",
    "from",
    "as",
    "try",
    "except",
    "finally",
    "raise",
    "with",
    "yield",
    "lambda",
    "pass",
    "break",
    "continue",
    "and",
    "or",
    "not",
    "in",
    "is",
    "None",
    "True",
    "False",
    "self",
    "async",
    "await",
    "nonlocal",
    "global",
    "assert",
    "del",
  ]),
  go: new Set([
    "func",
    "var",
    "const",
    "if",
    "else",
    "for",
    "range",
    "return",
    "package",
    "import",
    "type",
    "struct",
    "interface",
    "map",
    "chan",
    "go",
    "defer",
    "select",
    "case",
    "switch",
    "break",
    "continue",
    "default",
    "fallthrough",
    "nil",
    "true",
    "false",
    "make",
    "append",
    "len",
    "cap",
  ]),
  json: new Set([]),
  toml: new Set(["true", "false"]),
  yaml: new Set(["true", "false", "null", "yes", "no"]),
  html: new Set([]),
  css: new Set(["important"]),
  shell: new Set([
    "if",
    "then",
    "else",
    "elif",
    "fi",
    "for",
    "while",
    "do",
    "done",
    "case",
    "esac",
    "in",
    "function",
    "return",
    "export",
    "local",
    "readonly",
    "set",
    "unset",
    "source",
    "alias",
    "echo",
    "cd",
    "exit",
    "true",
    "false",
  ]),
  md: new Set([]),
  sql: new Set([
    "select",
    "from",
    "where",
    "and",
    "or",
    "not",
    "insert",
    "into",
    "values",
    "update",
    "set",
    "delete",
    "create",
    "drop",
    "alter",
    "table",
    "index",
    "join",
    "inner",
    "left",
    "right",
    "outer",
    "on",
    "as",
    "order",
    "by",
    "group",
    "having",
    "limit",
    "offset",
    "union",
    "distinct",
    "null",
    "is",
    "like",
    "in",
    "between",
    "exists",
    "case",
    "when",
    "then",
    "else",
    "end",
    "count",
    "sum",
    "avg",
    "min",
    "max",
    "true",
    "false",
  ]),
};

interface Token {
  text: string;
  type?: TokenType;
}

function tokenizeLine(line: string, lang: string | null): Token[] {
  if (!lang) return [{ text: line }];

  const tokens: Token[] = [];
  let i = 0;

  while (i < line.length) {
    // Line comments
    if (
      (lang === "ts" || lang === "rust" || lang === "go" || lang === "css") &&
      line[i] === "/" &&
      line[i + 1] === "/"
    ) {
      tokens.push({ text: line.slice(i), type: "comment" });
      return tokens;
    }
    if (
      (lang === "python" ||
        lang === "shell" ||
        lang === "toml" ||
        lang === "yaml") &&
      line[i] === "#"
    ) {
      tokens.push({ text: line.slice(i), type: "comment" });
      return tokens;
    }
    if (lang === "sql" && line[i] === "-" && line[i + 1] === "-") {
      tokens.push({ text: line.slice(i), type: "comment" });
      return tokens;
    }
    // HTML comments
    if (lang === "html" && line.slice(i, i + 4) === "<!--") {
      const end = line.indexOf("-->", i + 4);
      const slice = end >= 0 ? line.slice(i, end + 3) : line.slice(i);
      tokens.push({ text: slice, type: "comment" });
      i += slice.length;
      continue;
    }

    // Block comment start /* ... */ (inline only)
    if (
      (lang === "ts" || lang === "rust" || lang === "go" || lang === "css") &&
      line[i] === "/" &&
      line[i + 1] === "*"
    ) {
      const end = line.indexOf("*/", i + 2);
      const slice = end >= 0 ? line.slice(i, end + 2) : line.slice(i);
      tokens.push({ text: slice, type: "comment" });
      i += slice.length;
      continue;
    }

    // Strings
    if (line[i] === '"' || line[i] === "'" || line[i] === "`") {
      const quote = line[i];
      let j = i + 1;
      while (j < line.length && line[j] !== quote) {
        if (line[j] === "\\") j++;
        j++;
      }
      j = Math.min(j + 1, line.length);
      tokens.push({ text: line.slice(i, j), type: "string" });
      i = j;
      continue;
    }

    // Numbers
    if (
      /[0-9]/.test(line[i]) &&
      (i === 0 || /[\s,\(\[\{=:+\-*/<>!&|^~%]/.test(line[i - 1]))
    ) {
      let j = i;
      if (
        line[j] === "0" &&
        (line[j + 1] === "x" ||
          line[j + 1] === "X" ||
          line[j + 1] === "o" ||
          line[j + 1] === "b")
      )
        j += 2;
      while (j < line.length && /[0-9a-fA-F._]/.test(line[j])) j++;
      tokens.push({ text: line.slice(i, j), type: "number" });
      i = j;
      continue;
    }

    // Words (keywords, types)
    if (/[a-zA-Z_$]/.test(line[i])) {
      let j = i;
      while (j < line.length && /[a-zA-Z0-9_$]/.test(line[j])) j++;
      const word = line.slice(i, j);
      const kws = KEYWORDS[lang];
      if (
        kws &&
        (lang === "sql" ? kws.has(word.toLowerCase()) : kws.has(word))
      ) {
        tokens.push({ text: word, type: "keyword" });
      } else if (
        /^[A-Z]/.test(word) &&
        word.length > 1 &&
        lang !== "json" &&
        lang !== "yaml" &&
        lang !== "md"
      ) {
        tokens.push({ text: word, type: "type" });
      } else {
        tokens.push({ text: word });
      }
      i = j;
      continue;
    }

    // Decorators / attributes
    if ((lang === "python" || lang === "ts") && line[i] === "@") {
      let j = i + 1;
      while (j < line.length && /[a-zA-Z0-9_.]/.test(line[j])) j++;
      tokens.push({ text: line.slice(i, j), type: "attr" });
      i = j;
      continue;
    }
    // Rust attributes
    if (lang === "rust" && line[i] === "#" && line[i + 1] === "[") {
      const end = line.indexOf("]", i + 2);
      const slice = end >= 0 ? line.slice(i, end + 1) : line.slice(i);
      tokens.push({ text: slice, type: "attr" });
      i += slice.length;
      continue;
    }

    // Other characters
    tokens.push({ text: line[i] });
    i++;
  }

  return tokens;
}

function HighlightedLine({
  line,
  lang,
}: {
  line: string;
  lang: string | null;
}) {
  const tokens = useMemo(() => tokenizeLine(line, lang), [line, lang]);

  if (!lang || tokens.length === 1) {
    return <>{line || " "}</>;
  }

  return (
    <>
      {tokens.map((t, i) =>
        t.type ? (
          <span
            key={i}
            className="syntax-token"
            style={
              {
                "--light": TOKEN_COLORS[t.type][0],
                "--dark": TOKEN_COLORS[t.type][1],
              } as React.CSSProperties
            }
          >
            {t.text}
          </span>
        ) : (
          <span key={i}>{t.text}</span>
        ),
      )}
    </>
  );
}

// Word-level diff between two strings
type DiffSegment = { text: string; type: "same" | "add" | "del" };
function wordDiff(oldStr: string, newStr: string): DiffSegment[] {
  // Split into tokens (words + whitespace)
  const tokenize = (s: string) => s.match(/\S+|\s+/g) || [];
  const oldToks = tokenize(oldStr);
  const newToks = tokenize(newStr);
  // LCS via DP
  const m = oldToks.length,
    n = newToks.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0),
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] =
        oldToks[i - 1] === newToks[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
  // Backtrack
  const segments: DiffSegment[] = [];
  let i = m,
    j = n;
  const stack: DiffSegment[] = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldToks[i - 1] === newToks[j - 1]) {
      stack.push({ text: oldToks[i - 1], type: "same" });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({ text: newToks[j - 1], type: "add" });
      j--;
    } else {
      stack.push({ text: oldToks[i - 1], type: "del" });
      i--;
    }
  }
  stack.reverse();
  // Merge consecutive same-type segments
  for (const s of stack) {
    if (segments.length > 0 && segments[segments.length - 1].type === s.type) {
      segments[segments.length - 1].text += s.text;
    } else {
      segments.push({ ...s });
    }
  }
  return segments;
}

function FileView({
  filePath,
  project,
  onInsertRef,
  scrollRef,
}: {
  filePath: string;
  project: string;
  onInsertRef?: (ref: string) => void;
  scrollRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [selEnd, setSelEnd] = useState<number | null>(null);
  const [diff, setDiff] = useState<{
    added: Set<number>;
    modified: Set<number>;
    deletedAfter: Set<number>;
    oldLines: Map<number, string[]>;
  } | null>(null);
  const [diffIdx, setDiffIdx] = useState(-1);
  const [expandedHunk, setExpandedHunk] = useState<number | null>(null);
  const [wrap, setWrap] = useState(false);
  const tableRef = useRef<HTMLTableElement>(null);

  // Sorted list of all changed line numbers
  const changedLines = useMemo(() => {
    if (!diff) return [];
    const all = new Set<number>();
    for (const n of diff.added) all.add(n);
    for (const n of diff.modified) all.add(n);
    return Array.from(all).sort((a, b) => a - b);
  }, [diff]);

  // Group consecutive changed lines into hunks (return first line of each hunk)
  const diffHunks = useMemo(() => {
    if (changedLines.length === 0) return [];
    const hunks: number[] = [changedLines[0]];
    for (let i = 1; i < changedLines.length; i++) {
      if (changedLines[i] > changedLines[i - 1] + 1) {
        hunks.push(changedLines[i]);
      }
    }
    return hunks;
  }, [changedLines]);

  // Set of "after line" keys that have old content to peek
  const oldLineKeys = useMemo(() => {
    if (!diff) return new Set<number>();
    const keys = new Set<number>();
    for (const [k, v] of diff.oldLines) {
      if (v.length > 0) keys.add(k);
    }
    return keys;
  }, [diff]);

  // Map: line number → old_lines key (loupe on line k+1, old_lines key is k)
  const loupeLines = useMemo(() => {
    const map = new Map<number, number>();
    for (const k of oldLineKeys) {
      map.set(k + 1, k);
    }
    return map;
  }, [oldLineKeys]);

  const scrollToLine = useCallback(
    (lineNum: number) => {
      if (!tableRef.current || !scrollRef?.current) return;
      const row = tableRef.current.querySelector(`tr:nth-child(${lineNum})`);
      if (row) {
        const container = scrollRef.current;
        const rowTop = (row as HTMLElement).offsetTop;
        container.scrollTo({
          top: Math.max(0, rowTop - 80),
          behavior: "smooth",
        });
      }
    },
    [scrollRef],
  );

  useEffect(() => {
    setContent(null);
    setError(null);
    setLoading(true);
    setAnchor(null);
    setSelEnd(null);
    setDiff(null);
    setDiffIdx(-1);
    setExpandedHunk(null);

    fetch(
      `/api/file?path=${encodeURIComponent(filePath)}&project=${encodeURIComponent(project)}`,
    )
      .then((r) => {
        if (!r.ok) {
          if (r.status === 413) throw new Error("File too large (>1MB)");
          if (r.status === 422) throw new Error("Binary file");
          if (r.status === 403) throw new Error("Access denied");
          if (r.status === 404) throw new Error("File not found");
          throw new Error(`Error ${r.status}`);
        }
        return r.text();
      })
      .then(setContent)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));

    // Fetch diff in parallel
    fetch(
      `/api/git/diff?path=${encodeURIComponent(filePath)}&project=${encodeURIComponent(project)}`,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (
          data &&
          (data.added.length > 0 ||
            data.modified.length > 0 ||
            data.deleted_after.length > 0 ||
            Object.keys(data.old_lines || {}).length > 0)
        ) {
          const oldLines = new Map<number, string[]>();
          if (data.old_lines) {
            for (const [k, v] of Object.entries(data.old_lines)) {
              oldLines.set(Number(k), v as string[]);
            }
          }
          setDiff({
            added: new Set(data.added),
            modified: new Set(data.modified),
            deletedAfter: new Set(data.deleted_after),
            oldLines,
          });
        }
      })
      .catch(() => {});
  }, [filePath, project]);

  const lines = content?.split("\n") ?? [];

  const handleGutterClick = useCallback(
    (lineNum: number) => {
      if (anchor === null) {
        setAnchor(lineNum);
        setSelEnd(null);
      } else {
        setSelEnd(lineNum);
      }
    },
    [anchor],
  );

  const handleRowClick = useCallback(
    (lineNum: number) => {
      const lk = loupeLines.get(lineNum);
      if (lk !== undefined) {
        setExpandedHunk(expandedHunk === lk ? null : lk);
      }
    },
    [loupeLines, expandedHunk],
  );

  const selRange =
    anchor !== null
      ? selEnd !== null
        ? ([Math.min(anchor, selEnd), Math.max(anchor, selEnd)] as const)
        : ([anchor, anchor] as const)
      : null;

  const relPath = relativePath(filePath, project);
  const refText = selRange
    ? selRange[0] === selRange[1]
      ? `${relPath}:${selRange[0]}`
      : `${relPath}:${selRange[0]}-${selRange[1]}`
    : null;

  const handleInsert = useCallback(() => {
    if (refText && onInsertRef) {
      onInsertRef(refText);
    }
  }, [refText, onInsertRef]);

  const handleClear = useCallback(() => {
    setAnchor(null);
    setSelEnd(null);
  }, []);

  const goToHunk = useCallback(
    (idx: number) => {
      if (diffHunks.length === 0) return;
      const clamped =
        ((idx % diffHunks.length) + diffHunks.length) % diffHunks.length;
      setDiffIdx(clamped);
      scrollToLine(diffHunks[clamped]);
    },
    [diffHunks, scrollToLine],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 size={18} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 text-xs text-red-600">
        <AlertCircle size={14} />
        <span>{error}</span>
      </div>
    );
  }

  const lang = getLang(filePath);

  if (content == null) return null;

  // Collect new lines for a hunk starting after `afterLine`
  const getNewLinesForHunk = (afterLine: number): string[] => {
    if (!content) return [];
    const allLines = content.split("\n");
    const result: string[] = [];
    // Lines right after afterLine that are added or modified
    for (let n = afterLine + 1; n <= allLines.length; n++) {
      if (diff?.added.has(n) || diff?.modified.has(n)) {
        result.push(allLines[n - 1]);
      } else {
        break;
      }
    }
    return result;
  };

  // Render old lines peek (only when expanded)
  const renderOldLines = (afterLine: number) => {
    if (expandedHunk !== afterLine) return null;
    const old = diff?.oldLines.get(afterLine);
    if (!old || old.length === 0) return null;
    const newLines = getNewLinesForHunk(afterLine);
    const rows: React.ReactNode[] = [];
    const maxLen = Math.max(old.length, newLines.length);
    for (let j = 0; j < maxLen; j++) {
      const oldText = j < old.length ? old[j] : null;
      const newText = j < newLines.length ? newLines[j] : null;
      if (oldText !== null && newText !== null) {
        // Paired: show inline word diff
        const segments = wordDiff(oldText, newText);
        rows.push(
          <tr key={`del-${afterLine}-${j}`} className="bg-red-500/10">
            <td className="select-none text-right pr-3 py-0.5 border-r border-border w-10 sticky left-0 bg-red-500/10 text-red-400/50 pl-3 diff-gutter-del">
              −
            </td>
            <td className="pl-3 pr-3 py-0.5 whitespace-pre">
              {segments.map((s, si) =>
                s.type === "del" ? (
                  <span key={si} className="bg-red-500/20 text-red-400">
                    {s.text}
                  </span>
                ) : s.type === "same" ? (
                  <span key={si} className="text-muted-foreground/60">
                    {s.text}
                  </span>
                ) : null,
              )}
            </td>
          </tr>,
          <tr key={`add-${afterLine}-${j}`} className="bg-green-500/10">
            <td className="select-none text-right pr-3 py-0.5 border-r border-border w-10 sticky left-0 bg-green-500/10 text-green-400/50 pl-3 diff-gutter-add">
              +
            </td>
            <td className="pl-3 pr-3 py-0.5 whitespace-pre">
              {segments.map((s, si) =>
                s.type === "add" ? (
                  <span key={si} className="bg-green-500/20 text-green-400">
                    {s.text}
                  </span>
                ) : s.type === "same" ? (
                  <span key={si} className="text-muted-foreground/60">
                    {s.text}
                  </span>
                ) : null,
              )}
            </td>
          </tr>,
        );
      } else if (oldText !== null) {
        // Pure deletion
        rows.push(
          <tr key={`del-${afterLine}-${j}`} className="bg-red-500/10">
            <td className="select-none text-right pr-3 py-0.5 border-r border-border w-10 sticky left-0 bg-red-500/10 text-red-400/50 pl-3 diff-gutter-del">
              −
            </td>
            <td className="pl-3 pr-3 py-0.5 text-red-400/70 whitespace-pre">
              {oldText || " "}
            </td>
          </tr>,
        );
      }
      // Pure additions are already shown as normal lines with green gutter
    }
    return rows;
  };

  return (
    <div>
      {/* Toolbar */}
      <div className="sticky top-0 z-10 flex items-center justify-between px-3 py-1.5 bg-muted/80 backdrop-blur-sm border-b border-border text-xs">
        <span className="text-muted-foreground">
          {diffHunks.length > 0 ? (
            <>
              <span className="text-foreground font-medium">
                {changedLines.length}
              </span>{" "}
              line{changedLines.length !== 1 ? "s" : ""} changed
              {diffHunks.length > 1 && (
                <span className="text-muted-foreground/60">
                  {" "}
                  · {diffHunks.length} hunks
                </span>
              )}
            </>
          ) : (
            <span className="text-muted-foreground/60">
              {lines.length} lines
            </span>
          )}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setWrap(!wrap)}
            className={`p-0.5 rounded transition-colors cursor-pointer ${wrap ? "bg-muted text-foreground" : "hover:bg-muted text-muted-foreground"}`}
            title="Toggle line wrap"
          >
            <WrapText size={14} />
          </button>
          {diffHunks.length > 0 && (
            <>
              {diffIdx >= 0 && (
                <span className="text-muted-foreground/60 ml-1 mr-1">
                  {diffIdx + 1}/{diffHunks.length}
                </span>
              )}
              <button
                onClick={() =>
                  goToHunk(diffIdx <= 0 ? diffHunks.length - 1 : diffIdx - 1)
                }
                className="p-0.5 hover:bg-muted rounded transition-colors cursor-pointer"
                title="Previous change"
              >
                <ChevronUp size={14} className="text-muted-foreground" />
              </button>
              <button
                onClick={() => goToHunk(diffIdx + 1)}
                className="p-0.5 hover:bg-muted rounded transition-colors cursor-pointer"
                title="Next change"
              >
                <ChevronDown size={14} className="text-muted-foreground" />
              </button>
            </>
          )}
        </div>
      </div>

      <table ref={tableRef} className="w-full text-xs font-mono">
        <tbody>
          {renderOldLines(0)}
          {lines.map((line, i) => {
            const lineNum = i + 1;
            const inRange =
              selRange && lineNum >= selRange[0] && lineNum <= selRange[1];
            const isAdded = diff?.added.has(lineNum);
            const isMod = diff?.modified.has(lineNum);
            const hasPeek = loupeLines.has(lineNum);
            const diffClass = isAdded
              ? "diff-gutter-add"
              : isMod
                ? "diff-gutter-mod"
                : "";
            return (
              <React.Fragment key={i}>
                <tr
                  className={
                    inRange
                      ? "bg-blue-500/15"
                      : isAdded
                        ? "bg-green-500/5"
                        : isMod
                          ? "bg-blue-500/5"
                          : "hover:bg-muted/50"
                  }
                  onClick={hasPeek ? () => handleRowClick(lineNum) : undefined}
                  style={hasPeek ? { cursor: "zoom-in" } : undefined}
                >
                  <td
                    onClick={(e) => {
                      e.stopPropagation();
                      handleGutterClick(lineNum);
                    }}
                    className={`select-none text-right pr-3 py-0.5 border-r border-border w-10 sticky left-0 cursor-pointer ${diffClass ? "relative" : ""} ${diffClass} ${inRange ? "pl-3 bg-blue-500/15 text-blue-600 dark:text-blue-400 font-medium" : `${diffClass ? "pl-[9px]" : "pl-3"} ${isAdded ? "bg-green-500/5" : isMod ? "bg-blue-500/5" : "bg-background"} text-muted-foreground/60 hover:text-foreground`}`}
                  >
                    {lineNum}
                  </td>
                  <td
                    className={`pl-3 pr-3 py-0.5 text-foreground ${wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre"}`}
                  >
                    <HighlightedLine line={line} lang={lang} />
                  </td>
                </tr>
                {renderOldLines(lineNum)}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>

      {/* Selection action bar */}
      {selRange && (
        <div className="sticky bottom-3 flex justify-center pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-1.5 bg-card border border-border rounded-lg shadow-lg px-3 py-1.5">
            <span className="text-xs font-mono text-foreground">{refText}</span>
            {onInsertRef && (
              <button
                onClick={handleInsert}
                className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:bg-blue-500/10 rounded px-1.5 py-0.5 transition-colors cursor-pointer"
                title="Insert reference in chat"
              >
                <MessageSquarePlus size={12} />
                <span>Insert</span>
              </button>
            )}
            <button
              onClick={handleClear}
              className="p-0.5 hover:bg-muted rounded transition-colors cursor-pointer"
              title="Clear selection"
            >
              <X size={12} className="text-muted-foreground" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function FilePanel({
  filePath,
  project,
  browse,
  onClose,
  onInsertRef,
}: FilePanelProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>(() =>
    browse ? { type: "browse", dirPath: project } : { type: "file", filePath },
  );

  // Reset mode when props change
  useEffect(() => {
    if (browse) {
      setMode({ type: "browse", dirPath: project });
    } else {
      setMode({ type: "file", filePath });
    }
  }, [filePath, project, browse]);

  const handleNavigate = (dir: string) => {
    setMode({ type: "browse", dirPath: dir });
  };

  const handleOpenFile = (path: string, returnDir: string) => {
    setMode({ type: "file", filePath: path, returnDir });
  };

  const handleBack = () => {
    if (mode.type === "file" && mode.returnDir) {
      setMode({ type: "browse", dirPath: mode.returnDir });
    }
  };

  const headerPath = mode.type === "browse" ? mode.dirPath : mode.filePath;

  return (
    <>
      {/* Mobile overlay backdrop */}
      <div
        className="fixed inset-0 bg-black/60 z-40 lg:hidden"
        onClick={onClose}
      />

      <div className="fixed inset-0 z-50 pt-[env(safe-area-inset-top)] lg:pt-0 lg:static lg:z-auto lg:w-[500px] lg:shrink-0 lg:border-l lg:border-border flex flex-col bg-background">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border bg-muted/50 shrink-0">
          {mode.type === "file" && mode.returnDir ? (
            <button
              onClick={handleBack}
              className="p-0.5 hover:bg-muted rounded transition-colors cursor-pointer shrink-0"
            >
              <ArrowLeft size={14} className="text-muted-foreground" />
            </button>
          ) : mode.type === "browse" ? (
            <FolderOpen size={14} className="text-muted-foreground shrink-0" />
          ) : (
            <FileCode size={14} className="text-muted-foreground shrink-0" />
          )}
          <Breadcrumbs
            path={headerPath}
            project={project}
            onNavigate={handleNavigate}
          />
          <button
            onClick={onClose}
            className="p-1 hover:bg-muted rounded transition-colors cursor-pointer shrink-0"
          >
            <X size={14} className="text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div ref={scrollContainerRef} className="flex-1 overflow-auto min-h-0">
          {mode.type === "browse" ? (
            <BrowseView
              dirPath={mode.dirPath}
              project={project}
              onOpenFile={handleOpenFile}
              onNavigate={handleNavigate}
            />
          ) : (
            <FileView
              filePath={mode.filePath}
              project={project}
              onInsertRef={onInsertRef}
              scrollRef={scrollContainerRef}
            />
          )}
        </div>
      </div>
    </>
  );
}
