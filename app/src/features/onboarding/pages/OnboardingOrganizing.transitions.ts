import { defineTransitions } from "@/routes/route-kit";

export const onboardingOrganizingTransitions = defineTransitions({
  toApp: {
    to: "main",
    trigger: "Map and organize finish, or click 'Skip to app'",
  },
});
