import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "razorgrowth-theme";
type Theme = "light" | "dark";

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function readInitialTheme(): Theme {
  if (typeof document === "undefined") return "light";
  // The inline anti-FOUC script in index.html already applied the class
  // synchronously before React mounted — read it back rather than
  // re-deriving from localStorage, so the two never disagree.
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/** Theme toggle (PART 09 productization sprint §11). Persists to
 * localStorage; falls back to system preference only on first visit
 * (never overrides an explicit user choice on subsequent visits). */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  return { theme, toggle, systemPrefersDark: systemPrefersDark() };
}
