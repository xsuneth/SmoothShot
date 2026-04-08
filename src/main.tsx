import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import "./styles.css";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";

// Prevent white WebView2 background on non-transparent windows (e.g. editor).
// Transparent windows override this via their own component backgrounds.
try {
  if (getCurrentWebviewWindow().label === "editor") {
    document.documentElement.style.background = "#0c0d12";
    document.body.style.background = "#0c0d12";
  }
} catch { /* ignore — browser/test env */ }

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
