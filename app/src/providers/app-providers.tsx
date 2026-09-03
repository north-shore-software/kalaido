import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "./theme-provider";

/**
 * Composes every top-level provider the app needs. Currently just theme; add
 * new ones here (auth, query client, etc.) so main.tsx stays a thin entry.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      {children}
      <Toaster />
    </ThemeProvider>
  );
}
