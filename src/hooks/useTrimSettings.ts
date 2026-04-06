import { useEffect, useState } from "react";

import type { StopRecordingResponse } from "../types";

export interface UseTrimSettingsResult {
  trimStartMs: number;
  trimEndMs: number;
  setTrimStartMs: (ms: number) => void;
  setTrimEndMs: (ms: number) => void;
}

export function useTrimSettings(lastSession: StopRecordingResponse | null): UseTrimSettingsResult {
  const [trimStartMs, setTrimStartMs] = useState(0);
  const [trimEndMs, setTrimEndMs] = useState(0);

  useEffect(() => {
    if (!lastSession) return;
    setTrimStartMs((prev) => Math.min(prev, lastSession.durationMs));
    setTrimEndMs((prev) => (prev <= 0 ? lastSession.durationMs : Math.min(prev, lastSession.durationMs)));
  }, [lastSession]);

  return { trimStartMs, trimEndMs, setTrimStartMs, setTrimEndMs };
}
