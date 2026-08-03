import "./dom-prelude";

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

  if (errors.length) {
    console.error(
      `validate-routes FAILED:\n${errors.map((e) => `  - ${e}`).join("\n")}`,
    );
    process.exit(1);
  }
  console.log(
    `validate-routes OK — ${appRoutes.length} routes, all transitions resolve.`,
  );
}

main();
