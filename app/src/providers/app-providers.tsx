import type { ReactNode } from "react";
import { ThemeProvider } from "./theme-provider";
import { Toaster } from "@/components/ui/sonner";

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
