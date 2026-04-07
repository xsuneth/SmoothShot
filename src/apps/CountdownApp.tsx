import { useEffect, useRef, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

import { EVT_COUNTDOWN_START } from "../lib/constants";

/**
 * Transparent overlay shown on the target display before recording starts.
 * Waits for `EVT_COUNTDOWN_START` before counting down 3 → 1, so the
 * timer is always fresh even after the window has been shown before.
 */
export function CountdownApp() {
  const [count, setCount] = useState<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function startCountdown() {
    // Clear any in-progress countdown first.
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    setCount(3);

    let n = 3;
    intervalRef.current = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        setCount(null);
      } else {
        setCount(n);
      }
    }, 1000);
  }

  useEffect(() => {
    const win = getCurrentWebviewWindow();
    let unlisten: (() => void) | undefined;

    void win
      .listen(EVT_COUNTDOWN_START, () => {
        startCountdown();
      })
      .then((fn) => {
        unlisten = fn;
      });

    return () => {
      unlisten?.();
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  return (
    <main
      className="flex h-screen w-screen items-center justify-center bg-transparent"
      data-tauri-drag-region
    >
      {count !== null && count > 0 && (
        <div
          className="flex items-center justify-center rounded-full bg-black/60 backdrop-blur-md"
          style={{ width: 200, height: 200 }}
        >
          <span
            key={count}
            className="select-none font-bold text-white"
            style={{
              fontSize: 108,
              lineHeight: 1,
              textShadow: "0 4px 28px rgba(0,0,0,0.65)",
              animation: "cpop 0.3s cubic-bezier(0.34,1.56,0.64,1) both",
            }}
          >
            {count}
          </span>
        </div>
      )}

      <style>{`
        @keyframes cpop {
          from { transform: scale(1.55); opacity: 0; }
          to   { transform: scale(1);    opacity: 1; }
        }
      `}</style>
    </main>
  );
}
