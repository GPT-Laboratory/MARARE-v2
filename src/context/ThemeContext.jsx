/**
 * Light/dark mode with localStorage persistence.
 * File: src/context/ThemeContext.jsx
 */
import { createContext, useContext, useEffect, useMemo, useState } from "react";

const ThemeContext = createContext(null);

const STORAGE_KEY = "marare-theme";

export function ThemeProvider({ children }) {
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const savedTheme = localStorage.getItem(STORAGE_KEY);

    if (savedTheme === "dark") return true;
    if (savedTheme === "light") return false;

    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  });

  useEffect(() => {
    const nextTheme = isDarkMode ? "dark" : "light";

    localStorage.setItem(STORAGE_KEY, nextTheme);
    document.documentElement.setAttribute("data-theme", nextTheme);
    document.body.classList.toggle("app-theme-dark", isDarkMode);
    document.body.classList.toggle("app-theme-light", !isDarkMode);
  }, [isDarkMode]);

  const value = useMemo(
    () => ({
      isDarkMode,
      toggleTheme: () => setIsDarkMode((currentValue) => !currentValue),
      setIsDarkMode,
    }),
    [isDarkMode]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }

  return context;
}
