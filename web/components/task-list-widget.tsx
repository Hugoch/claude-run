import { useState } from "react";
import {
  Circle,
  CircleCheck,
  Loader2,
  ListTodo,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import type { ConversationMessage } from "@claude-run/api";

export interface TaskItem {
  id: string;
  subject: string;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string;
}

export function buildTaskState(messages: ConversationMessage[]): TaskItem[] {
  const tasks = new Map<string, TaskItem>();
  let nextId = 1;

  for (const msg of messages) {
    if (msg.type !== "assistant" || !msg.message?.content) continue;
    const content = msg.message.content;
    if (typeof content === "string") continue;

    for (const block of content) {
      if (block.type !== "tool_use" || !block.input) continue;
      const input = block.input as Record<string, unknown>;

      if (block.name === "TaskCreate") {
        const id = String(nextId++);
        tasks.set(id, {
          id,
          subject: String(input.subject || ""),
          status: "pending",
          activeForm: input.activeForm ? String(input.activeForm) : undefined,
        });
      }

      if (block.name === "TaskUpdate") {
        const taskId = String(input.taskId || "");
        const task = tasks.get(taskId);
        if (!task) continue;
        if (input.status === "deleted") {
          tasks.delete(taskId);
        } else if (input.status) {
          task.status = input.status as TaskItem["status"];
        }
        if (input.subject) {
          task.subject = String(input.subject);
        }
      }
    }
  }

  return Array.from(tasks.values());
}

function TaskRow({ task }: { task: TaskItem }) {
  return (
    <li className="flex items-start gap-2.5 px-3 py-2">
      <span className="mt-0.5 flex-shrink-0">
        {task.status === "completed" ? (
          <CircleCheck size={14} className="text-green-600" />
        ) : task.status === "in_progress" ? (
          <Loader2 size={14} className="text-muted-foreground animate-spin" />
        ) : (
          <Circle size={14} className="text-muted-foreground" />
        )}
      </span>
      <span
        className={`text-xs leading-relaxed ${
          task.status === "completed"
            ? "text-muted-foreground line-through"
            : task.status === "in_progress"
              ? "text-foreground"
              : "text-foreground"
        }`}
      >
        {task.status === "in_progress" && task.activeForm
          ? task.activeForm
          : task.subject}
      </span>
    </li>
  );
}

export function TaskListWidget({ tasks }: { tasks: TaskItem[] }) {
  const completed = tasks.filter((t) => t.status === "completed");
  const active = tasks.filter((t) => t.status !== "completed");
  const allCompleted = active.length === 0;
  const [showCompleted, setShowCompleted] = useState(false);

  const completedCount = completed.length;
  const total = tasks.length;

  return (
    <div className="bg-card/95 backdrop-blur border border-border rounded-lg overflow-hidden shadow-xl">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
        <ListTodo size={14} className="text-muted-foreground" />
        <span className="text-xs font-medium text-foreground">Tasks</span>
        <span className="text-xs text-muted-foreground ml-auto">
          {completedCount}/{total}
        </span>
        <div className="w-16 h-1.5 bg-border rounded-full overflow-hidden">
          <div
            className="h-full bg-muted-foreground transition-all duration-500"
            style={{ width: `${(completedCount / total) * 100}%` }}
          />
        </div>
      </div>
      <ul className="divide-y divide-border/50 max-h-48 overflow-y-auto">
        {completedCount > 0 && !allCompleted && (
          <li>
            <button
              onClick={() => setShowCompleted(!showCompleted)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-muted-foreground hover:text-muted-foreground hover:bg-muted/30 transition-colors cursor-pointer"
            >
              {showCompleted ? (
                <ChevronDown size={12} />
              ) : (
                <ChevronRight size={12} />
              )}
              <span>{completedCount} completed</span>
            </button>
          </li>
        )}
        {(showCompleted || allCompleted) &&
          completed.map((task) => <TaskRow key={task.id} task={task} />)}
        {active.map((task) => (
          <TaskRow key={task.id} task={task} />
        ))}
      </ul>
    </div>
  );
}
