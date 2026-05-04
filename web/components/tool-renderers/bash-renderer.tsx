import {
  Terminal,
  Play,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Check,
} from "lucide-react";
import { useState } from "react";

interface BashInput {
  command: string;
  description?: string;
  timeout?: number;
}

interface BashRendererProps {
  input: BashInput;
}

interface BashResultRendererProps {
  content: string;
  isError?: boolean;
}

export function BashRenderer(props: BashRendererProps) {
  const { input } = props;
  const [copied, setCopied] = useState(false);

  if (!input || !input.command) {
    return null;
  }

  const command = input.command;
  const description = input.description;

  const handleCopy = () => {
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-full mt-2">
      <div className="bg-card/80 border border-border rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/50">
          <Terminal size={14} className="text-muted-foreground" />
          <span className="text-xs font-medium text-foreground">Command</span>
          {description && (
            <span className="text-xs text-muted-foreground truncate ml-1">
              — {description}
            </span>
          )}
          <button
            onClick={handleCopy}
            className="ml-auto p-1 hover:bg-muted rounded transition-colors"
            title="Copy command"
          >
            {copied ? (
              <Check size={12} className="text-green-600" />
            ) : (
              <Copy size={12} className="text-muted-foreground" />
            )}
          </button>
        </div>
        <div className="p-3 overflow-x-auto">
          <div className="flex items-start gap-2">
            <pre className="text-xs font-mono m-0 p-0 bg-transparent! text-foreground whitespace-pre-wrap break-all">
              {command}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

export function BashResultRenderer(props: BashResultRendererProps) {
  const { content, isError } = props;

  if (!content || content.trim().length === 0) {
    return (
      <div className="w-full mt-2">
        <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border border-border rounded-lg">
          <CheckCircle2 size={14} className="text-green-600" />
          <span className="text-xs text-muted-foreground">
            Command completed successfully (no output)
          </span>
        </div>
      </div>
    );
  }

  const lines = content.split("\n");
  const maxLines = 30;
  const truncated = lines.length > maxLines;
  const displayLines = truncated ? lines.slice(0, maxLines) : lines;

  return (
    <div className="w-full mt-2">
      <div
        className={`border rounded-lg overflow-hidden ${
          isError
            ? "bg-destructive/10 border-destructive/20"
            : "bg-card/80 border-border"
        }`}
      >
        <div
          className={`flex items-center gap-2 px-3 py-2 border-b ${
            isError
              ? "border-destructive/20 bg-destructive/10"
              : "border-border bg-muted/50"
          }`}
        >
          {isError ? (
            <>
              <AlertTriangle size={14} className="text-red-600" />
              <span className="text-xs font-medium text-red-600">
                Error Output
              </span>
            </>
          ) : (
            <>
              <Play size={14} className="text-muted-foreground" />
              <span className="text-xs font-medium text-foreground">
                Output
              </span>
            </>
          )}
          <span className="text-xs text-muted-foreground ml-auto">
            {lines.length} lines
          </span>
        </div>
        <div className="overflow-x-auto ">
          <pre
            className={`text-xs font-mono p-3 whitespace-pre-wrap break-all ${
              isError ? "text-foreground/80" : "text-foreground"
            }`}
          >
            {displayLines.join("\n")}
            {truncated && (
              <div className="text-muted-foreground mt-2 pt-2 border-t border-border">
                ... {lines.length - maxLines} more lines
              </div>
            )}
          </pre>
        </div>
      </div>
    </div>
  );
}
