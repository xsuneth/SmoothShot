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
  const sessionLabel = sessionFolder
    ? sessionFolder.split(/[\\/]/).pop() ?? "SmoothShot"
    : null;

  return (
    <header
      className="flex h-14 items-center justify-between border-b border-white/6 px-4 text-white"
      data-tauri-drag-region
    >
      {/* Left: traffic lights + undo/redo + actions */}
      <div className="flex items-center gap-3">
        <div className="no-drag flex items-center gap-2">
          <button
            type="button"
            className="group h-3 w-3 rounded-full bg-[#ff5f57] transition hover:brightness-110"
            onClick={onCloseWindow}
            aria-label="Close editor"
          />
          <button
            type="button"
            className="group h-3 w-3 rounded-full bg-[#febc2e] transition hover:brightness-110"
            onClick={onMinimizeWindow}
            aria-label="Minimize editor"
          />
          <span className="h-3 w-3 rounded-full bg-[#28c840]" aria-hidden="true" />
        </div>

        <div className="h-4 w-px bg-white/10" />

        {/* Undo / Redo */}
        <div className="no-drag flex items-center">
          <button
            type="button"
            className="rounded-md p-1.5 text-white/50 transition hover:bg-white/6 hover:text-white/85 disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="Undo (⌘Z)"
            title="Undo"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 14 4 9l5-5" />
              <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
            </svg>
          </button>
          <button
            type="button"
            className="rounded-md p-1.5 text-white/50 transition hover:bg-white/6 hover:text-white/85 disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="Redo (⌘⇧Z)"
            title="Redo"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 14l5-5-5-5" />
              <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
            </svg>
          </button>
        </div>

        <div className="no-drag hidden items-center gap-1 min-[880px]:flex">
          <button
            type="button"
            className="rounded-md p-1.5 text-white/50 transition hover:bg-white/6 hover:text-white/85"
            onClick={onStartNewRecordingFlow}
            title="New recording"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4 7.5h16v11H4z" />
              <path d="M8 7.5V5h8v2.5" />
            </svg>
          </button>
          <button
            type="button"
            className="rounded-md p-1.5 text-white/50 transition hover:bg-white/6 hover:text-white/85"
            title="Trash recording"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M6 7h12M9 7V5h6v2M8 7l1 12h6l1-12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Center: session label */}
      <div className="min-w-0 flex-1 px-6 text-center">
        <p className="truncate text-sm font-medium text-white/80">
          {sessionLabel ?? "No session"}{" "}
          <span className="text-[0.72rem] text-white/30">smoothshot</span>
        </p>
      </div>

      {/* Right: Presets, GPU, Zoom, Export */}
      <div className="no-drag flex items-center gap-2">
        <button
          type="button"
          className="hidden rounded-lg px-3 py-1.5 text-sm text-white/60 transition hover:bg-white/6 hover:text-white/90 min-[920px]:inline-flex"
        >
          Presets
        </button>

        <button
          type="button"
          className="hidden rounded-lg p-2 text-white/50 transition hover:bg-white/6 hover:text-white/85 min-[920px]:inline-flex"
          onClick={onInitializeGpuRenderer}
          title="Initialize GPU renderer"
        >
          <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M12 5c4.5 0 8 3.5 9 7-1 3.5-4.5 7-9 7s-8-3.5-9-7c1-3.5 4.5-7 9-7Z" />
            <circle cx="12" cy="12" r="2.5" />
          </svg>
        </button>

        <button
          type="button"
          className="hidden rounded-lg p-2 text-white/50 transition hover:bg-white/6 hover:text-white/85 min-[920px]:inline-flex"
          onClick={onGenerateZoomPreview}
          title="Generate zoom preview"
        >
          <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
          </svg>
        </button>

        <button
          type="button"
          className="rounded-xl bg-[#6a4cff] px-4 py-2 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(106,76,255,0.30)] transition hover:bg-[#7a60ff] active:bg-[#5a3cef] disabled:cursor-not-allowed disabled:opacity-40"
          onClick={onExportRecording}
          disabled={recording || isExporting}
        >
          {isExporting ? (
            <span className="flex items-center gap-2">
              <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
              Exporting…
            </span>
          ) : (
            "Export"
          )}
        </button>
      </div>
    </header>
  );
}
