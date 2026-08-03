import { defineTransitions } from "@/routes/route-kit";

export const streamTransitions = defineTransitions({
  openImport: {
    to: "import",
    trigger: "Click ‘Import’ in the empty state",
    when: "Stream has no fragments",
  },
  openFragment: {
    to: "stream",
    trigger: "Click a stream card",
    when: "Opens the fragment drawer (/stream/:id)",
  },
  closeFragment: {
    to: "stream",
    trigger: "Close the fragment drawer",
  },
});
