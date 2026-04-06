import { useEffect, useState } from "react";

import type { BackgroundStyle } from "../types";
import { nextBackgroundValue } from "../lib/utils";

export interface UseBackgroundResult {
  backgroundStyle: BackgroundStyle;
  backgroundImageFileName: string;
  updateBackgroundTab: (tab: BackgroundStyle["tab"]) => void;
  updateBackgroundValue: (value: string) => void;
  updateBackgroundBlur: (blur: number) => void;
  updateBackgroundImage: (file: File | null) => void;
}

const DEFAULT_BACKGROUND: BackgroundStyle = { tab: "wallpaper", value: "macos", blur: 0 };

export function useBackground(): UseBackgroundResult {
  const [backgroundStyle, setBackgroundStyle] = useState<BackgroundStyle>(DEFAULT_BACKGROUND);
  const [backgroundImageFileName, setBackgroundImageFileName] = useState("");

  useEffect(() => {
    return () => {
      if (backgroundStyle.tab === "image" && backgroundStyle.value.startsWith("blob:")) {
        URL.revokeObjectURL(backgroundStyle.value);
      }
    };
  }, [backgroundStyle]);

  function updateBackgroundTab(tab: BackgroundStyle["tab"]) {
    setBackgroundStyle((prev) => {
      if (prev.tab === tab) return prev;
      return { ...prev, tab, value: nextBackgroundValue(tab) };
    });
  }

  function updateBackgroundValue(value: string) {
    setBackgroundStyle((prev) => ({ ...prev, value }));
  }

  function updateBackgroundBlur(blur: number) {
    setBackgroundStyle((prev) => ({ ...prev, blur }));
  }

  function updateBackgroundImage(file: File | null) {
    if (!file) return;
    setBackgroundStyle((prev) => {
      if (prev.tab === "image" && prev.value.startsWith("blob:")) {
        URL.revokeObjectURL(prev.value);
      }
      return { ...prev, tab: "image", value: URL.createObjectURL(file) };
    });
    setBackgroundImageFileName(file.name);
  }

  return {
    backgroundStyle,
    backgroundImageFileName,
    updateBackgroundTab,
    updateBackgroundValue,
    updateBackgroundBlur,
    updateBackgroundImage,
  };
}
