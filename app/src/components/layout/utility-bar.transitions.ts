import { defineChromeTransitions } from "@/routes/route-kit";

export const utilityBarTransitions = defineChromeTransitions(
  "chrome:utility-bar",
  "Utility Bar",
  {
    openStatus: {
      to: "status",
      trigger: "Click worker cluster in utility bar",
    },
  },
);
