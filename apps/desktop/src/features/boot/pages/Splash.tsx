import { SplashScreen } from "@kalaido/components/splash-screen";
import { defineRoute } from "@/routes/route-kit";
import { splashTransitions } from "./Splash.transitions";

export default function Splash() {
  return <SplashScreen />;
}

export const splashRoute = defineRoute({
  id: "splash",
  path: "/splash",
  aliases: ["/"],
  feature: "Boot",
  requiredScope: [],
  transitions: splashTransitions,
  Component: Splash,
});
