import { MapScreen } from "@kalaido/features/map";
import { PageLayout } from "@/components/layout/page-layout";
import { defineRoute } from "@/routes/route-kit";
import { mapTransitions } from "./Map.transitions";

export default function MapPage() {
  return (
    <PageLayout>
      <MapScreen />
    </PageLayout>
  );
}

export const mapRoute = defineRoute({
  id: "map",
  path: "/map",
  feature: "Map",
  requiredScope: ["kalaidoscope"],
  transitions: mapTransitions,
  Component: MapPage,
});
