import type { MouseEvent, ReactNode } from "react";

import type { CaptureRegion, LauncherMode } from "../types";
import DragHandle from "./Atoms/DragHandle";
import Separator from "./Atoms/Separator";
import StatusButton from "./BarComponents/StatusButton";

type LauncherBarProps = {
  isVisible: boolean;
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
};

function ModeButton({
  active,
  activeIcon,
  inactiveIcon,
  label,
  onClick,
}: {
  active: boolean;
  activeIcon: ReactNode;
  inactiveIcon?: ReactNode;
  label: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      className={[
        "no-drag flex h-[50px] w-[60px] flex-col items-center justify-center gap-[5px] rounded-[9px] px-1 transition",
        active
          ? "bg-white/[0.08] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
          : "text-[#999] hover:bg-white/[0.04] hover:text-white",
      ].join(" ")}
      onClick={onClick}
      aria-pressed={active}
    >
      <span className="flex h-[20px] items-center justify-center">{active ? activeIcon : inactiveIcon ?? activeIcon}</span>
      <span className="text-[8.5px] font-semibold leading-none">{label}</span>
    </button>
  );
}



function popupAnchor(event: MouseEvent<HTMLButtonElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.round(rect.left + rect.width / 2),
    y: Math.round(rect.top),
  };
}

export function LauncherBar({
  isVisible,
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
}: LauncherBarProps) {
  const sourceTitle =
    launcherMode === "area"
      ? `Area ${region.width}x${region.height}`
      : selectedDisplayLabel;

  return (
    <main
      className={[
        "relative w-full bg-transparent transition-all duration-200 ease-out",
        isVisible ? "translate-y-0 scale-100 opacity-100" : "translate-y-3 scale-[0.985] opacity-0",
      ].join(" ")}
    >
      <section
        className="flex h-[60px] w-[920px] max-w-full items-center gap-[6px] overflow-hidden rounded-[15px] border border-[rgba(108,108,108,0.95)] bg-[#312f2f] px-[6px] text-[#f3f3f3] shadow-[0_16px_36px_rgba(0,0,0,0.34)] backdrop-blur-xl"
        data-tauri-drag-region
      >
        <div className="flex items-center pr-[2px]">
          <DragHandle />
          <button
            type="button"
            className="no-drag flex h-[40px] w-[40px] items-center justify-center rounded-full text-white transition hover:bg-white/[0.06]"
            onClick={() => {
              void onHide();
            }}
            aria-label="Hide launcher"
          >
            <img src="/icons/launcher/close.svg" alt="" className="h-[20px] w-[20px]" draggable={false} aria-hidden="true" />
          </button>
        </div>

        <Separator />

        <div className="flex items-center py-[5px]">
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

        <div className="grid min-w-0 flex-1 grid-cols-3 items-center gap-[2px] grid-cols-[114px_142px_148px]">

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

        {/* Setting Icon */}

        <div className="flex items-center gap-[4px] pl-[2px] pr-[4px]">
          <button
            type="button"
            className="no-drag flex h-[40px] w-[40px] items-center justify-center rounded-[10px] text-white/76 transition hover:bg-white/[0.06] hover:text-white"
            onClick={() => {
              void onDismissDisplayPopup();
              onShowSourceInfo();
            }}
            aria-label="Open settings"
            title={`Settings | ${sourceTitle}`}
          >
            <img src="/icons/launcher/settings.svg" alt="" className="h-[18px] w-[18px]" draggable={false} aria-hidden="true" />
          </button>
        </div>
      </section>
    </main>
  );
}
