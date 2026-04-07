import type { CameraCorner } from "../../types";

import { SliderRow } from "./SliderRow";

// Camera controls panel for PiP placement and style.
export function CameraPanel({
  cameraCorner,
  cameraRoundness,
  cameraMirrored,
  onSetCameraCorner,
  onSetCameraRoundness,
  onSetCameraMirrored,
}: {
  cameraCorner: CameraCorner;
  cameraRoundness: number;
  cameraMirrored: boolean;
  onSetCameraCorner: (corner: CameraCorner) => void;
  onSetCameraRoundness: (roundness: number) => void;
  onSetCameraMirrored: (mirrored: boolean) => void;
}) {
  return (
    <>
      <div className="shrink-0 border-b border-white/6 px-4 py-3">
        <p className="text-[0.72rem] font-semibold uppercase tracking-widest text-white/30">Camera</p>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <section className="space-y-3 border-t border-white/6 pt-4">
          <label className="block">
            <span className="mb-1 block text-[0.74rem] text-white/68">Corner</span>
            <select
              className="w-full rounded-lg border border-white/10 bg-white/6 px-2 py-1.5 text-[0.76rem] outline-none focus-visible:ring-2 focus-visible:ring-[#8d7cff]"
              value={cameraCorner}
              onChange={(e) => onSetCameraCorner(e.currentTarget.value as CameraCorner)}
            >
              <option value="top-left">Top left</option>
              <option value="top-right">Top right</option>
              <option value="bottom-left">Bottom left</option>
              <option value="bottom-right">Bottom right</option>
            </select>
          </label>

          <SliderRow
            label="Roundness"
            min={0}
            max={40}
            value={cameraRoundness}
            onChange={onSetCameraRoundness}
            unit="px"
          />

          <label className="flex items-center justify-between rounded-lg border border-white/10 bg-white/4 px-2.5 py-2 text-[0.76rem]">
            <span className="text-white/72">Mirror</span>
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-[#9b88ff]"
              checked={cameraMirrored}
              onChange={(e) => onSetCameraMirrored(e.currentTarget.checked)}
            />
          </label>
        </section>
      </div>
    </>
  );
}
