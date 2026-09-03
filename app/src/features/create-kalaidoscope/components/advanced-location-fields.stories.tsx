import type { Story } from "@ladle/react";
import { action } from "@/lib/story-utils.ts";
import { AdvancedLocationFields } from "./advanced-location-fields";

export default { title: "Setup / AdvancedLocationFields" };

export const LocalValidPath: Story = () => (
  <div className="p-4 max-w-md border rounded bg-background">
    <AdvancedLocationFields
      storage="local_file"
      locationInput="/Users/louis/kalaidoscopes"
      onLocationInput={action("onLocationInput")}
      onBrowse={action("onBrowse")}
      parsedLocation={{ kind: "local", path: "/Users/louis/kalaidoscopes" }}
      cloudId=""
      onCloudId={action("onCloudId")}
    />
  </div>
);

export const LocalInvalidPath: Story = () => (
  <div className="p-4 max-w-md border rounded bg-background">
    <AdvancedLocationFields
      storage="local_file"
      locationInput="not-a-valid-path"
      onLocationInput={action("onLocationInput")}
      onBrowse={action("onBrowse")}
      parsedLocation={{ kind: "invalid" }}
      cloudId=""
      onCloudId={action("onCloudId")}
    />
  </div>
);

export const Cloud: Story = () => (
  <div className="p-4 max-w-md border rounded bg-background">
    <AdvancedLocationFields
      storage="cloud"
      locationInput=""
      onLocationInput={action("onLocationInput")}
      onBrowse={action("onBrowse")}
      parsedLocation={{ kind: "default" }}
      cloudId="premium-scope"
      onCloudId={action("onCloudId")}
    />
  </div>
);
