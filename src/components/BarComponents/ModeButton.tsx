import type { MouseEvent, ReactNode } from "react";
import cn from "../../helpers/cn";

export default function ModeButton({
  active,
  activeIcon,
  inactiveIcon,
  label,
  onClick,
}: {
  active: boolean;
  activeIcon: ReactNode;
  inactiveIcon?: ReactNode;
  label: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "no-drag flex h-12.5 w-15 flex-col items-center justify-center gap-1.25 rounded-[9px] px-1 transition",
        active
          ? "bg-white/8 text-neutral-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
          : "text-[#999] hover:bg-white/4 hover:text-neutral-400",
      )}
      onClick={onClick}
      aria-pressed={active}
    >
      <span className="flex h-5 items-center justify-center">{active ? activeIcon : inactiveIcon ?? activeIcon}</span>
      <span className="text-[8.5px] font-semibold leading-none">{label}</span>
    </button>
  );
}