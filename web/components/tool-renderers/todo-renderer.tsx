import { Circle, CircleCheck, Loader2, ListTodo } from "lucide-react";

interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

interface TodoRendererProps {
  todos: TodoItem[];
}

function getStatusIcon(status: string) {
  if (status === "completed") {
    return <CircleCheck size={14} className="text-green-600" />;
  }
  if (status === "in_progress") {
    return <Loader2 size={14} className="text-muted-foreground animate-spin" />;
  }
  return <Circle size={14} className="text-muted-foreground" />;
}

function getStatusClass(status: string) {
  if (status === "completed") {
    return "text-muted-foreground line-through";
  }
  if (status === "in_progress") {
    return "text-foreground";
  }
  return "text-foreground";
}

export function TodoRenderer(props: TodoRendererProps) {
  const { todos } = props;

  if (!todos || todos.length === 0) {
    return null;
  }

  const completedCount = todos.filter((t) => t.status === "completed").length;
  const totalCount = todos.length;

  return (
    <div className="w-full mt-2">
      <div className="bg-card/80 border border-border rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/50">
          <ListTodo size={14} className="text-muted-foreground" />
          <span className="text-xs font-medium text-foreground">Tasks</span>
          <span className="text-xs text-muted-foreground ml-auto">
            {completedCount}/{totalCount}
          </span>
          <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-muted-foreground transition-all duration-300"
              style={{ width: `${(completedCount / totalCount) * 100}%` }}
            />
          </div>
        </div>
        <ul className="divide-y divide-border">
          {todos.map((todo, index) => (
            <li
              key={index}
              className="flex items-start gap-2.5 px-3 py-2 hover:bg-muted/50 transition-colors"
            >
              <span className="mt-0.5 flex-shrink-0">
                {getStatusIcon(todo.status)}
              </span>
              <span
                className={`text-xs leading-relaxed ${getStatusClass(todo.status)}`}
              >
                {todo.content}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
