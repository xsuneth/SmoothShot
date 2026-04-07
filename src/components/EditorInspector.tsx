import type { CameraCorner, PreviewToolPanel } from "../types";

import { AudioPanel } from "./InspectorPanels/AudioPanel";
import { BackgroundPanel } from "./InspectorPanels/BackgroundPanel";
import { CameraPanel } from "./InspectorPanels/CameraPanel";
import { CaptionPanel } from "./InspectorPanels/CaptionPanel";
import { CursorPanel } from "./InspectorPanels/CursorPanel";

type EditorInspectorProps = {
  activeToolPanel: PreviewToolPanel;
  audioGain: number;
  backgroundStyle: {
    tab: "wallpaper" | "gradient" | "color" | "image";
    value: string;
    blur: number;
  };
  backgroundImageFileName: string;
  cameraCorner: CameraCorner;
  cameraMirrored: boolean;
  cameraRoundness: number;
  cursorScale: number;
  padding: number;
  roundedCorners: number;
  inset: number;
  shadow: number;
  directionalShadow: boolean;
  shadowAngle: number;
  shadowBlur: number;
  showCursor: boolean;
  onSetPadding: (value: number) => void;
  onSetRoundedCorners: (value: number) => void;
  onSetInset: (value: number) => void;
  onSetShadow: (value: number) => void;
  onSetDirectionalShadow: (value: boolean) => void;
  onSetShadowAngle: (value: number) => void;
  onSetShadowBlur: (value: number) => void;
  onSetAudioGain: (value: number) => void;
  onSetCameraCorner: (corner: CameraCorner) => void;
  onSetCameraMirrored: (mirrored: boolean) => void;
  onSetCameraRoundness: (roundness: number) => void;
  onSetCursorScale: (value: number) => void;
  onSetShowCursor: (value: boolean) => void;
  onSetBackgroundTab: (tab: "wallpaper" | "gradient" | "color" | "image") => void;
  onSetBackgroundValue: (value: string) => void;
  onSetBackgroundBlur: (value: number) => void;
  onSetBackgroundImage: (file: File | null) => void;
};

// Single shared right-side inspector that swaps panel content by selected tool.
export function EditorInspector(props: EditorInspectorProps) {
  return (
    <aside className="flex h-full min-h-0 flex-col rounded-r-[18px] border-l border-white/6 bg-[#14151c] text-white min-[1120px]:min-w-[260px] min-[1120px]:max-w-[540px] min-[1120px]:resize-x min-[1120px]:overflow-auto max-[1120px]:w-full max-[1120px]:rounded-none max-[1120px]:border-l-0 max-[1120px]:border-t">
      {props.activeToolPanel === "Background" && (
        <BackgroundPanel
          backgroundStyle={props.backgroundStyle}
          backgroundImageFileName={props.backgroundImageFileName}
          padding={props.padding}
          roundedCorners={props.roundedCorners}
          inset={props.inset}
          shadow={props.shadow}
          directionalShadow={props.directionalShadow}
          shadowAngle={props.shadowAngle}
          shadowBlur={props.shadowBlur}
          onSetBackgroundTab={props.onSetBackgroundTab}
          onSetBackgroundValue={props.onSetBackgroundValue}
          onSetBackgroundBlur={props.onSetBackgroundBlur}
          onSetBackgroundImage={props.onSetBackgroundImage}
          onSetPadding={props.onSetPadding}
          onSetRoundedCorners={props.onSetRoundedCorners}
          onSetInset={props.onSetInset}
          onSetShadow={props.onSetShadow}
          onSetDirectionalShadow={props.onSetDirectionalShadow}
          onSetShadowAngle={props.onSetShadowAngle}
          onSetShadowBlur={props.onSetShadowBlur}
        />
      )}

      {props.activeToolPanel === "Cursor" && (
        <CursorPanel
          showCursor={props.showCursor}
          cursorScale={props.cursorScale}
          onSetShowCursor={props.onSetShowCursor}
          onSetCursorScale={props.onSetCursorScale}
        />
      )}

      {props.activeToolPanel === "Camera" && (
        <CameraPanel
          cameraCorner={props.cameraCorner}
          cameraRoundness={props.cameraRoundness}
          cameraMirrored={props.cameraMirrored}
          onSetCameraCorner={props.onSetCameraCorner}
          onSetCameraRoundness={props.onSetCameraRoundness}
          onSetCameraMirrored={props.onSetCameraMirrored}
        />
      )}

      {props.activeToolPanel === "Caption" && <CaptionPanel />}

      {props.activeToolPanel === "Audio" && (
        <AudioPanel audioGain={props.audioGain} onSetAudioGain={props.onSetAudioGain} />
      )}
    </aside>
  );
}
