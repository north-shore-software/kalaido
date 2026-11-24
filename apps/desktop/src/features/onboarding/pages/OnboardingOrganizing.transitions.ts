import { defineTransitions } from "@/routes/route-kit";

export const onboardingOrganizingTransitions = defineTransitions({
  toApp: {
    to: "main",
    trigger: "Map and colours discovery finish, or click 'Skip to app'",
  },
});
