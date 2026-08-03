import { err, ok, type Result } from "neverthrow";
import type { KalaidoscopeMeta } from "@/api/app/types.ts";
import { appState } from "@/hooks/use-app-state.ts";
import {
  addAvailableKalaidoscope,
  setAppStage,
} from "@/hooks/app-state-actions.ts";
import { setSetting } from "@/api/app/settings.ts";
import { createLocalKalaidoscope } from "@/api/app/local-scopes.ts";
import {
  formatLocalNetLocator,
  isLoopbackHostname,
} from "@/api/kalaidoscope/local-url.ts";
import { createCloudKalaidoscope } from "@/api/cloud/user.ts";
import { toError } from "@/lib/errors.ts";

export interface CreateKalaidoscopeInput {
  name: string;
  icon?: string;
  storage: "local_file" | "cloud";
  cloudId: string;
  locationInput: string;
}

export type LocationResult =
  | { kind: "default" }
  | { kind: "local"; path: string }
  | { kind: "dev"; url: string }
  | { kind: "invalid"; reason?: string };

export function parseLocation(value: string): LocationResult {
  const v = value.trim();
  if (!v) return { kind: "default" };
  try {
    const url = new URL(v);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return classifyNetLocation(url);
    }
  } catch {}
  if (v.startsWith("/") || /^[A-Za-z]:[/\\]/.test(v)) {
    return { kind: "local", path: v };
  }
  return { kind: "invalid" };
}

/**
 * Both rejections here exist to fail loudly at the point of entry. Left to
 * reach the network, a non-loopback host is blocked by the webview's CSP and a
 * bad TLS handshake is refused by the socket — and WebKit reports both as the
 * same opaque "Could not connect to the server."
 */
function classifyNetLocation(url: URL): LocationResult {
  if (!isLoopbackHostname(url.hostname)) {
    return {
      kind: "invalid",
      reason:
        "Only localhost and 127.0.0.1 are supported. The app's content security policy is a fixed allowlist and can't cover other hosts.",
    };
  }
  if (url.protocol === "https:") {
    return {
      kind: "invalid",
      reason: "Use http:// — a local PocketBase instance serves plain HTTP.",
    };
  }
  return { kind: "dev", url: formatLocalNetLocator(url) };
}

export async function createKalaidoscope(
  input: CreateKalaidoscopeInput,
): Promise<Result<KalaidoscopeMeta, Error>> {
  try {
    const id = crypto.randomUUID();
    let locator = "";
    let type: KalaidoscopeMeta["type"] = "local_file";

    const nameTrimmed = input.name.trim();

    if (input.storage === "cloud") {
      type = "cloud";
      locator = input.cloudId.trim();
      // Cloud kalaidoscopes must be claimed (owner = signed-in user) before we persist.
      const registered = await createCloudKalaidoscope(locator, nameTrimmed);
      if (registered.isErr()) {
        return err(registered.error);
      }
    } else {
      const parsedLocation = parseLocation(input.locationInput);
      if (parsedLocation.kind === "invalid") {
        return err(
          new Error(parsedLocation.reason ?? "Invalid location specified."),
        );
      }

      if (parsedLocation.kind === "dev") {
        type = "local_net";
        locator = parsedLocation.url;
      } else {
        type = "local_file";
        const createResult = await createLocalKalaidoscope(
          id,
          parsedLocation.kind === "local" ? parsedLocation.path : undefined,
        );
        if (createResult.isErr()) {
          return err(createResult.error);
        }
        locator = createResult.value.path;
      }
    }

    const newKalaidoscope: KalaidoscopeMeta = {
      id,
      type,
      locator,
      displayName: nameTrimmed,
      icon: input.icon,
    };

    addAvailableKalaidoscope(newKalaidoscope);

    await setSetting("availableKalaidoscopes", [
      ...appState.availableKalaidoscopes,
    ]);
    await setSetting("lastOpenedKalaidoscopeId", id);

    setAppStage({
      stage: "kalaidoscope_load_requested",
      loadKalaidoscopeId: id,
    });

    return ok(newKalaidoscope);
  } catch (e) {
    return err(toError(e));
  }
}
