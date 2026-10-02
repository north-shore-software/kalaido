import { defineTransitions } from "@/routes/route-kit";

export const cloudSignInTransitions = defineTransitions({
  signedIn: {
    to: "cloud-workspaces",
    trigger: "Sign in succeeds, or a live session is found on launch",
  },
});
