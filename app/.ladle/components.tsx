import type { GlobalProvider } from "@ladle/react";
import { useEffect } from "react";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "../src/providers/theme-provider";
import "../src/index.css";

export const Provider: GlobalProvider = ({ children, globalState }) => {
  useEffect(() => {
    // No native titlebar in the browser — drop the app CSS body offset.
    document.documentElement.style.setProperty("--titlebar-height", "0px");
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle(
      "dark",
      globalState.theme === "dark",
    );
  }, [globalState.theme]);
  return (
    <ThemeProvider>
      <MemoryRouter>{children}</MemoryRouter>
    </ThemeProvider>
  );
};
