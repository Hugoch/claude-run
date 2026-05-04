import { useState, useRef, useCallback } from "react";
import { createTwoFilesPatch } from "diff";
import {
  FileEdit,
  Plus,
  Minus,
  FilePlus2,
  Eye,
  Code,
  ExternalLink,
} from "lucide-react";
import { CopyButton } from "./copy-button";

interface EditInput {
  file_path: string;
  old_string: string;
  new_string: string;
}

interface WriteInput {
  file_path: string;
  content: string;
}

interface EditRendererProps {
  input: EditInput;
  onOpenFile?: (filePath: string) => void;
}

interface WriteRendererProps {
  input: WriteInput;
  onOpenFile?: (filePath: string) => void;
}

function getFileName(filePath: string) {
  const parts = filePath.split("/");
  return parts.slice(-2).join("/");
}

function parseDiff(diffText: string) {
  const lines = diffText.split("\n");
  const result: Array<{
    type: "add" | "remove" | "context" | "header";
    content: string;
  }> = [];

  for (const line of lines) {
    if (line.startsWith("@@")) {
      result.push({ type: "header", content: line });
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      result.push({ type: "add", content: line.slice(1) });
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      result.push({ type: "remove", content: line.slice(1) });
    } else if (line.startsWith(" ")) {
      result.push({ type: "context", content: line.slice(1) });
    }
  }

  return result;
}

export function EditRenderer(props: EditRendererProps) {
  const { input, onOpenFile } = props;

  if (!input || !input.file_path) {
    return null;
  }

  const oldStr = input.old_string || "";
  const newStr = input.new_string || "";
  const fileName = getFileName(input.file_path);

  const diff = createTwoFilesPatch(
    "a/" + fileName,
    "b/" + fileName,
    oldStr,
    newStr,
    "",
    "",
    {
      context: 3,
    },
  );

  const parsedLines = parseDiff(diff);
  const addedLines = parsedLines.filter((l) => l.type === "add").length;
  const removedLines = parsedLines.filter((l) => l.type === "remove").length;

  return (
    <div className="w-full mt-2">
      <div className="bg-card/80 border border-border rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/50">
          <FileEdit size={14} className="text-muted-foreground" />
          <span className="text-xs font-mono text-foreground">{fileName}</span>
          <div className="flex items-center gap-2 ml-auto text-xs">
            {addedLines > 0 && (
              <span className="flex items-center gap-0.5 text-green-600">
                <Plus size={12} />
                {addedLines}
              </span>
            )}
            {removedLines > 0 && (
              <span className="flex items-center gap-0.5 text-red-600">
                <Minus size={12} />
                {removedLines}
              </span>
            )}
            <CopyButton text={input.file_path} />
            {onOpenFile && (
              <button
                onClick={() => onOpenFile(input.file_path)}
                className="p-1 hover:bg-muted rounded transition-colors cursor-pointer"
                title="Open in side panel"
              >
                <ExternalLink size={12} className="text-muted-foreground" />
              </button>
            )}
          </div>
        </div>
        <div className="overflow-x-auto ">
          <pre className="text-xs font-mono p-0">
            {parsedLines.map((line, index) => {
              if (line.type === "header") {
                return (
                  <div
                    key={index}
                    className="px-3 py-1 bg-muted/50 text-muted-foreground border-y border-border"
                  >
                    {line.content}
                  </div>
                );
              }
              if (line.type === "add") {
                return (
                  <div
                    key={index}
                    className="px-3 py-0.5 bg-green-600/10 text-green-700 dark:text-green-300 border-l-2 border-green-600"
                  >
                    <span className="select-none text-green-600 mr-2">+</span>
                    {line.content || " "}
                  </div>
                );
              }
              if (line.type === "remove") {
                return (
                  <div
                    key={index}
                    className="px-3 py-0.5 bg-red-600/10 text-red-700 dark:text-red-300 border-l-2 border-red-600"
                  >
                    <span className="select-none text-red-600 mr-2">-</span>
                    {line.content || " "}
                  </div>
                );
              }
              return (
                <div key={index} className="px-3 py-0.5 text-muted-foreground">
                  <span className="select-none text-muted-foreground/60 mr-2">
                    {" "}
                  </span>
                  {line.content || " "}
                </div>
              );
            })}
          </pre>
        </div>
      </div>
    </div>
  );
}

function isHtmlFile(filePath: string) {
  return /\.html?$/i.test(filePath);
}

export function WriteRenderer(props: WriteRendererProps) {
  const { input, onOpenFile } = props;
  const isHtml = input?.file_path && isHtmlFile(input.file_path);
  const [view, setView] = useState<"preview" | "source">(
    isHtml ? "preview" : "source",
  );
  const [iframeHeight, setIframeHeight] = useState(400);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startH = useRef(0);

  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      startY.current = e.clientY;
      startH.current = iframeHeight;
      const onMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        setIframeHeight(
          Math.max(150, startH.current + ev.clientY - startY.current),
        );
      };
      const onUp = () => {
        dragging.current = false;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [iframeHeight],
  );

  if (!input || !input.file_path) {
    return null;
  }

  const content = input.content || "";
  const fileName = getFileName(input.file_path);
  const lineCount = content.split("\n").length;

  return (
    <div className="w-full mt-2">
      <div className="bg-card/80 border border-border rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/50">
          <FilePlus2 size={14} className="text-muted-foreground" />
          <span className="text-xs font-mono text-foreground">{fileName}</span>
          {isHtml && (
            <div className="flex items-center gap-0.5 ml-2 bg-muted rounded p-0.5">
              <button
                onClick={() => setView("preview")}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-colors cursor-pointer ${
                  view === "preview"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Eye size={10} />
                Preview
              </button>
              <button
                onClick={() => setView("source")}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-colors cursor-pointer ${
                  view === "source"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Code size={10} />
                Source
              </button>
            </div>
          )}
          <div className="flex items-center gap-1 ml-auto">
            <span className="text-xs text-muted-foreground">
              {lineCount} lines
            </span>
            <CopyButton text={input.file_path} />
            {onOpenFile && (
              <button
                onClick={() => onOpenFile(input.file_path)}
                className="p-1 hover:bg-muted rounded transition-colors cursor-pointer"
                title="Open in side panel"
              >
                <ExternalLink size={12} className="text-muted-foreground" />
              </button>
            )}
          </div>
        </div>
        {isHtml && view === "preview" ? (
          <>
            <iframe
              sandbox="allow-scripts"
              srcDoc={content}
              className="w-full border-0"
              style={{ height: iframeHeight }}
            />
            <div
              onMouseDown={onDragStart}
              className="h-1.5 cursor-row-resize bg-muted/50 hover:bg-muted border-t border-border flex items-center justify-center"
            >
              <div className="w-8 h-0.5 rounded-full bg-muted-foreground/30" />
            </div>
          </>
        ) : (
          <div className="overflow-x-auto">
            <pre className="text-xs font-mono p-3 text-foreground">
              {content.slice(0, 500)}
              {content.length > 500 && (
                <span className="text-muted-foreground">
                  ... ({content.length - 500} more chars)
                </span>
              )}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
