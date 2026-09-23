import { defineTransitions } from "@/routes/route-kit";

export const statusTransitions = defineTransitions(
  "feature:status",
  "Status",
  {},
);
