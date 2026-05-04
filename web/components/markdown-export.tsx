import { useState, useCallback } from "react";
import type { Session } from "@claude-run/api";
import { Copy, Check, X, FileText } from "lucide-react";

interface MarkdownExportProps {
  session: Session;
  messages: Array<{
    type: string;
    message?: {
      role?: string;
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
}

export function MarkdownExportButton({
  session,
  messages,
}: MarkdownExportProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const generateMarkdown = useCallback(() => {
    const conversationMessages = messages.filter(
      (m) => m.type === "user" || m.type === "assistant",
    );

    const summary = messages.find((m) => m.type === "summary") as any;

    let markdown = `# ${session.display}\n\n`;
    markdown += `**Project**: ${session.projectName}\n`;
    markdown += `**Time**: ${new Date(session.timestamp).toLocaleString()}\n\n`;
    markdown += `---\n\n`;

    if (summary?.summary) {
      markdown += `> 📋 **Summary**: ${summary.summary}\n\n`;
      markdown += `---\n\n`;
    }

    for (const msg of conversationMessages) {
      const isUser = msg.type === "user";
      const role = isUser ? "👤 User" : "🤖 Claude";

      let content = "";
      if (typeof msg.message?.content === "string") {
        content = msg.message.content;
      } else if (Array.isArray(msg.message?.content)) {
        content = msg.message.content
          .map((block) => {
            if (block.type === "text" && block.text) return block.text;
            if (block.type === "thinking" && (block as any).thinking)
              return `<thinking>${(block as any).thinking}</thinking>`;
            return "";
          })
          .join("");
      }

      if (!content.trim()) continue;

      markdown += `## ${role}\n\n`;

      // Process content: handle code blocks and escape special characters
      const lines = content.split("\n");
      let inCodeBlock = false;
      let codeBlockLang = "";
      let codeBlockContent: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const codeBlockMatch = line.match(/^```(\w*)$/);

        if (codeBlockMatch) {
          if (!inCodeBlock) {
            inCodeBlock = true;
            codeBlockLang = codeBlockMatch[1] || "";
            codeBlockContent = [];
          } else {
            // End of code block
            inCodeBlock = false;
            markdown += "\n" + "```" + codeBlockLang + "\n";
            markdown += codeBlockContent.join("\n");
            markdown += "\n```\n\n";
            codeBlockLang = "";
            codeBlockContent = [];
          }
          continue;
        }

        if (inCodeBlock) {
          codeBlockContent.push(line);
        } else {
          // Regular text - escape headings that aren't meant to be headings
          if (line.startsWith("#")) {
            markdown += "\\" + line + "\n";
          } else {
            markdown += line + "\n";
          }
        }
      }

      // Handle unclosed code block
      if (inCodeBlock && codeBlockContent.length > 0) {
        markdown += "\n" + "```" + codeBlockLang + "\n";
        markdown += codeBlockContent.join("\n");
        markdown += "\n```\n\n";
      }

      markdown += "\n";
    }

    markdown += `---\n\n`;
    markdown += `*Exported from Claude Run • ${new Date().toLocaleString()}*`;

    return markdown;
  }, [session, messages]);

  const handleCopy = useCallback(async () => {
    const markdown = generateMarkdown();

    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  }, [generateMarkdown]);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    setCopied(false);
  }, []);

  const markdown = generateMarkdown();
  const previewLines = markdown.split("\n").slice(0, 30).join("\n");
  const hasMore = markdown.split("\n").length > 30;

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-foreground bg-muted hover:bg-muted/60 rounded transition-colors cursor-pointer shrink-0"
        title="Copy as Markdown"
      >
        <FileText className="w-3.5 h-3.5" />
        <span>Copy Markdown</span>
      </button>

      {isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card rounded-lg border border-border w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="text-sm font-medium text-foreground">
                Copy as Markdown
              </h3>
              <button
                onClick={handleClose}
                className="p-1 hover:bg-muted rounded transition-colors"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            <div className="flex-1 overflow-hidden flex flex-col">
              <div className="p-4 text-xs text-muted-foreground border-b border-border">
                <p>
                  Markdown content generated. You can copy and paste it into
                  Notion, Obsidian, or any Markdown-compatible app.
                </p>
              </div>

              <div className="flex-1 overflow-auto p-4">
                <pre className="text-xs text-foreground bg-background p-4 rounded border border-border font-mono whitespace-pre-wrap break-words">
                  {previewLines}
                  {hasMore && (
                    <span className="text-muted-foreground/60">
                      {
                        "\n\n... (Content truncated. Copy to get the full content.)"
                      }
                    </span>
                  )}
                </pre>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
              <button
                onClick={handleClose}
                className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Close
              </button>
              <button
                onClick={handleCopy}
                className="flex items-center gap-2 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy All</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
