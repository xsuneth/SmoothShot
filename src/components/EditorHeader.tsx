type EditorHeaderProps = {
  isExporting: boolean;
  recording: boolean;
  sessionFolder: string | null;
  onCloseWindow: () => void | Promise<void>;
  onMinimizeWindow: () => void | Promise<void>;
  onStartNewRecordingFlow: () => void | Promise<void>;
  onInitializeGpuRenderer: () => void | Promise<void>;
  onGenerateZoomPreview: () => void | Promise<void>;
  onExportRecording: () => void | Promise<void>;
};

export function EditorHeader({
  isExporting,
  recording,
  sessionFolder,
  onCloseWindow,
  onMinimizeWindow,
  onStartNewRecordingFlow,
  onInitializeGpuRenderer,
  onGenerateZoomPreview,
  onExportRecording,
}: EditorHeaderProps) {
  // Derive a human-readable session label from the folder path if available.
  const sessionLabel = sessionFolder
    ? sessionFolder.split(/[\\/]/).pop() ?? "SmoothShot"
    : null;
  return (
    <header className="flex h-14 items-center justify-between border-b border-white/8 px-4 text-white" data-tauri-drag-region>
      <div className="flex items-center gap-4">
        <div className="no-drag flex items-center gap-2">
          <button type="button" className="h-3 w-3 rounded-full bg-[#ff5f57] transition hover:brightness-110" onClick={onCloseWindow} aria-label="Close editor" />
          <button type="button" className="h-3 w-3 rounded-full bg-[#febc2e] transition hover:brightness-110" onClick={onMinimizeWindow} aria-label="Minimize editor" />
          <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        </div>
        <div className="no-drag hidden items-center gap-2 text-white/70 min-[880px]:flex">
          <button type="button" className="rounded-md p-2 transition hover:bg-white/6" onClick={onStartNewRecordingFlow}>
            <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4 7.5h16v11H4z" />
              <path d="M8 7.5V5h8v2.5" />
            </svg>
          </button>
          <button type="button" className="rounded-md p-2 transition hover:bg-white/6">
            <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M6 7h12M9 7V5h6v2M8 7l1 12h6l1-12" />
            </svg>
          </button>
        </div>
      </div>

      <div className="min-w-0 flex-1 px-6 text-center">
        <p className="truncate text-sm font-medium text-white/90">
          {sessionLabel ?? "No session"} <span className="text-white/35">smoothshot</span>
        </p>
      </div>

      <div className="no-drag flex items-center gap-2">
        <button type="button" className="hidden rounded-lg px-3 py-2 text-sm text-white/70 transition hover:bg-white/6 hover:text-white min-[920px]:inline-flex">
          Presets
        </button>
        <button type="button" className="hidden rounded-lg p-2 text-white/70 transition hover:bg-white/6 hover:text-white min-[920px]:inline-flex" onClick={onInitializeGpuRenderer}>
          <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M12 5c4.5 0 8 3.5 9 7-1 3.5-4.5 7-9 7s-8-3.5-9-7c1-3.5 4.5-7 9-7Z" />
            <circle cx="12" cy="12" r="2.5" />
          </svg>
        </button>
        <button type="button" className="hidden rounded-lg p-2 text-white/70 transition hover:bg-white/6 hover:text-white min-[920px]:inline-flex" onClick={onGenerateZoomPreview}>
          <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
          </svg>
        </button>
        <button
          type="button"
          className="rounded-xl bg-[#6a4cff] px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(106,76,255,0.35)] transition hover:bg-[#7a60ff] disabled:cursor-not-allowed disabled:opacity-45"
          onClick={onExportRecording}
          disabled={recording || isExporting}
        >
          {isExporting ? "Exporting..." : "Export"}
        </button>
      </div>
    </header>
  );
}
