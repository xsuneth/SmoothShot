import type { ReactNode } from "react";

import type { CaptureRegion, DisplayDescriptor, LauncherMode } from "../types";

type LauncherBarProps = {
  launcherMode: LauncherMode;
  displays: DisplayDescriptor[];
  displaySelection: string;
  selectedDisplayLabel: string;
  fps: number;
  region: CaptureRegion;
  cameraEnabled: boolean;
  micEnabled: boolean;
  appAudioEnabled: boolean;
  recording: boolean;
  canOpenEditor: boolean;
  onHide: () => void | Promise<void>;
  onSelectMode: (mode: LauncherMode) => void;
  onCycleDisplaySelection: () => void;
  onSetFps: (fps: number) => void;
  onToggleCamera: () => void;
  onToggleMic: () => void;
  onToggleAppAudio: () => void;
  onOpenEditor: () => void | Promise<void>;
  onStartRecording: () => void | Promise<void>;
  onStopRecording: () => void | Promise<void>;
  onShowSourceInfo: () => void;
};

const launcherModes: Array<{
  id: LauncherMode;
  label: string;
  available: boolean;
}> = [
  { id: "display", label: "Display", available: true },
  { id: "window", label: "Window", available: false },
  { id: "area", label: "Area", available: true },
  { id: "device", label: "Device", available: false },
];

function IconWrap({ children }: { children: ReactNode }) {
  return <span className="inline-flex h-6 w-6 items-center justify-center">{children}</span>;
}

function Separator() {
  return <div className="h-9 w-px bg-[rgba(255,255,255,0.1)]" aria-hidden="true" />;
}

