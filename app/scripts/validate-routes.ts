import "./dom-prelude";
import type { AppStage } from "../src/hooks/use-app-state";

process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
});

async function main() {
  const { appRoutes, routeById } = await import("../src/routes/registry");
  const { ROUTE_IDS } = await import("../src/routes/route-ids");

  const errors: string[] = [];
  const ids = new Set(appRoutes.map((r) => r.id));

  for (const id of ROUTE_IDS)
    if (!ids.has(id)) errors.push(`no RouteDef for id "${id}"`);
  if (ids.size !== appRoutes.length)
    errors.push("duplicate route ids in registry");

  const paths = new Set<string>();
  for (const r of appRoutes) {
    for (const p of [r.path, ...(r.aliases ?? [])]) {
      if (paths.has(p)) errors.push(`duplicate path "${p}" (route "${r.id}")`);
      paths.add(p);
    }
    if (!r.feature.trim()) errors.push(`route "${r.id}" has empty feature`);
    for (const [name, t] of Object.entries(r.transitions)) {
      try {
        routeById(t.to);
      } catch {
        errors.push(
          `route "${r.id}" transition "${name}" targets unknown route "${t.to}"`,
        );
      }
      if (!t.trigger.trim())
        errors.push(`route "${r.id}" transition "${name}" has empty trigger`);
    }
  }

  const { companionRoutes } = await import("../src/routes/companion-router");
  const { setAppVariant } = await import("../src/lib/app-variant");
  const { stageEntryRoute } = await import("../src/routes/route-kit");

  const companionIds = new Set(companionRoutes.map((r) => r.id));
  if (companionIds.size !== companionRoutes.length)
    errors.push("companion: duplicate route ids in registry");

  const companionPaths = new Set<string>();
  for (const r of companionRoutes) {
    for (const p of [r.path, ...(r.aliases ?? [])]) {
      if (companionPaths.has(p))
        errors.push(`companion: duplicate path "${p}" (route "${r.id}")`);
      companionPaths.add(p);
    }
  }

  setAppVariant("mobile");
  const testStages: AppStage[] = [
    { stage: "bootstrap" },
    { stage: "kalaidoscope_loading" },
    { stage: "no_kalaidoscopes_available" },
    { stage: "bootstrap_error" },
    { stage: "kalaidoscope_load_error" },
    { stage: "kalaidoscope_open", selectedKalaidoscopeId: "x" },
    { stage: "kalaidoscope_load_requested", loadKalaidoscopeId: "x" },
  ];
  for (const stage of testStages) {
    const enteredId = stageEntryRoute(stage);
    if (!companionIds.has(enteredId)) {
      errors.push(
        `companion: stage "${stage.stage}" enters "${enteredId}" which is not a companion route`,
      );
    }
  }

  if (errors.length) {
    console.error(
      `validate-routes FAILED:\n${errors.map((e) => `  - ${e}`).join("\n")}`,
    );
    process.exit(1);
  }
  console.log(
    `validate-routes OK — ${appRoutes.length} desktop routes, ${companionRoutes.length} companion routes, all transitions resolve.`,
  );
}

main();
