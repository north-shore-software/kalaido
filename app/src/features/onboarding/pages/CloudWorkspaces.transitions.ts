import { defineTransitions } from "@/routes/route-kit";

export const cloudWorkspacesTransitions = defineTransitions({
  back: {
    to: "onboarding-landing",
    trigger: "Click 'Back'",
  },
  createWorkspace: {
    to: "kalaidoscope-setup",
    trigger: "Click '+ Create New Workspace'",
    when: "Already past the sign-in gate",
  },
});
