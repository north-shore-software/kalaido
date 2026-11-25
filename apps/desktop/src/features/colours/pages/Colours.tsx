import { ColoursScreen } from "@kalaido/features/colours";
import { PageLayout } from "@/components/layout/page-layout";
import { useAppRouteState } from "@/routes/use-app-route-state";

export default function Colours() {
  const { seed } = useAppRouteState<"colours">();
  return (
    <PageLayout>
      <ColoursScreen seed={seed} />
    </PageLayout>
  );
}
