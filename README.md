<p align="center">
    <img src="app/src/assets/brand/kalaido-wordmark.png" alt="Kalaido" width="520">
</p>

<p align="center"><strong>From chaos, create.</strong></p>

Kalaido is a local-first desktop app that helps you synthesize chaotic inputs — notes, transcripts, articles, brain dumps — into something new. Snapshots, recursive dependencies, and an interactive reconciliation process work with you to keep your output up to date, even as the world shifts beneath you.

It runs a React/Tauri front end over an embedded Go sidecar, and works entirely offline against a local Ollama model. A cloud service with more powerful models is also available.

## Quick Start

### Prerequisites

- Node.js `>=22.13.0` and pnpm `>=11`
- Go `1.24.1+`
- Rust & Cargo (Tauri v2 desktop build)
- Apple Silicon macOS — `kalaido.sh` builds the sidecar as `GOOS=darwin GOARCH=arm64`
- Ollama serving `gemma4` (`ollama pull gemma4`)

Install dependencies for all three toolchains, then verify your setup:

```bash
./kalaido.sh setup
./kalaido.sh doctor
```

### Local Development

Run the full app (Tauri front end + Go sidecar, rebuilt first):

```bash
./kalaido.sh dev
```

### UI/UX Development

Component workbench on `:61000`:

```bash
./kalaido.sh ladle
```

### Verification & Formatting

```bash
./kalaido.sh check:all   # ts (biome, nav, routes, build) + go (vet, gofmt, tidy) + rust (fmt, clippy)
./kalaido.sh fmt:ts      # biome format --write; also fmt:go (gofmt -w) and fmt:rust (cargo fmt)
```

### Build Production Binary

```bash
./kalaido.sh build:app       # tauri build (rebuilds the sidecar first)
./kalaido.sh build:sidecar   # sidecar only
```

Run `./kalaido.sh` with no arguments for the full command list.

## Repository Structure

| Path            | Description                                                                              |
| --------------- | ---------------------------------------------------------------------------------------- |
| `app/`          | Desktop front end — Tauri v2, React 19, Vite, Tailwind CSS v4, Biome                       |
| `kalaidoscope/` | Embedded Go sidecar (`cmd/sidecar`) — PocketBase engine, migrations, LLM router            |
| `kalaido.sh`    | Dev CLI: setup, dev, checks, formatting, builds, doctor                                    |

Database types in `app/src/api/kalaidoscope/types.ts` are generated from the Go migrations — run `./kalaido.sh gen:types` after changing a migration, and `./kalaido.sh check:schema-freshness` to confirm they match.

## License

Copyright (C) 2026 North Shore Software Ltd.

Kalaido is licensed under AGPL-3.0-only — see [LICENSE](LICENSE) and [NOTICE](NOTICE).

Contributions require a signed Contributor License Agreement.