function ModeIcon({ mode }: { mode: LauncherMode }) {
  if (mode === "display") {
    return (
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="6" width="16" height="10" rx="1.8" />
        <path d="M9 19h6" />
      </svg>
    );
  }

  if (mode === "window") {
    return (
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="5" width="16" height="14" rx="2" />
        <path d="M4 9h16" />
      </svg>
    );
  }

  if (mode === "area") {
    return (
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 4H6a2 2 0 0 0-2 2v2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
        <path d="M4 10V8M20 10V8M4 16v-2M20 16v-2M10 4H8M16 4h-2M10 20H8M16 20h-2" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="8" y="3.5" width="8" height="17" rx="1.8" />
      <path d="M10.5 7h3M12 17.2h.01" />
    </svg>
  );
}

export function LauncherBar({
  launcherMode,
  displays,
  displaySelection,
  selectedDisplayLabel,
  fps,
  region,
  cameraEnabled,
  micEnabled,
  appAudioEnabled,
  recording,
  canOpenEditor,
  onHide,
  onSelectMode,
  onCycleDisplaySelection,
  onSetFps,
  onToggleCamera,
  onToggleMic,
  onToggleAppAudio,
  onOpenEditor,
  onStartRecording,
  onStopRecording,
  onShowSourceInfo,
}: LauncherBarProps) {
  const sourceTitle =
    launcherMode === "area"
      ? `Area ${region.width}x${region.height}`
      : displaySelection === "auto" || displays.length > 0
        ? selectedDisplayLabel
        : "No displays found";
  const cameraLabel = cameraEnabled ? "USB3.0 Camera" : "No camera";
  const micLabel = micEnabled ? "Microphone" : "No microphone";
  const audioLabel = appAudioEnabled ? "System audio" : "No system audio";

  return (
    <main className="w-full bg-transparent">
      <section
        className="flex h-[54px] w-full items-center gap-2 overflow-hidden rounded-[12px] border border-[rgba(255,255,255,0.14)] bg-[linear-gradient(180deg,rgba(63,57,62,0.95),rgba(55,49,54,0.98))] px-3 py-1.5 text-[#f3f3f3] shadow-[0_14px_30px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl"
        data-tauri-drag-region
      >
        <div className="no-drag flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          <button
            type="button"
            className="flex h-6.5 w-6.5 items-center justify-center rounded-full bg-[#f1f1f1] text-[#343434] transition hover:scale-[1.03]"
            onClick={onHide}
            aria-label="Hide launcher"
          >
            <IconWrap>
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </IconWrap>
          </button>
          <Separator />
          <div className="flex min-w-0 items-center gap-0.5">
            {launcherModes.map((mode) => (
              <button
                key={mode.id}
                type="button"
                className={[
                  "no-drag flex w-[54px] flex-none flex-col items-center gap-0.5 rounded-lg px-1 py-1 text-center transition duration-150 ease-out",
                  launcherMode === mode.id && mode.available
                    ? "bg-[linear-gradient(180deg,rgba(106,130,255,0.18),rgba(255,255,255,0.04))] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]"
                    : !mode.available
                      ? "text-[rgba(255,255,255,0.34)]"
                      : "text-[rgba(255,255,255,0.82)] hover:bg-[rgba(255,255,255,0.04)]",
                ].join(" ")}
                onClick={() => {
                  if (mode.id === "display" && launcherMode === "display") {
                    onCycleDisplaySelection();
                    return;
                  }

                  onSelectMode(mode.id);
                }}
                aria-pressed={launcherMode === mode.id}
                title={mode.id === "display" ? selectedDisplayLabel : mode.label}
              >
                <IconWrap>
                  <ModeIcon mode={mode.id} />
                </IconWrap>
                <span className="text-[0.62rem] leading-none">{mode.label}</span>
              </button>
            ))}
          </div>
          <Separator />
          <button
            type="button"
            className="no-drag flex min-w-0 max-w-[116px] flex-none items-center gap-1.5 rounded-lg px-2 py-1.5 text-[0.7rem] text-[rgba(255,255,255,0.8)] transition hover:bg-[rgba(255,255,255,0.04)] hover:text-white"
            onClick={onToggleCamera}
            title={cameraLabel}
          >
            <IconWrap>
              <svg viewBox="0 0 24 24" className="h-5.5 w-5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 7h9a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4z" />
                <path d="M15 10l5-3v10l-5-3" />
                <path d="M3 4l18 16" />
              </svg>
            </IconWrap>
            <span className="truncate">{cameraLabel}</span>
          </button>
          <Separator />
          <button
            type="button"
            className="no-drag flex min-w-0 max-w-[128px] flex-none items-center gap-1.5 rounded-lg px-2 py-1.5 text-[0.7rem] text-[rgba(255,255,255,0.8)] transition hover:bg-[rgba(255,255,255,0.04)] hover:text-white"
            onClick={onToggleMic}
            title={micEnabled ? micLabel : "No microphone"}
          >
            <IconWrap>
              <svg viewBox="0 0 24 24" className="h-5.5 w-5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 4a2.5 2.5 0 0 1 2.5 2.5V12A2.5 2.5 0 0 1 12 14.5 2.5 2.5 0 0 1 9.5 12V6.5A2.5 2.5 0 0 1 12 4z" />
                <path d="M7 11.5a5 5 0 0 0 10 0M12 16.5V20M9 20h6" />
                <path d="M4 4l16 16" />
              </svg>
            </IconWrap>
            <span className="truncate">{micEnabled ? micLabel : "No microphone"}</span>
          </button>
          <Separator />
          <button
            type="button"
            className="no-drag flex min-w-0 max-w-[138px] flex-none items-center gap-1.5 rounded-lg px-2 py-1.5 text-[0.7rem] text-[rgba(255,255,255,0.8)] transition hover:bg-[rgba(255,255,255,0.04)] hover:text-white"
            onClick={onToggleAppAudio}
            title={audioLabel}
          >
            <IconWrap>
              <svg viewBox="0 0 24 24" className="h-5.5 w-5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="6.5" width="18" height="11" rx="1.8" />
                <path d="M8 14.5h4M14 9.5h3M16.5 12v.01" />
              </svg>
            </IconWrap>
            <span className="truncate">{audioLabel}</span>
          </button>
        </div>

        <div className="no-drag ml-auto flex flex-none items-center gap-1.5">
          <Separator />
          <button
            type="button"
            className="flex h-7.5 w-7.5 items-center justify-center rounded-full text-[rgba(255,255,255,0.62)] transition hover:bg-[rgba(255,255,255,0.06)] hover:text-white disabled:opacity-45"
            onClick={onOpenEditor}
            disabled={recording || !canOpenEditor}
            aria-label="Open editor"
          >
            <IconWrap>
              <svg viewBox="0 0 24 24" className="h-5.5 w-5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="7.5" />
                <path d="M12 8.5v7M8.5 12h7" />
              </svg>
            </IconWrap>
          </button>
          <button
            type="button"
            className={[
              "flex h-7.5 w-7.5 items-center justify-center rounded-full transition hover:bg-[rgba(255,255,255,0.06)]",
              recording ? "bg-[#d74b43] text-white" : "text-[rgba(255,255,255,0.7)]",
            ].join(" ")}
            onClick={recording ? onStopRecording : onStartRecording}
            aria-label={recording ? "Stop recording" : "Start recording"}
          >
            {recording ? (
              <span className="h-3 w-3 rounded-[2px] bg-white" />
            ) : (
              <span className="h-3 w-3 rounded-full border-2 border-current" />
            )}
          </button>
          <button
            type="button"
            className="flex h-7.5 w-7.5 items-center justify-center rounded-full text-[rgba(255,255,255,0.62)] transition hover:bg-[rgba(255,255,255,0.06)] hover:text-white"
            onClick={onShowSourceInfo}
            aria-label={`Source info: ${sourceTitle}`}
          >
            <IconWrap>
              <svg viewBox="0 0 24 24" className="h-5.5 w-5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="7.5" />
                <path d="M12 8.5v.01M12 12v.01M12 15.5v.01" />
              </svg>
            </IconWrap>
          </button>
          <button
            type="button"
            className="flex h-7.5 w-7.5 items-center justify-center rounded-full text-[rgba(255,255,255,0.62)] transition hover:bg-[rgba(255,255,255,0.06)] hover:text-white"
            onClick={() => onSetFps(fps)}
            aria-label="More options"
          >
            <IconWrap>
              <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="m8 10 4 4 4-4" />
              </svg>
            </IconWrap>
          </button>
        </div>
      </section>
    </main>
  );
}
