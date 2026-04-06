import { useEffect, useRef, useState } from "react";
import type { DisplayDescriptor } from "../types";
import { convertFileSrc } from "@tauri-apps/api/core";

type DisplayPickerWindowProps = {
  displays: DisplayDescriptor[];
  displaySelection: string;
  previewsLoading: boolean;
  onSelect: (selection: string) => void;
  onRecord?: (selection: string) => void;
};

function DisplayCard({
  display,
  selected,
  previewsLoading,
  onSelect,
  onRecord,
}: {
  display: DisplayDescriptor;
  selected: boolean;
  previewsLoading: boolean;
  onSelect: () => void;
  onRecord?: () => void;
}) {
  const previewUrl = display.previewPath
    ? `${convertFileSrc(display.previewPath)}?t=${Date.now()}`
    : null;
  const title =
    display.name.trim().length > 0
      ? display.name
      : `Desktop ${String(display.index + 1).padStart(2, "0")}`;
  const resolution = `${display.width}×${display.height}`;
  const hz = `${Math.round(display.frequency)} Hz`;

  return (
    <div
      className={[
        "flex h-[100px] w-[248px] items-center gap-[10px] rounded-[9px] px-[8px] py-[8px] transition-colors",
        selected ? "bg-white/[0.07]" : "bg-transparent hover:bg-white/[0.03]",
      ].join(" ")}
    >
      {/* Preview thumbnail — click to select */}
      <button
        type="button"
        className="shrink-0 focus:outline-none"
        onClick={onSelect}
        aria-label={`Select ${title}`}
      >
        <div className="h-[76px] w-[116px] overflow-hidden rounded-lg border-[0.6px] border-zinc-500 bg-[#1e1e1e]">
          {previewUrl ? (
            <img
              src={previewUrl}
              alt={title}
              className="h-full w-full object-cover"
              draggable={false}
            />
          ) : previewsLoading ? (
            <div className="h-full w-full animate-pulse bg-white/[0.06]" />
          ) : (
            <div className="h-full w-full bg-[linear-gradient(140deg,#6d83d2,#3e316b)]" />
          )}
        </div>
      </button>

      {/* Info + actions */}
      <div className="min-w-0 flex-1 flex flex-col gap-[6px]">
        <div className="flex flex-col gap-[2px]">
          <p className="truncate text-[11.5px] font-semibold leading-tight text-[#ebebeb]">
            {title}
          </p>
          <p className="truncate text-[10px] font-medium leading-tight text-[#8e8e8e]">
            {resolution}
          </p>
          <p className="truncate text-[10px] font-medium leading-tight text-[#8e8e8e]">
            {hz}
            {display.isPrimary && (
              <span className="ml-1.5 rounded-sm bg-white/10 px-1 py-px text-[8.5px] font-semibold uppercase tracking-wide text-white/50">
                Primary
              </span>
            )}
          </p>
        </div>

        <button
          type="button"
          className="flex items-center justify-center gap-1.5 rounded-md bg-[#CA5757]/42 px-2 py-[4px] text-[10.5px] font-semibold text-white transition-colors hover:bg-[#CA5757]/70"
          onClick={onRecord ?? onSelect}
        >
          <img
            src="/icons/launcher/record.svg"
            alt=""
            className="h-3.5 aspect-square"
            draggable={false}
            aria-hidden="true"
          />
          Record
        </button>
      </div>
    </div>
  );
}

export function DisplayPickerWindow({
  displays,
  displaySelection,
  previewsLoading,
  onSelect,
  onRecord,
}: DisplayPickerWindowProps) {
  const hasDisplays = displays.length > 0;
  const prevHasDisplays = useRef(hasDisplays);
  const [scaleClass, setScaleClass] = useState("scale-100");

  useEffect(() => {
    if (!prevHasDisplays.current && hasDisplays) {
      // Trigger pop-in animation when transitioning from loading → loaded.
      setScaleClass("scale-95 opacity-0");
      const raf = requestAnimationFrame(() => {
        setScaleClass("scale-100 opacity-100");
      });
      return () => cancelAnimationFrame(raf);
    }
    prevHasDisplays.current = hasDisplays;
  }, [hasDisplays]);

  return (
    <main className="flex h-full w-full items-center justify-center overflow-hidden bg-transparent">
      <section
        className={[
          "rounded-xl border-[0.6px] border-[#6c6c6c] bg-[#312f2f]",
          "transition-[transform,opacity] duration-200 ease-out",
          scaleClass,
        ].join(" ")}
      >
        {!hasDisplays ? (
          // Only show a full loading screen on very first open (no cached data yet).
          <div className="flex h-[100px] w-[248px] items-center justify-center rounded-[8px] text-[12px] font-medium text-white/80">
            Loading displays…
          </div>
        ) : (
          <div className="flex flex-row">
            {displays.map((display) => (
              <DisplayCard
                key={display.id}
                display={display}
                selected={displaySelection === String(display.index)}
                previewsLoading={previewsLoading}
                onSelect={() => onSelect(String(display.index))}
                onRecord={onRecord ? () => onRecord(String(display.index)) : undefined}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
