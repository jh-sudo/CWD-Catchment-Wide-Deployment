import { useEffect, useState } from "react";

export function useTheme() {
  const [dark, setDark] = useState(() => {
    if (typeof window === "undefined") return false;
    const stored = localStorage.getItem("roster-theme");
    if (stored) return stored === "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (dark) {
      root.classList.add("dark");
      localStorage.setItem("roster-theme", "dark");
    } else {
      root.classList.remove("dark");
      localStorage.setItem("roster-theme", "light");
    }
  }, [dark]);

  return { dark, toggleTheme: () => setDark(d => !d) };
}
