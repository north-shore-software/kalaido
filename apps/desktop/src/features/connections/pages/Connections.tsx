import { ConnectionsScreen } from "@kalaido/features/connections";
import { PageLayout } from "@/components/layout/page-layout";
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
