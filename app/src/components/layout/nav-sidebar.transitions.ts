import { defineChromeTransitions } from "@/routes/route-kit";

export const navSidebarTransitions = defineChromeTransitions(
  "chrome:nav-sidebar",
  "Navigation Sidebar",
  {
    openChat: { to: "chat", trigger: "Click 'Chat' in the sidebar" },
    openConnections: {
      to: "connections",
      trigger: "Click 'Connections' in the sidebar",
    },
    openDashboard: { to: "main", trigger: "Click 'Dashboard' in the sidebar" },
    openSettings: {
      to: "settings",
      trigger: "Click 'Settings' in the sidebar",
    },
    openProjections: {
      to: "projections",
      trigger: "Click 'Projections' in the sidebar",
    },
    openReflections: {
      to: "reflections",
      trigger: "Click 'Reflections' in the sidebar",
    },
    openColours: { to: "colours", trigger: "Click 'Colours' in the sidebar" },
    openFragments: {
      to: "stream",
      trigger: "Click 'Fragments' in the sidebar",
    },
  },
);
