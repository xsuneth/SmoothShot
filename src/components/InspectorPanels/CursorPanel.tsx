import { SliderRow } from "./SliderRow";

// Cursor controls panel.
export function CursorPanel({
  showCursor,
  cursorScale,
  onSetShowCursor,
  onSetCursorScale,
}: {
  showCursor: boolean;
  cursorScale: number;
  onSetShowCursor: (value: boolean) => void;
  onSetCursorScale: (value: number) => void;
}) {
  return (
    <>
      <div className="shrink-0 border-b border-white/6 px-4 py-3">
        <p className="text-[0.72rem] font-semibold uppercase tracking-widest text-white/30">Cursor</p>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <section className="space-y-3 border-t border-white/6 pt-4">
          <label className="flex items-center justify-between rounded-lg border border-white/10 bg-white/4 px-2.5 py-2 text-[0.76rem]">
            <span className="text-white/72">Show cursor</span>
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-[#9b88ff]"
              checked={showCursor}
              onChange={(e) => onSetShowCursor(e.currentTarget.checked)}
            />
          </label>
          <SliderRow label="Cursor size" min={70} max={180} value={cursorScale} onChange={onSetCursorScale} unit="%" />
        </section>
      </div>
    </>
  );
}
