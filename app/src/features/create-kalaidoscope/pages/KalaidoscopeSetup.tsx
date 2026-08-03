import { useId, useState } from "react";
import { useLocation } from "react-router-dom";
import { defineRoute } from "@/routes/route-kit";
import { kalaidoscopeSetupTransitions } from "./KalaidoscopeSetup.transitions";
import { ArrowLeftIcon, ChevronRightIcon } from "lucide-react";
import { openDirectoryPicker } from "@/api/app/os-integrations.ts";
import { proxy, useSnapshot } from "valtio";
import { useAppNavigate } from "@/routes/use-app-navigate";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/css-utils";

import { IconPicker } from "../components/icon-picker.tsx";
import type { Template } from "../templates.ts";
import {
  createKalaidoscope,
  parseLocation,
} from "@/features/create-kalaidoscope/actions.ts";
import { useCloudSession } from "@/hooks/use-cloud-session.ts";
import {
  StorageOptionCards,
  type StorageType,
} from "../components/storage-option-cards";
import { AdvancedLocationFields } from "../components/advanced-location-fields";

function deriveCloudId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function KalaidoscopeSetup() {
  const { goBack } = useAppNavigate();
  const location = useLocation();
  const { template } = (location.state ?? {}) as {
    template?: Template;
  };

  const [state] = useState(() =>
    proxy({
      name: "",
      icon: undefined as string | undefined,
      storage: "local_file" as StorageType,
      advancedOpen: false,
      locationInput: "",
      cloudId: "",
      cloudIdEdited: false,
      error: null as string | null,
      isPending: false,
    }),
  );

  const snap = useSnapshot(state);

  const nameFieldId = useId();
  const storageLabelId = useId();

  const { signedIn } = useCloudSession();

  function handleNameChange(value: string) {
    state.name = value;
    if (!state.cloudIdEdited) {
      state.cloudId = deriveCloudId(value);
    }
  }

  function handleCloudIdChange(value: string) {
    state.cloudId = value;
    state.cloudIdEdited = true;
  }

  const parsedLocation = parseLocation(snap.locationInput);
  const locationIsInvalid = parsedLocation.kind === "invalid";
  const needsSignIn = snap.storage === "cloud" && !signedIn;

  const canCreate =
    !!snap.name.trim() &&
    !locationIsInvalid &&
    (snap.storage === "local_file" || (!!snap.cloudId.trim() && signedIn));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate || state.isPending) return;

    state.isPending = true;
    state.error = null;

    const result = await createKalaidoscope({
      name: state.name,
      icon: state.icon,
      storage: state.storage,
      cloudId: state.cloudId,
      locationInput: state.locationInput,
    });

    if (result.isErr()) {
      console.error("Failed to create kalaidoscope:", result.error);
      state.error = result.error.message;
      state.isPending = false;
    }
  }

  return (
    <div
      className="flex flex-col bg-background"
      style={{ height: "calc(100svh - var(--titlebar-height))" }}
    >
      <main className="relative flex-1 overflow-auto p-8 flex flex-col items-center">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => goBack()}
          className="absolute top-4 left-4 gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon />
          Back
        </Button>

        <form
          onSubmit={handleSubmit}
          className="w-full max-w-md flex flex-col gap-8 mt-12"
        >
          {template?.name && (
            <div>
              <span className="inline-flex items-center rounded-md border px-2.5 py-1 text-xs text-muted-foreground">
                {template.name}
              </span>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <label
              htmlFor={nameFieldId}
              className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
            >
              Name
            </label>
            <div className="flex items-center gap-2">
              <IconPicker
                value={snap.icon}
                onChange={(icon) => (state.icon = icon)}
              />
              <Input
                id={nameFieldId}
                autoFocus
                type="text"
                value={snap.name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="My kalaidoscope"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span
              id={storageLabelId}
              className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
            >
              Storage
            </span>
            <StorageOptionCards
              value={snap.storage}
              onChange={(v) => (state.storage = v)}
              aria-labelledby={storageLabelId}
            />
          </div>

          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => (state.advancedOpen = !state.advancedOpen)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-fit"
            >
              <ChevronRightIcon
                className={cn(
                  "size-3.5 transition-transform",
                  snap.advancedOpen && "rotate-90",
                )}
              />
              Advanced
            </button>

            {snap.advancedOpen && (
              <AdvancedLocationFields
                storage={snap.storage}
                locationInput={snap.locationInput}
                onLocationInput={(v) => (state.locationInput = v)}
                onBrowse={async () => {
                  const result = await openDirectoryPicker();
                  if (result.isOk() && result.value) {
                    state.locationInput = result.value;
                  }
                }}
                parsedLocation={parsedLocation}
                cloudId={snap.cloudId}
                onCloudId={(v) => handleCloudIdChange(v)}
              />
            )}
          </div>

          {needsSignIn && (
            <p className="text-xs text-muted-foreground">
              Sign in to your cloud account in Settings to create a cloud
              kalaidoscope.
            </p>
          )}
          {snap.error && (
            <p className="text-xs text-destructive">{snap.error}</p>
          )}

          <div className="flex justify-end">
            <Button
              size="sm"
              type="submit"
              disabled={!canCreate || snap.isPending}
            >
              {snap.isPending ? "Creating…" : "Create Kalaidoscope"}
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
}

export const kalaidoscopeSetupRoute = defineRoute({
  id: "kalaidoscope-setup",
  path: "/kalaidoscope/setup",
  feature: "Create Kalaidoscope",
  requiredScope: [],
  transitions: kalaidoscopeSetupTransitions,
  Component: KalaidoscopeSetup,
});
