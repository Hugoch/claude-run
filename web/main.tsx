import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app";
import "./index.css";

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const stack =
      (error.stack || "") + "\nComponent: " + (info.componentStack || "");
    fetch("/api/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: error.message, stack }),
    }).catch(() => {});
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 20, fontFamily: "monospace", color: "#ef4444" }}>
          <h2>Something went wrong</h2>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>
            {this.state.error.message}
            {"\n"}
            {this.state.error.stack}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: 10, padding: "6px 12px", cursor: "pointer" }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(console.error);
}

// Report client errors to server for visibility
function reportError(error: string, stack?: string) {
  fetch("/api/client-error", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ error, stack }),
  }).catch(() => {});
}

window.onerror = (msg, src, line, col, err) => {
  console.error("[global error]", msg, src, line, col, err);
  reportError(String(msg), err?.stack);
};
window.onunhandledrejection = (e) => {
  console.error("[unhandled rejection]", e.reason);
  reportError(String(e.reason), e.reason?.stack);
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
