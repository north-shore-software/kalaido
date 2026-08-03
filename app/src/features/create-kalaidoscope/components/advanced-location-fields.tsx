import { useId } from "react";
import { FolderOpenIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/css-utils";
import type { LocationResult } from "@/features/create-kalaidoscope/actions.ts";

export interface AdvancedLocationFieldsProps {
  storage: "local_file" | "cloud";
  locationInput: string;
  onLocationInput: (v: string) => void;
  onBrowse: () => void;
  parsedLocation: LocationResult;
  cloudId: string;
  onCloudId: (v: string) => void;
}

export function AdvancedLocationFields({
  storage,
  locationInput,
  onLocationInput,
  onBrowse,
  parsedLocation,
  cloudId,
  onCloudId,
}: AdvancedLocationFieldsProps) {
  const locationId = useId();
  const cloudFieldId = useId();
  const locationIsInvalid = parsedLocation.kind === "invalid";

  return (
    <div className="flex flex-col gap-2 pl-5">
      {storage === "local_file" ? (
        <>
          <label
            htmlFor={locationId}
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            Location
          </label>
          <div className="flex items-center gap-2">
            <Input
              id={locationId}
              value={locationInput}
              onChange={(e) => onLocationInput(e.target.value)}
              placeholder="Default location"
              className={cn(
                "flex-1 min-w-0 font-mono text-sm",
                locationIsInvalid &&
                  "border-destructive focus-visible:ring-destructive",
              )}
            />
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              className="shrink-0"
              onClick={onBrowse}
            >
              <FolderOpenIcon />
            </Button>
          </div>
          {parsedLocation.kind === "invalid" && (
            <p className="text-xs text-destructive">
              {parsedLocation.reason ??
                "Enter an absolute path (e.g. /Users/me/data) or a URL (e.g. http://localhost:8090)."}
            </p>
          )}
          {parsedLocation.kind === "dev" && (
            <p className="text-xs text-muted-foreground">
              Dev kalaidoscope — connects to an existing PocketBase instance.
              Include credentials in the URL
              (http://user:password@localhost:8090); they are stored in plain
              text on this machine.
            </p>
          )}
        </>
      ) : (
        <>
          <label
            htmlFor={cloudFieldId}
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            Kalaidoscope Global ID
          </label>
          <Input
            id={cloudFieldId}
            value={cloudId}
            onChange={(e) => onCloudId(e.target.value)}
            placeholder="my-kalaidoscope"
            className="font-mono text-sm"
          />
        </>
      )}
    </div>
  );
}
