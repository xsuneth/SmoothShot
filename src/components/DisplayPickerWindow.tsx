import type { DisplayDescriptor } from "../types";
import { convertFileSrc } from "@tauri-apps/api/core";

type DisplayPickerWindowProps = {
  displays: DisplayDescriptor[];
  displaySelection: string;
  isLoading: boolean;
  onSelect: (selection: string) => void;
};

function DisplayCard({
  title,
  subtitle,
  previewPath,
  selected,
  onSelect,
}: {
  title: string;
  subtitle: string;
  previewPath?: string | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const previewUrl = previewPath ? `${convertFileSrc(previewPath)}?t=${Date.now()}` : null;

  return (
    <div
      className={[
        "flex h-[92px] w-[240px] items-center gap-[12px] rounded-[9px] px-[6px] py-[6px] transition-colors",
        selected ? "bg-white/[0.07]" : "bg-transparent hover:bg-white/[0.03]",
      ].join(" ")}
    >
      <button type="button" className="flex min-w-0 shrink-0 items-center gap-[12px] text-left" onClick={onSelect}>
        <div className="h-[76px] w-[120px] shrink-0 overflow-hidden rounded-lg border-[0.6px] border-zinc-500 bg-[#d9d9d9]">
          {previewUrl ? (
            <img src={previewUrl} alt={title} className="h-full w-full object-cover" draggable={false} />
          ) : (
            <div className="h-full w-full bg-[linear-gradient(140deg,#6d83d2,#3e316b)]" />
          )}
        </div>
      </button>
      <div className="min-w-0 flex-1 flex flex-col gap-1.5">
        <div className="flex flex-col">
          <p className="truncate text-[12px] font-semibold leading-tight text-[#ebebeb]">{title}</p>
          <p className="truncate text-[10px] font-semibold leading-tight text-[#8e8e8e]">{subtitle}</p>
        </div>
        <button type="button" className="flex bg-[#CA5757]/42 hover:bg-[#CA5757]/70 transition-colors translate-1 text-white py-1 px-2 justify-center rounded-md items-center gap-2" onClick={onSelect}>
        <img src="/icons/launcher/record.svg" alt="" className="h-4 aspect-square" draggable={false} aria-hidden="true" />
        Record</button>
      </div>
    </div>
  );
}

export function DisplayPickerWindow({
  displays,
  displaySelection,
  isLoading,
  onSelect,
}: DisplayPickerWindowProps) {
  const cards = displays.map((display) => ({
    id: String(display.index),
    title: display.name.trim().length > 0 ? display.name : `Desktop ${String(display.index + 1).padStart(2, "0")}`,
    subtitle: display.isPrimary ? "Primary Display" : `${display.width}x${display.height}`,
    previewPath: display.previewPath,
  }));

  return (
    <main className="flex h-full w-full items-center justify-center overflow-hidden bg-transparent">
      <section className="rounded-xl border-[0.6px] border-[#6c6c6c] bg-[#312f2f]">
        {isLoading ? (
          <div className="flex h-full w-full items-center justify-center rounded-[8px] text-[12px] font-medium text-white/80">
            Loading displays...
          </div>
        ) : (
          <div className="flex flex-row">
            {cards.map((display) => (
              <DisplayCard
                key={display.id}
                title={display.title}
                subtitle={display.subtitle}
                previewPath={display.previewPath}
                selected={displaySelection === display.id}
                onSelect={() => onSelect(display.id)}
              />
            ))}
          </div>
        )}
        {!isLoading && cards.length === 0 && (
          <div className="flex h-[92px] w-[240px] items-center justify-center rounded-[8px] text-[12px] font-medium text-white/65">
            No displays found
          </div>
        )}
      </section>
    </main>
  );
}
