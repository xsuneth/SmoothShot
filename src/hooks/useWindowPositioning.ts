import { useCallback } from "react";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { availableMonitors, currentMonitor, getCurrentWindow, primaryMonitor } from "@tauri-apps/api/window";

/**
 * Positions and reveals the launcher window in the expected bottom-center location.
 */
export interface UseWindowPositioningResult {
  positionAndShow: (animate?: boolean) => Promise<void>;
  snapLauncherToDefaultPosition: () => Promise<void>;
}

interface UseWindowPositioningParams {
  onVisibleChange: (visible: boolean) => void;
}

export function useWindowPositioning({ onVisibleChange }: UseWindowPositioningParams): UseWindowPositioningResult {
  // Startup/default launcher placement. Adjust these if you want a different baseline.
  const BOTTOM_MARGIN = 70;

  const resolveMonitor = useCallback(async () => {
    const active = await currentMonitor();
    if (active) return active;

    const primary = await primaryMonitor();
    if (primary) return primary;

    const all = await availableMonitors();
    return all[0] ?? null;
  }, []);

  const positionLauncherBar = useCallback(async () => {
    try {
      const win = getCurrentWindow();
      const monitor = await resolveMonitor();
      if (!monitor) {
        return;
      }

      const windowSize = await win.innerSize();
      const scale = monitor.scaleFactor || 1;
      const monitorX = monitor.position.x / scale;
      const monitorY = monitor.position.y / scale;
      const monitorWidth = monitor.size.width / scale;
      const monitorHeight = monitor.size.height / scale;
      const width = windowSize.width / scale;
      const height = windowSize.height / scale;

      const x = Math.round(monitorX + (monitorWidth - width) / 2);
      const y = Math.round(monitorY + monitorHeight - height - BOTTOM_MARGIN);
      await win.setPosition(new LogicalPosition(x, y));
    } catch {
      // Ignore positioning failures and keep default placement.
    }
  }, [resolveMonitor]);

  const positionAndShow = useCallback(async (animate = false) => {
    try {
      const win = getCurrentWindow();
      onVisibleChange(false);

      // The Rust setup hook already positioned the window before JS ran.
      // One re-position here is enough to handle any edge cases (e.g. multi-monitor
      // where the primary monitor query in Rust and JS may differ slightly).
      await positionLauncherBar();
      await win.show();

      if (animate) {
        window.setTimeout(() => onVisibleChange(true), 24);
      } else {
        onVisibleChange(true);
      }
    } catch {
      onVisibleChange(true);
    }
  }, [onVisibleChange, positionLauncherBar]);

  return {
    positionAndShow,
    snapLauncherToDefaultPosition: positionLauncherBar,
  };
}
