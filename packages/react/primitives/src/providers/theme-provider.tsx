import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
} from "react";
import { applyTheme, type Theme, watchSystemTheme } from "#lib/theme";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "system",
  setTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({
  theme,
  onThemeChange,
  children,
}: {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  children: ReactNode;
}) {
  useLayoutEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // On "system", the OS can change the answer while the app is open.
  useEffect(() => {
    if (theme !== "system") return;
    return watchSystemTheme(() => applyTheme("system"));
  }, [theme]);

  const setTheme = useCallback(
    (next: Theme) => {
      applyTheme(next);
      onThemeChange(next);
    },
    [onThemeChange],
  );

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
