import { defineChromeTransitions } from "@/routes/route-kit";

export const switcherTransitions = defineChromeTransitions(
  "chrome:nav-kalaidoscope-switcher",
  "Kalaidoscope Switcher",
  {
    newKalaidoscope: {
      to: "select-template",
      trigger: "Click 'New kalaidoscope' in the switcher menu",
    },
  },
);
