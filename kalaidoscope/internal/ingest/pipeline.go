package ingest

// startPipeline runs the organise pipeline after an import: a full map
// cycle, then every discover flow once the map has settled.
func startPipeline(deps Deps) {
	deps.Mapping.AfterDrain(func(err error) {
		if err != nil {
			return
		}
		deps.Discover.Signal("colours")
		deps.Discover.Signal("projections")
		deps.Discover.Signal("reflections")
	})
	deps.Mapping.Signal()
}
