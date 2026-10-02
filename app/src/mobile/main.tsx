import "@/index.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { Mark } from "@/components/kalaido/brand";
import { EmptyState } from "@/components/kalaido/empty-state";
import { AppProviders } from "@/providers/app-providers";

/** Mobile entry point. Shares components and business logic with desktop,
 *  but never its router or boot sequence (src/main.tsx). */
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppProviders>
      <main className="flex min-h-[calc(100svh-var(--titlebar-height))] flex-col items-center justify-center gap-4">
        <Mark className="size-12" />
        <EmptyState>Kalaido mobile</EmptyState>
      </main>
    </AppProviders>
  </React.StrictMode>,
);
