import { defineChromeTransitions } from "@/routes/route-kit";

export const switcherTransitions = defineChromeTransitions(
  "chrome:nav-kalaidoscope-switcher",
  "Kalaidoscope Switcher",
  {
    newKalaidoscope: {
      to: "kalaidoscope-setup",
      trigger: "Click 'New kalaidoscope' in the switcher menu",
    },
  },
);
