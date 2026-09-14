---
title: "server package tests flake: mapping worker goroutine panics after the test app is torn down"
status: "open"
author: "agent"
created: "2026-09-10"
---

## Description
`server.NewWithConfig` calls `mapping.Register`, which starts `go loop()` and `go aggregateLoop()` immediately (`internal/mapping/worker.go:56-59`). Tests in `server/` build an app that way and reset it at cleanup, but the goroutines outlive the test and can touch the closed database, panicking the whole test binary. Seen once in about a dozen runs of `go test ./server/`; the failure names `internal/mapping/worker.go:58` in the goroutine's creation frame.

## Steps to Reproduce
1. `cd kalaidoscope && for i in $(seq 20); do CGO_ENABLED=0 go test -count=1 ./server/; done`
2. Occasionally one run ends in `panic` with a goroutine trace through `worker.go:58` and `FAIL ... server`.

## Expected Behavior
Worker goroutines are started from an `OnServe` hook (or `Register` takes a context tied to the app's lifetime), so a test that never serves never starts them and teardown cannot race them.

## Observed Behavior
Intermittent panic and `FAIL` for the `server` package with no test of its own failing. Seen while testing the schema-migrations change, but the mechanism (goroutines started at construction, not at serve) predates it; the panic did not reproduce in ten further runs on either tree, so it is a race, not a deterministic failure.
