import "@/index.css";
import "./web.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { bootstrapStoredState } from "@/hooks/use-app-state.ts";
import { setAppVariant } from "@/lib/app-variant";
import { AppProviders } from "@/providers/app-providers";
import { WebRouter } from "@/routes/web-router";

setAppVariant("web");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppProviders>
      <WebRouter />
    </AppProviders>
  </React.StrictMode>,
);

void bootstrapStoredState();
