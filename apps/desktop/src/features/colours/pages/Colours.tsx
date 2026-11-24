import { ColoursScreen } from "@kalaido/features/colours";
import { PageLayout } from "@/components/layout/page-layout";
import { defineRoute } from "@/routes/route-kit";
import { useAppRouteState } from "@/routes/use-app-route-state";
import { coloursTransitions } from "./Colours.transitions";

export default function Colours() {
  const { seed } = useAppRouteState<"colours">();
  return (
    <PageLayout>
      <ColoursScreen seed={seed} />
    </PageLayout>
  );
}

export const coloursRoute = defineRoute({
  id: "colours",
  path: "/colours",
  feature: "Colours",
  requiredScope: ["kalaidoscope"],
  transitions: coloursTransitions,
  Component: Colours,
});
