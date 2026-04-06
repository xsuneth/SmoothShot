import type { MouseEvent } from "react";

import type { CaptureRegion, LauncherMode } from "../types";
import DragHandle from "./Atoms/DragHandle";
import Separator from "./Atoms/Separator";
import ModeButton from "./BarComponents/ModeButton";
import StatusButton from "./BarComponents/StatusButton";

type LauncherBarProps = {
  isVisible: boolean;
  isRecording: boolean;
  isPaused: boolean;
  isShrinking: boolean;
  elapsedMs: number;
  launcherMode: LauncherMode | null;
  isDisplayPickerOpen: boolean;
  selectedDisplayLabel: string;
  region: CaptureRegion;
  cameraEnabled: boolean;
  micEnabled: boolean;
  appAudioEnabled: boolean;
  cameraLabel: string;
  micLabel: string;
  micInputLevel: number;
  onHide: () => void | Promise<void>;
  onDismissDisplayPopup: () => void | Promise<void>;
  onSelectMode: (mode: LauncherMode) => void;
  onOpenDisplayMenu: (anchorX: number, anchorY: number) => void;
  onOpenCameraMenu: (anchorX: number, anchorY: number) => void;
  onOpenMicMenu: (anchorX: number, anchorY: number) => void;
  onToggleAppAudio: () => void;
  onShowSourceInfo: () => void;
  onStopRecording: () => void | Promise<void>;
  onPauseRecording: () => void | Promise<void>;
  onResumeRecording: () => void | Promise<void>;
  onRestartRecording: () => void | Promise<void>;
  onDeleteRecording: () => void | Promise<void>;
};

