import { Search, FileText, FolderOpen } from "lucide-react";
import { CopyButton } from "./copy-button";

interface GrepInput {
  pattern: string;
  path?: string;
  glob?: string;
  type?: string;
}

interface GlobInput {
  pattern: string;
  path?: string;
}

interface GrepRendererProps {
  input: GrepInput;
}

interface GlobRendererProps {
  input: GlobInput;
}

interface SearchResultRendererProps {
  content: string;
  isFileList?: boolean;
}

export function GrepRenderer(props: GrepRendererProps) {
  const { input } = props;

  if (!input || !input.pattern) {
    return null;
  }

  return (
    <div className="w-full mt-2">
      <div className="bg-card/80 border border-border rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/50">
          <Search size={14} className="text-muted-foreground" />
          <span className="text-xs font-medium text-foreground">Search</span>
        </div>
        <div className="p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Pattern:</span>
            <code className="text-xs font-mono text-foreground bg-muted px-1.5 py-0.5 rounded">
              {input.pattern}
            </code>
          </div>
          {input.path && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Path:</span>
              <span className="text-xs font-mono text-foreground">
                {input.path}
              </span>
            </div>
          )}
          {input.glob && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Glob:</span>
              <span className="text-xs font-mono text-foreground">
                {input.glob}
              </span>
            </div>
          )}
          {input.type && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Type:</span>
              <span className="text-xs font-mono text-foreground">
                {input.type}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function GlobRenderer(props: GlobRendererProps) {
  const { input } = props;

  if (!input || !input.pattern) {
    return null;
  }

  return (
    <div className="w-full mt-2">
      <div className="bg-card/80 border border-border rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/50">
          <FolderOpen size={14} className="text-muted-foreground" />
          <span className="text-xs font-medium text-foreground">
            Find Files
          </span>
        </div>
        <div className="p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Pattern:</span>
            <code className="text-xs font-mono text-foreground bg-muted px-1.5 py-0.5 rounded">
              {input.pattern}
            </code>
          </div>
          {input.path && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Path:</span>
              <span className="text-xs font-mono text-foreground">
                {input.path}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function SearchResultRenderer(props: SearchResultRendererProps) {
  const { content, isFileList } = props;

  if (!content || content.trim().length === 0) {
    return (
      <div className="w-full mt-2">
        <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border border-border rounded-lg">
          <Search size={14} className="text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
            No matches found
          </span>
        </div>
      </div>
    );
  }

  const lines = content.split("\n").filter((l) => l.trim());
  const maxLines = 25;
  const truncated = lines.length > maxLines;
  const displayLines = truncated ? lines.slice(0, maxLines) : lines;

  if (isFileList) {
    return (
      <div className="w-full mt-2">
        <div className="bg-card/80 border border-border rounded-lg overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/50">
            <FolderOpen size={14} className="text-muted-foreground" />
            <span className="text-xs font-medium text-foreground">
              Files Found
            </span>
            <span className="text-xs text-muted-foreground ml-auto">
              {lines.length} files
            </span>
          </div>
          <div className="overflow-y-auto max-h-60">
            <ul className="divide-y divide-border">
              {displayLines.map((line, index) => (
                <li
                  key={index}
                  className="group flex items-center gap-2 px-3 py-1.5 hover:bg-muted/50"
                >
                  <FileText
                    size={12}
                    className="text-muted-foreground flex-shrink-0"
                  />
                  <span className="text-xs font-mono text-foreground truncate flex-1">
                    {line}
                  </span>
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                    <CopyButton text={line} />
                  </div>
                </li>
              ))}
            </ul>
            {truncated && (
              <div className="px-3 py-2 text-xs text-muted-foreground border-t border-border">
                ... {lines.length - maxLines} more files
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full mt-2">
      <div className="bg-card/80 border border-border rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/50">
          <Search size={14} className="text-muted-foreground" />
          <span className="text-xs font-medium text-foreground">Results</span>
          <span className="text-xs text-muted-foreground ml-auto">
            {lines.length} matches
          </span>
        </div>
        <div className="overflow-x-auto ">
          <pre className="text-xs font-mono p-3 text-foreground whitespace-pre-wrap">
            {displayLines.join("\n")}
            {truncated && (
              <div className="text-muted-foreground mt-2 pt-2 border-t border-border">
                ... {lines.length - maxLines} more matches
              </div>
            )}
          </pre>
        </div>
      </div>
    </div>
  );
}
