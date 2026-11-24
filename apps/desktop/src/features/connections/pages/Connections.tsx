import { ConnectionsScreen } from "@kalaido/features/connections";
import { PageLayout } from "@/components/layout/page-layout";
import { defineRoute } from "@/routes/route-kit";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { connectionsTransitions } from "./Connections.transitions";

export default function Connections() {
  const { go } = useAppNavigate();
  return (
    <PageLayout>
      <ConnectionsScreen
        onOpenImport={() => go(connectionsTransitions.openImport)}
      />
    </PageLayout>
  );
}

export const connectionsRoute = defineRoute({
  id: "connections",
  path: "/connections",
  feature: "Connections",
  requiredScope: ["kalaidoscope"],
  featureFlag: "connections",
  transitions: connectionsTransitions,
  Component: Connections,
});