function popupAnchor(event: MouseEvent<HTMLButtonElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.round(rect.left + rect.width / 2),
    y: Math.round(rect.top),
  };
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60).toString().padStart(2, "0");
  const s = (totalSec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export function LauncherBar({
  isVisible,
  isRecording,
  isPaused,
  isShrinking,
  elapsedMs,
  launcherMode,
  isDisplayPickerOpen,
  selectedDisplayLabel,
  region,
  cameraEnabled,
  micEnabled,
  appAudioEnabled,
  cameraLabel,
  micLabel,
  micInputLevel,
  onHide,
  onDismissDisplayPopup,
  onSelectMode,
  onOpenDisplayMenu,
  onOpenCameraMenu,
  onOpenMicMenu,
  onToggleAppAudio,
  onShowSourceInfo,
  onStopRecording,
  onPauseRecording,
  onResumeRecording,
  onRestartRecording,
  onDeleteRecording,
}: LauncherBarProps) {
  const recordingControlButtonClass = "no-drag flex h-10 w-10 items-center justify-center rounded-[5px] bg-white/[0.06] text-white transition hover:bg-white/[0.12]";

  const sourceTitle =
    launcherMode === "area"
      ? `Area ${region.width}x${region.height}`
      : selectedDisplayLabel;

  return (
    <main
      className={[
        "relative w-full origin-center bg-transparent transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
        isVisible ? "translate-y-0 scale-100 opacity-100" : "translate-y-3 scale-[0.985] opacity-0",
        isShrinking ? "scale-95 opacity-95" : "",
      ].join(" ")}
    >
      <section
        className={[
          "flex max-w-full items-center overflow-hidden rounded-[15px] border border-[rgba(108,108,108,0.95)] bg-[#312f2f] text-[#f3f3f3] shadow-[0_16px_36px_rgba(0,0,0,0.34)] backdrop-blur-xl transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
          isRecording ? "h-[52px] w-[231px] gap-[5px] border-[0.6px] pl-[5px] pr-[7px]" : "h-15 w-230 gap-1.5 px-1.5",
        ].join(" ")}
        data-tauri-drag-region
      >
        <div className="flex items-center pr-0.5">
          <DragHandle />
          {!isRecording && (
            <button
              type="button"
              className="no-drag flex h-10 w-10 items-center justify-center text-white transition hover:bg-white/6"
              onClick={() => { void onHide(); }}
              aria-label="Hide launcher"
            >
              <img src="/icons/launcher/close.svg" alt="" className="h-5 w-5" draggable={false} aria-hidden="true" />
            </button>
          )}
        </div>

        {isRecording ? (
          <div className="flex min-w-0 flex-1 items-center gap-0.5">
            {/* Stop — opens editor */}
            <button
              type="button"
              className="no-drag flex h-10 w-[72px] items-center rounded-[5px] bg-[rgba(255,55,55,0.29)] pr-3 text-[#fff5f5] transition hover:bg-[rgba(255,55,55,0.38)]"
              aria-label="Stop recording"
              onClick={() => { void onStopRecording(); }}
            >
              <span className="flex h-9 w-9 items-center justify-center">
                <img src="/icons/launcher/camera-off.svg" alt="" className="h-5 w-5" draggable={false} aria-hidden="true" />
              </span>
              <span className="text-[10.5px] font-semibold leading-none">
                {formatElapsed(elapsedMs)}
              </span>
            </button>

            {/* Pause / Resume */}
            <button
              type="button"
              className={recordingControlButtonClass}
              aria-label={isPaused ? "Resume recording" : "Pause recording"}
              onClick={() => { void (isPaused ? onResumeRecording() : onPauseRecording()); }}
            >
              {isPaused ? (
                // Play triangle
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-white" aria-hidden="true">
                  <polygon points="5,3 19,12 5,21" />
                </svg>
              ) : (
                // Pause bars
                <span className="flex h-5 w-5 items-center justify-center gap-[3px]">
                  <span className="h-3.5 w-[3px] rounded-[2px] bg-white" />
                  <span className="h-3.5 w-[3px] rounded-[2px] bg-white" />
                </span>
              )}
            </button>

            {/* Restart — discard + start fresh */}
            <button
              type="button"
              className={recordingControlButtonClass}
              aria-label="Restart recording"
              onClick={() => { void onRestartRecording(); }}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 11a8 8 0 1 0-2.4 5.7" />
                <path d="M20 4v7h-7" />
              </svg>
            </button>

            {/* Delete — discard without opening editor */}
            <button
              type="button"
              className={recordingControlButtonClass}
              aria-label="Delete recording"
              onClick={() => { void onDeleteRecording(); }}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-white" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 7h16" />
                <path d="M9 7V5h6v2" />
                <path d="M8 7l1 12h6l1-12" />
              </svg>
            </button>
          </div>
        ) : (
          <>

            <Separator />

            <div className="flex items-center py-1.25">
              <ModeButton
                active={isDisplayPickerOpen}
                activeIcon={<img src="/icons/launcher/display.svg" alt="" className="h-6 aspect-square" draggable={false} aria-hidden="true" />}
                label="Display"
                onClick={(event) => {
                  if (isDisplayPickerOpen) {
                    void onDismissDisplayPopup();
                    return;
                  }
                  const anchor = popupAnchor(event);
                  onOpenDisplayMenu(anchor.x, anchor.y);
                }}
              />
              <ModeButton
                active={launcherMode === "window"}
                activeIcon={<img src="/icons/launcher/window.svg" alt="" className="h-6 aspect-square" draggable={false} aria-hidden="true" />}
                label="Window"
                onClick={(event) => {
                  void onDismissDisplayPopup();
                  onSelectMode("window");
                  event.preventDefault();
                }}
              />
              <ModeButton
                active={launcherMode === "area"}
                activeIcon={<img src="/icons/launcher/area.svg" alt="" className="h-6 aspect-square" draggable={false} aria-hidden="true" />}
                label="Area"
                onClick={() => {
                  void onDismissDisplayPopup();
                  onSelectMode("area");
                }}
              />
            </div>

            <Separator />

            {/* Input Configuration */}
            <div className="grid min-w-0 flex-1 grid-cols-[114px_142px_148px] items-center gap-0.5">

          {/* Camera Status */}
          <StatusButton
            enabled={cameraEnabled}
            enabledIcon={<img src="/icons/launcher/camera-on.svg" alt="" className="h-6 aspect-square" draggable={false} aria-hidden="true" />}
            disabledIcon={<img src="/icons/launcher/camera-off.svg" alt="" className="h-6 aspect-square opacity-45" draggable={false} aria-hidden="true" />}
            enabledLabel={cameraLabel}
            disabledLabel="No camera"
            onClick={(event) => {
              void onDismissDisplayPopup();
              const anchor = popupAnchor(event);
              onOpenCameraMenu(anchor.x, anchor.y);
            }}
          />

          {/* Microphone Status */}
          <StatusButton
            enabled={micEnabled}
            enabledIcon={<img src="/icons/launcher/mic-on.svg" alt="" className="h-6 aspect-square" draggable={false} aria-hidden="true" />}
            disabledIcon={<img src="/icons/launcher/mic-off.svg" alt="" className="h-6 aspect-square opacity-45" draggable={false} aria-hidden="true" />}
            enabledLabel={micLabel}
            disabledLabel="No microphone"
            meterLevel={micInputLevel}
            onClick={(event) => {
              void onDismissDisplayPopup();
              const anchor = popupAnchor(event);
              onOpenMicMenu(anchor.x, anchor.y);
            }}
          />

          {/* System Audio Status */}
          <StatusButton
            enabled={appAudioEnabled}
            enabledIcon={<img src="/icons/launcher/system-on.svg" alt="" className="h-6 aspect-square" draggable={false} aria-hidden="true" />}
            disabledIcon={<img src="/icons/launcher/system-off.svg" alt="" className="h-6 aspect-square opacity-45" draggable={false} aria-hidden="true" />}
            enabledLabel="System audio"
            disabledLabel="No system sound"
            onClick={() => {
              void onDismissDisplayPopup();
              onToggleAppAudio();
            }}
          />
            </div>

            <Separator />

            {/* Settings Icon */}
            <div className="flex items-center gap-1 pl-0.5 pr-1">
              <button
                type="button"
                className="no-drag flex h-10 w-10 items-center justify-center rounded-[10px] text-white/76 transition hover:bg-white/6 hover:text-white"
                onClick={() => {
                  void onDismissDisplayPopup();
                  onShowSourceInfo();
                }}
                aria-label="Open settings"
                title={`Settings | ${sourceTitle}`}
              >
                <img src="/icons/launcher/settings.svg" alt="" className="h-4.5 w-4.5" draggable={false} aria-hidden="true" />
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
