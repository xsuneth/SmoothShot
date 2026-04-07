type CameraPreviewWindowProps = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  error: string | null;
  hasCamera: boolean;
  isStreaming: boolean;
};

export function CameraPreviewWindow({
  videoRef,
  error,
  hasCamera,
  isStreaming,
}: CameraPreviewWindowProps) {
  return (
    <main
      className="h-screen w-screen overflow-hidden rounded-[20px] border border-white/18 bg-transparent text-white shadow-[0_28px_72px_rgba(0,0,0,0.60),0_0_0_1px_rgba(255,255,255,0.04)]"
      data-tauri-drag-region
    >
      <div className="relative h-full w-full overflow-hidden rounded-[20px] bg-[#0c0d12]">
        {!hasCamera ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-white/40">
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M15 10l4.553-2.277A1 1 0 0121 8.649v6.702a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
            </svg>
            <span className="text-[11px] font-medium tracking-wide">No camera</span>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="h-full w-full object-cover"
              style={{ display: isStreaming ? "block" : "none" }}
            />
            {!isStreaming && !error && (
              <div className="flex h-full w-full items-center justify-center text-[11px] text-white/45">
                Initializing...
              </div>
            )}
          </>
        )}

        {/* subtle vignette overlay */}
        <div className="pointer-events-none absolute inset-0 rounded-[20px] shadow-[inset_0_0_32px_rgba(0,0,0,0.25)]" />

        {/* top drag-handle hint */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-black/20 to-transparent" />
      </div>

      {error && (
        <p className="border-t border-white/10 bg-[#1e0f18] px-3 py-1.5 text-[10px] leading-snug text-[#ffb3c2]">
          {error}
        </p>
      )}
    </main>
  );
}
