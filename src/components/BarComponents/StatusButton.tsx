import type { MouseEvent, ReactNode } from "react";
import cn from "../../helpers/cn";

export default function StatusButton({
  enabled,
  enabledIcon,
  disabledIcon,
  enabledLabel,
  disabledLabel,
  meterLevel,
  onClick,
  className,
}: {
  enabled: boolean;
  enabledIcon: ReactNode;
  disabledIcon: ReactNode;
  enabledLabel: string;
  disabledLabel: string;
  meterLevel?: number;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
}) {
  const label = enabled ? enabledLabel : disabledLabel;

  return (
    <button
      type="button"
      className={cn( className,
        "no-drag flex h-[46px] w-full min-w-[114px] items-center gap-[7px] rounded-[9px] px-[12px] text-[11.5px] font-semibold transition",
        enabled ? "text-white hover:bg-white/[0.04]" : "text-[#8d8d8d] hover:bg-white/[0.03] hover:text-white/90"
      )}
      onClick={onClick}
    >
      <span className="shrink-0 opacity-100">{enabled ? enabledIcon : disabledIcon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-left">{label}</span>
        {enabled && typeof meterLevel === "number" && (
          <span className="mt-[3px] block h-[3px] w-full rounded-full bg-white/20">
            <span
              className="block h-full rounded-full bg-[#7dd4ff] transition-[width] duration-75"
              style={{ width: `${Math.max(4, Math.round(Math.min(1, meterLevel) * 100))}%` }}
            />
          </span>
        )}
      </span>
    </button>
  );
}