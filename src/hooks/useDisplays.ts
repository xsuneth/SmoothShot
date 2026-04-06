import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type { DisplayDescriptor } from "../types";
import { useAppStore } from "../store/useAppStore";

export interface UseDisplaysResult {
  displays: DisplayDescriptor[];
  displaySelection: string;
  isLoading: boolean;
  setDisplaySelection: (selection: string) => void;
  loadDisplays: (opts?: { includePreviews?: boolean }) => Promise<DisplayDescriptor[]>;
}

export function useDisplays(): UseDisplaysResult {
  const [displays, setDisplays] = useState<DisplayDescriptor[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const displaySelection = useAppStore((s) => s.displaySelection);
  const setDisplaySelection = useAppStore((s) => s.setDisplaySelection);

  const loadDisplays = useCallback(async (opts?: { includePreviews?: boolean }) => {
    setIsLoading(true);
    try {
      const availableDisplays = await invoke<DisplayDescriptor[]>("list_displays", {
        request: opts?.includePreviews ? { includePreviews: true } : null,
      });
      setDisplays(availableDisplays);

      // Validate persisted selection against the current display list.
      const current = useAppStore.getState().displaySelection;
      if (!availableDisplays.some((d) => String(d.index) === current)) {
        const first = availableDisplays[0];
        setDisplaySelection(first ? String(first.index) : "");
      }

      return availableDisplays;
    } catch {
      setDisplays([]);
      setDisplaySelection("");
      return [];
    } finally {
      setIsLoading(false);
    }
  }, [setDisplaySelection]);

  useEffect(() => {
    void loadDisplays();
  }, [loadDisplays]);

  return {
    displays,
    displaySelection,
    isLoading,
    setDisplaySelection,
    loadDisplays,
  };
}
