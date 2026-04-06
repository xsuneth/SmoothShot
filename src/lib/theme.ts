import type { BackgroundStyle } from "../types";

export const wallpapers: Record<string, string> = {
  macos: "linear-gradient(135deg, #2241a8 0%, #4c2f7e 38%, #3d234f 100%)",
  spring: "linear-gradient(135deg, #6cd5b6 0%, #2c7aa8 45%, #19334d 100%)",
  sunset: "linear-gradient(135deg, #ff9966 0%, #ff5e62 35%, #59253a 100%)",
  radial: "radial-gradient(circle at top, #5b3f95 0%, #24163d 55%, #120f1f 100%)",
};

export const gradients: Record<string, string> = {
  aurora: "linear-gradient(135deg, #30cfd0 0%, #330867 100%)",
  candy: "linear-gradient(135deg, #fa709a 0%, #fee140 100%)",
  ocean: "linear-gradient(135deg, #43cea2 0%, #185a9d 100%)",
  ember: "linear-gradient(135deg, #ffaf7b 0%, #d76d77 100%)",
};

export const colors: Record<string, string> = {
  midnight: "#10131f",
  plum: "#2d2344",
  slate: "#19202c",
  cream: "#ece2d0",
};

export function backgroundCss(style: BackgroundStyle): string {
  if (style.tab === "wallpaper") return wallpapers[style.value] ?? wallpapers.macos;
  if (style.tab === "gradient") return gradients[style.value] ?? gradients.aurora;
  if (style.tab === "color") return colors[style.value] ?? colors.midnight;
  if (style.value.trim()) return `url("${style.value}") center/cover no-repeat`;
  return wallpapers.macos;
}
