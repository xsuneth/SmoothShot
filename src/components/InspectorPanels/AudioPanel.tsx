import { SliderRow } from "./SliderRow";

// Audio controls panel.
export function AudioPanel({
  audioGain,
  onSetAudioGain,
}: {
  audioGain: number;
  onSetAudioGain: (value: number) => void;
}) {
  return (
    <>
      <div className="shrink-0 border-b border-white/6 px-4 py-3">
        <p className="text-[0.72rem] font-semibold uppercase tracking-widest text-white/30">Audio</p>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <section className="border-t border-white/6 pt-4">
          <SliderRow
            label="Audio gain"
            min={0}
            max={150}
            value={audioGain}
            onChange={onSetAudioGain}
            unit="%"
            onReset={() => onSetAudioGain(100)}
          />
        </section>
      </div>
    </>
  );
}
