import { StreamScreen } from "@kalaido/features/fragments";
import { PageLayout } from "@/components/layout/page-layout";
import { defineRoute } from "@/routes/route-kit";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { useAppParams } from "@/routes/use-app-params";
import { streamTransitions } from "./Stream.transitions";

export default function Stream() {
  const { go } = useAppNavigate();
  const { id: selectedId } = useAppParams<"stream">();
  return (
    <PageLayout>
      <StreamScreen
        selectedId={selectedId}
        onOpenFragment={(id) =>
          go(streamTransitions.openFragment, { params: { id } })
        }
        onCloseFragment={() => go(streamTransitions.closeFragment)}
        onOpenImport={() => go(streamTransitions.openImport)}
      />
    </PageLayout>
  );
}

export const streamRoute = defineRoute({
  id: "stream",
  path: "/stream/:id?",
  feature: "Fragments",
  requiredScope: ["kalaidoscope"],
  transitions: streamTransitions,
  Component: Stream,
});
