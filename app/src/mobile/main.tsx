import "@/index.css";
import "./mobile.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { bootstrapStoredState } from "@/hooks/use-app-state.ts";
import { setAppVariant } from "@/lib/app-variant";
import { AppProviders } from "@/providers/app-providers";
import { MobileRouter } from "@/routes/mobile-router";

setAppVariant("mobile");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppProviders>
      <MobileRouter />
    </AppProviders>
  </React.StrictMode>,
);

void bootstrapStoredState();
