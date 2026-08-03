import { defineTransitions } from "@/routes/route-kit";

export const connectionsTransitions = defineTransitions({
  openImport: {
    to: "import",
    trigger: "Click 'Import' card",
    when: "When opening the Import tool from Connections",
  },
});
