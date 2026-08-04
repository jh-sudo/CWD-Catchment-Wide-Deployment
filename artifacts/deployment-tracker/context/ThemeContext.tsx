import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Appearance, useColorScheme } from "react-native";

type ThemeMode = "light" | "dark" | "system";

interface ThemeContextValue {
  mode: ThemeMode;
  isDark: boolean;
  toggle: () => void;
  setMode: (m: ThemeMode) => void;
}

const STORAGE_KEY = "@app_theme_mode";

const ThemeContext = createContext<ThemeContextValue>({
  mode: "dark",
  isDark: true,
  toggle: () => {},
  setMode: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();

  // Synchronously seed from device so first render already matches.
  const [mode, setModeState] = useState<ThemeMode>(() => {
    const sys = Appearance.getColorScheme();
    return sys === "dark" ? "dark" : "light";
  });

  // Load persisted preference once on mount.
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((val) => {
      if (val === "light" || val === "dark" || val === "system") {
        setModeState(val);
      }
    }).catch(() => {});
  }, []);

  const isDark =
    mode === "system" ? systemScheme === "dark" : mode === "dark";

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    AsyncStorage.setItem(STORAGE_KEY, m).catch(() => {});
  }, []);

  const toggle = useCallback(() => {
    setMode(isDark ? "light" : "dark");
  }, [isDark, setMode]);

  return (
    <ThemeContext.Provider value={{ mode, isDark, toggle, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
