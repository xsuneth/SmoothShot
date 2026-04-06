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
      className="h-screen w-screen overflow-hidden rounded-xl border border-white/20 bg-transparent text-white shadow-[0_18px_48px_rgba(0,0,0,0.45)]"
      data-tauri-drag-region
    >
      <div className="relative aspect-square w-full bg-black/60">
        {!hasCamera ? (
          <div className="flex h-full w-full items-center justify-center text-xs text-white/65">
            No camera selected
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
              <div className="flex h-full w-full items-center justify-center text-xs text-white/65">
                Loading camera...
              </div>
            )}
          </>
        )}
      </div>
      {error && (
        <p className="border-t border-white/10 bg-[#220f16] px-2 py-1 text-[10px] leading-snug text-[#ffb3c2]">
          {error}
        </p>
      )}
    </main>
  );
}
