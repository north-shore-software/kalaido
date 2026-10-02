import "@/index.css";
import "./mobile.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { bootstrapStoredState } from "@/hooks/use-app-state.ts";
import { setAppVariant } from "@/lib/app-variant";
import { AppProviders } from "@/providers/app-providers";
import { CompanionRouter } from "@/routes/companion-router";
import { installKeyboardInset } from "./keyboard-inset";

setAppVariant("mobile");
installKeyboardInset();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppProviders>
      <CompanionRouter />
    </AppProviders>
  </React.StrictMode>,
);

void bootstrapStoredState();
