import type { ReactEventHandler, RefObject, ReactNode, SyntheticEvent } from "react";
import { AbsoluteFill } from "remotion";
import type { CameraCorner } from "../types";

type RemotionPreviewCompositionProps = {
  stageBackground: string;
  backgroundBlur: number;
  translateX: number;
  translateY: number;
  zoom: number;
  previewUrl: string | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  hasPreviewFrame: boolean;
  isLoadingFrame: boolean;
  isMuted: boolean;
  contentPaddingPx: number;
  onLoadedMetadata: (e: SyntheticEvent<HTMLVideoElement, Event>) => void;
  onPlaying: () => void;
  onStalled: (e: SyntheticEvent<HTMLVideoElement, Event>) => void;
  onError: ReactEventHandler<HTMLVideoElement>;
  cursorOverlay: ReactNode;
  cameraUrl?: string | null;
  cameraCorner: CameraCorner;
  cameraInsetPx: number;
  cameraWidthPx: number;
  cameraRoundness: number;
  cameraMirrored: boolean;
};

export function RemotionPreviewComposition({
  stageBackground,
  backgroundBlur,
  translateX,
  translateY,
  zoom,
  previewUrl,
  videoRef,
  canvasRef,
  hasPreviewFrame,
  isLoadingFrame,
  isMuted,
  contentPaddingPx,
  onLoadedMetadata,
  onPlaying,
  onStalled,
  onError,
  cursorOverlay,
  cameraUrl,
  cameraCorner,
  cameraInsetPx,
  cameraWidthPx,
  cameraRoundness,
  cameraMirrored,
}: RemotionPreviewCompositionProps) {
  const cameraCornerStyle =
    cameraCorner === "top-left"
      ? { top: cameraInsetPx, left: cameraInsetPx }
      : cameraCorner === "top-right"
        ? { top: cameraInsetPx, right: cameraInsetPx }
        : cameraCorner === "bottom-left"
          ? { bottom: cameraInsetPx, left: cameraInsetPx }
          : { bottom: cameraInsetPx, right: cameraInsetPx };

  return (
    <AbsoluteFill style={{ background: stageBackground }}>
      <div
        className="absolute inset-0 scale-110"
        style={{ background: stageBackground, filter: `blur(${backgroundBlur}px)` }}
      />

      <div className="absolute" style={{ inset: `${contentPaddingPx}px` }}>
        <div
          className="absolute inset-0 origin-center transition-transform duration-75 ease-linear"
          style={{ transform: `translate(${translateX}%, ${translateY}%) scale(${zoom})` }}
        >
          {previewUrl ? (
            <video
              ref={videoRef}
              className="h-full w-full object-contain"
              src={previewUrl}
              playsInline
              preload="auto"
              muted={isMuted}
              onLoadedMetadata={onLoadedMetadata}
              onPlaying={onPlaying}
              onStalled={onStalled}
              onError={onError}
            />
          ) : hasPreviewFrame ? (
            <canvas ref={canvasRef} className="h-full w-full object-contain" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_top,#36285a_0%,#241b3f_44%,#191726_100%)]">
              <div className="max-w-140 text-center text-white">
                <p className="mb-3 text-xs uppercase tracking-[0.35em] text-white/45">SmoothShot Preview</p>
                <h2 className="mb-3 text-4xl font-medium tracking-[-0.03em]">
                  {isLoadingFrame ? "Loading captured frame" : "Direct frame preview"}
                </h2>
                <p className="mx-auto max-w-115 text-sm leading-6 text-white/62">
                  The editor is showing captured frames directly, with cursor and zoom layered on top.
                </p>
              </div>
            </div>
          )}

          {cursorOverlay}
        </div>
      </div>

      {cameraUrl && (
        <div className="pointer-events-none absolute z-30" style={cameraCornerStyle}>
          <div
            className="overflow-hidden shadow-[0_6px_24px_rgba(0,0,0,0.7)] ring-1 ring-white/25"
            style={{
              width: `${cameraWidthPx}px`,
              aspectRatio: "15 / 14",
              borderRadius: `${cameraRoundness}px`,
            }}
          >
            <video
              className="h-full w-full object-cover"
              style={{
                transform: cameraMirrored ? "scaleX(-1)" : "none",
              }}
              src={cameraUrl}
              playsInline
              preload="auto"
              muted
            />
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
}
