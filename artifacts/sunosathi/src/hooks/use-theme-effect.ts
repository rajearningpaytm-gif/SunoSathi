import { useState, useEffect } from "react";

export function useThemeEffect(themePreference: "light" | "dark" | undefined) {
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove("light", "dark");
    if (themePreference === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.add("light");
    }
  }, [themePreference]);
}
