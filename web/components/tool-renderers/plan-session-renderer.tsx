import { useState, useCallback } from "react";
import type { ConversationMessage } from "@claude-run/api";
import { FileCode2, ChevronDown, ChevronRight } from "lucide-react";
import MessageBlock from "../message-block";

interface PlanSessionRendererProps {
  planSessionId: string;
}

export function PlanSessionRenderer(props: PlanSessionRendererProps) {
  const { planSessionId } = props;
  const [showConversation, setShowConversation] = useState(false);
  const [messages, setMessages] = useState<ConversationMessage[] | null>(null);
  const [loading, setLoading] = useState(false);

  const toggleConversation = useCallback(() => {
    if (showConversation) {
      setShowConversation(false);
      return;
    }

    if (messages !== null) {
      setShowConversation(true);
      return;
    }

    setLoading(true);
    setShowConversation(true);

    fetch(`/api/conversation/${planSessionId}`)
      .then((r) => r.json())
      .then((msgs: ConversationMessage[]) => {
        setMessages(msgs);
        setLoading(false);
      })
      .catch(() => {
        setMessages([]);
        setLoading(false);
      });
  }, [planSessionId, showConversation, messages]);

  const conversationMessages = messages?.filter(
    (m) => m.type === "user" || m.type === "assistant",
  );

  return (
    <div className="w-full mt-2">
      <div className="bg-card/80 border border-border rounded-lg overflow-hidden">
        <button
          onClick={toggleConversation}
          className="flex items-center gap-2 w-full px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          {showConversation ? (
            <ChevronDown size={12} />
          ) : (
            <ChevronRight size={12} />
          )}
          <FileCode2 size={12} className="text-muted-foreground" />
          <span>{showConversation ? "Hide" : "View"} plan implementation</span>
          {conversationMessages !== undefined &&
            conversationMessages !== null && (
              <span className="text-[10px] text-muted-foreground/60 ml-1">
                ({conversationMessages.length} messages)
              </span>
            )}
        </button>

        {showConversation && (
          <div className="border-l-2 border-border ml-3 mr-3 mb-3">
            {loading ? (
              <div className="px-4 py-3 text-xs text-muted-foreground">
                Loading conversation...
              </div>
            ) : conversationMessages && conversationMessages.length > 0 ? (
              <div className="flex flex-col gap-1.5 pl-3 pt-2">
                {conversationMessages.map((msg, index) => (
                  <MessageBlock key={msg.uuid || index} message={msg} />
                ))}
              </div>
            ) : (
              <div className="px-4 py-3 text-xs text-muted-foreground">
                No conversation data available
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
