import { useEffect, useRef, useState, useMemo } from "react";
import { X, Terminal } from "lucide-react";
import Anser from "anser";

interface TailPanelProps {
  filePath: string;
  description: string;
  onClose: () => void;
}

export function TailPanel({ filePath, description, onClose }: TailPanelProps) {
  const [content, setContent] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    setContent("");
    setDone(false);
    setError(null);

    const es = new EventSource(
      `/api/tail?path=${encodeURIComponent(filePath)}`,
    );

    es.addEventListener("content", (e) => {
      setContent((prev) => prev + e.data);
    });

    es.addEventListener("done", () => {
      setDone(true);
      es.close();
    });

    es.addEventListener("error", (e) => {
      if (e instanceof MessageEvent) {
        setError(e.data);
      }
      es.close();
    });

    es.onerror = () => {
      es.close();
    };

    return () => es.close();
  }, [filePath]);

  useEffect(() => {
    if (preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [content]);

  const html = useMemo(() => {
    if (!content) return "";
    return Anser.ansiToHtml(content, { use_classes: false });
  }, [content]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-3xl mx-4 max-h-[80vh] flex flex-col rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-card/80">
          <Terminal size={14} className="text-muted-foreground shrink-0" />
          <span className="text-xs text-foreground/80 truncate flex-1">
            {description}
          </span>
          {done && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-green-600/10 text-green-600 shrink-0">
              Done
            </span>
          )}
          {error && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-red-600/10 text-red-600 shrink-0">
              Error
            </span>
          )}
          <button
            onClick={onClose}
            className="shrink-0 p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>
        <pre
          ref={preRef}
          className="flex-1 overflow-auto p-4 text-[12px] leading-relaxed text-foreground/80 font-mono whitespace-pre-wrap break-words"
        >
          {html ? (
            <span dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            error || "Waiting for output..."
          )}
        </pre>
      </div>
    </div>
  );
}
