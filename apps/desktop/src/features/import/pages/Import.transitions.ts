import { defineTransitions } from "@/routes/route-kit";

export const importTransitions = defineTransitions({
  backToStream: {
    to: "stream",
    trigger: "Click ‘Back to stream’ in the header",
  },
  viewStream: {
    to: "stream",
    trigger: "Click ‘View stream’ after successful import",
  },
});
