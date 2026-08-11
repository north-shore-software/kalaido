#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$ROOT/app"
KS="$ROOT/kalaidoscope"
TAURI="$APP/src-tauri"
SCHEMA_ROOT="$ROOT/.schema"
SCHEMA_DATA="$SCHEMA_ROOT/pb_data"
SIDECAR_DEST="$TAURI/binaries/pocketbase-aarch64-apple-darwin"
TYPES_OUT="src/api/kalaidoscope/types.ts"

# Cloud endpoints the app talks to. Vite picks these up from the environment and
# they take precedence over any .env file, so setting KALAIDO_AUTH_URL /
# KALAIDO_CLOUD_PB_URL before invoking this script points a dev build or a
# release build at a different stack without touching the tree. The defaults are
# production; the app carries the same defaults in code, so building without this
# script still produces a working binary.
export VITE_BETTER_AUTH_URL="${KALAIDO_AUTH_URL:-https://auth.kalaido.co}"
export VITE_CLOUD_PB_URL="${KALAIDO_CLOUD_PB_URL:-https://s.kalaido.co}"

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

build_schema_db() {
  rm -rf "$SCHEMA_ROOT"
  mkdir -p "$SCHEMA_DATA"
  (cd "$KS" && go run ./cmd/sidecar migrate up --dir "$SCHEMA_DATA")
}

cmd_dev() {
  cmd_build_sidecar
  say "tauri dev"
  (cd "$APP" && pnpm tauri dev "$@")
}

cmd_ladle() {
  say "ladle serve"
  (cd "$APP" && pnpm ladle "$@")
}

cmd_gen_types() {
  say "schema db"
  build_schema_db
  say "pocketbase-typegen"
  (cd "$APP" && pnpm exec pocketbase-typegen --db "$SCHEMA_DATA/data.db" --out "$TYPES_OUT")
  echo "wrote app/$TYPES_OUT"
}

read_version() {
  awk -F'"' '/^  "version": / { print $4; exit }' "$TAURI/tauri.conf.json"
}

edit_inplace() {
  local file="$1"; shift
  local tmp
  tmp="$(mktemp)"
  "$@" "$file" > "$tmp"
  cat "$tmp" > "$file"
  rm -f "$tmp"
}

cmd_bump() {
  local current default new f
  current="$(read_version)"
  [[ -n "$current" ]] || die "no version in app/src-tauri/tauri.conf.json"

  if [[ "$current" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
    default="${BASH_REMATCH[1]}.${BASH_REMATCH[2]}.$((BASH_REMATCH[3] + 1))"
    read -r -p "new version [$default]: " new
    new="${new:-$default}"
  else
    read -r -p "new version (current $current): " new
  fi

  [[ "$new" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || die "not a version: $new"
  [[ "$new" != "$current" ]] || die "already at $current"

  for f in "$TAURI/tauri.conf.json" "$APP/package.json"; do
    edit_inplace "$f" sed '1,/^  "version": /s/^\(  "version": \)"[^"]*"/\1"'"$new"'"/'
  done
  edit_inplace "$TAURI/Cargo.toml" sed '1,/^version = /s/^version = "[^"]*"/version = "'"$new"'"/'
  edit_inplace "$TAURI/Cargo.lock" awk -v v="$new" '
    /^name = "Kalaido"$/ { armed = 1 }
    armed && /^version = / { $0 = "version = \"" v "\""; armed = 0 }
    { print }
  '

  say "$current -> $new"
  echo "updated app/src-tauri/tauri.conf.json app/package.json app/src-tauri/Cargo.toml app/src-tauri/Cargo.lock"
}

cmd_build_sidecar() {
  say "build sidecar"
  mkdir -p "$(dirname "$SIDECAR_DEST")"
  (cd "$KS" && GOOS=darwin GOARCH=arm64 go build -o "$SIDECAR_DEST" ./cmd/sidecar)
  echo "wrote ${SIDECAR_DEST#"$ROOT"/}"
}

cmd_build_app() {
  cmd_build_sidecar
  say "tauri build"
  (cd "$APP" && pnpm tauri build "$@")
}

cmd_build_ladle() {
  say "ladle build"
  (cd "$APP" && pnpm ladle:build "$@")
}

cmd_check_ts() {
  say "biome format"
  (cd "$APP" && pnpm exec biome format .)
  say "biome lint"
  (cd "$APP" && pnpm exec biome lint --error-on-warnings .)
  say "navigation discipline"
  (cd "$APP" && pnpm check:nav)
  say "routes"
  (cd "$APP" && pnpm check:routes)
  say "build"
  (cd "$APP" && pnpm build)
}

cmd_check_ts_typecheck_only() {
  say "tsc --noEmit"
  (cd "$APP" && pnpm exec tsc --noEmit)
}

cmd_check_go() {
  say "go vet"
  (cd "$KS" && go vet ./...)
  say "gofmt"
  local unformatted
  unformatted="$(cd "$KS" && gofmt -l .)"
  if [[ -n "$unformatted" ]]; then
    echo "$unformatted" >&2
    printf '\033[31merror:\033[0m %s\n' "unformatted go files (run ./kalaido.sh fmt:go)" >&2
    return 1
  fi
  say "go mod tidy"
  (cd "$KS" && go mod tidy -diff)
}

cmd_check_rust() {
  say "cargo fmt"
  (cd "$TAURI" && cargo fmt --check)
  say "cargo clippy"
  (cd "$TAURI" && cargo clippy --all-targets -- -D warnings)
}

cmd_test_rust() {
  say "cargo test"
  (cd "$TAURI" && cargo test)
}

cmd_test_ts() {
  say "pnpm test run"
  (cd "$APP" && pnpm test run)
}

cmd_check_all() {
  local failed="" target
  for target in ts go rust; do
    "cmd_check_$target" || failed="$failed check:$target"
  done
  echo
  if [[ -n "$failed" ]]; then
    printf '\033[31mFAILED:\033[0m%s\n' "$failed"
    exit 1
  fi
  printf '\033[32mall checks passed\033[0m\n'
}

cmd_check_schema_freshness() {
  say "schema db"
  build_schema_db
  local tmp="$SCHEMA_ROOT/types.ts"
  say "pocketbase-typegen"
  (cd "$APP" && pnpm exec pocketbase-typegen --db "$SCHEMA_DATA/data.db" --out "$tmp")
  if ! diff -u "$APP/$TYPES_OUT" "$tmp"; then
    die "app/$TYPES_OUT is stale (run ./kalaido.sh gen:types)"
  fi
  echo "app/$TYPES_OUT is up to date"
}

cmd_fmt_ts() {
  say "biome format --write"
  (cd "$APP" && pnpm exec biome format --write .)
}

cmd_fmt_go() {
  say "gofmt -w"
  (cd "$KS" && gofmt -w .)
}

cmd_fmt_rust() {
  say "cargo fmt"
  (cd "$TAURI" && cargo fmt)
}

cmd_setup_ts() {
  say "pnpm install"
  (cd "$APP" && pnpm install --frozen-lockfile)
}

cmd_setup_go() {
  say "go mod download"
  (cd "$KS" && go mod download)
}

cmd_setup_rust() {
  say "cargo fetch"
  (cd "$TAURI" && cargo fetch)
}

cmd_setup() {
  cmd_setup_ts
  cmd_setup_go
  cmd_setup_rust
}

cmd_clean() {
  say "clean"
  rm -rf "$APP/dist" "$APP/build" "$TAURI/binaries" "$SCHEMA_ROOT"
  echo "removed app/dist app/build app/src-tauri/binaries .schema"
}

cmd_clean_tauri() {
  cmd_clean
  say "clean:tauri"
  rm -rf "$TAURI/target"
  echo "removed app/src-tauri/target"
}

cmd_clean_npm() {
  cmd_clean_tauri
  say "clean:npm"
  rm -rf "$APP/node_modules"
  echo "removed app/node_modules (run ./kalaido.sh setup)"
}

have() { command -v "$1" >/dev/null 2>&1; }

engine_ok() {
  node -e '
const range = require("./package.json").engines[process.argv[1]];
const parse = (s) => { const m = s.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/); return m ? [+m[1], +(m[2]||0), +(m[3]||0)] : null; };
const cmp = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
const v = parse(process.argv[2]);
const ok = range.split("||").map((s) => s.trim()).some((s) => {
  const t = parse(s);
  if (!v || !t) return false;
  if (s.startsWith("^")) return cmp(v, t) >= 0 && v[0] === t[0];
  return cmp(v, t) >= 0;
});
process.exit(ok ? 0 : 1);
' "$1" "$2"
}

report() {
  local status="$1" label="$2" detail="${3:-}"
  case "$status" in
    ok) printf '  \033[32mok\033[0m    %-24s %s\n' "$label" "$detail" ;;
    warn) printf '  \033[33mwarn\033[0m  %-24s %s\n' "$label" "$detail" ;;
    fail) printf '  \033[31mfail\033[0m  %-24s %s\n' "$label" "$detail" ;;
  esac
}

cmd_doctor() {
  local failed=0

  say "toolchain"

  if have go; then
    local gov
    gov="$(go version | awk '{print $3}' | sed 's/^go//')"
    if [[ "$(printf '1.24.1\n%s\n' "$gov" | sort -V | head -1)" == "1.24.1" ]]; then
      report ok go "$gov"
    else
      report fail go "$gov (need >= 1.24.1)"
      failed=1
    fi
  else
    report fail go "not found"
    failed=1
  fi

  if have node; then
    local nodev range
    nodev="$(node --version)"
    range="$(cd "$APP" && node -p 'require("./package.json").engines.node')"
    if (cd "$APP" && engine_ok node "$nodev"); then
      report ok node "$nodev"
    else
      report fail node "$nodev (need $range)"
      failed=1
    fi
  else
    report fail node "not found"
    failed=1
  fi

  if have pnpm; then
    local pnpmv range
    pnpmv="$(pnpm --version 2>/dev/null || true)"
    if [[ -z "$pnpmv" ]]; then
      report fail pnpm "installed but not runnable"
      failed=1
    elif ! have node; then
      report warn pnpm "$pnpmv (cannot check engines without node)"
    elif (cd "$APP" && engine_ok pnpm "$pnpmv"); then
      report ok pnpm "$pnpmv"
    else
      range="$(cd "$APP" && node -p 'require("./package.json").engines.pnpm')"
      report fail pnpm "$pnpmv (need $range)"
      failed=1
    fi
  else
    report fail pnpm "not found"
    failed=1
  fi

  if have cargo; then
    report ok cargo "$(cargo --version 2>/dev/null | awk '{print $2}')"
  else
    report fail cargo "not found"
    failed=1
  fi

  if [[ -x "$APP/node_modules/.bin/tauri" ]]; then
    local tauriv
    tauriv="$("$APP/node_modules/.bin/tauri" --version 2>/dev/null | tail -1 || true)"
    if [[ -n "$tauriv" ]]; then
      report ok "tauri cli" "$tauriv"
    else
      report fail "tauri cli" "installed but not runnable"
      failed=1
    fi
  else
    report fail "tauri cli" "not installed (run ./kalaido.sh setup)"
    failed=1
  fi

  say "providers"

  if [[ -n "${GEMINI_API_KEY:-}" ]]; then
    report ok GEMINI_API_KEY "set"
  else
    report warn GEMINI_API_KEY "unset (cloud model set will fail)"
  fi

  local ollama="${OLLAMA_HOST:-http://localhost:11434}"
  if curl -fsS --max-time 2 "$ollama/api/version" >/dev/null 2>&1; then
    report ok ollama "$ollama"
  else
    report warn ollama "$ollama unreachable (local model set will fail)"
  fi

  echo
  if (( failed )); then
    printf '\033[31mdoctor found problems\033[0m\n'
    exit 1
  fi
  printf '\033[32mtoolchain ok\033[0m\n'
}

usage() {
  cat <<'EOF'
usage: ./kalaido.sh <command> [args...]

  dev                        tauri dev (rebuilds the sidecar first)
  ladle                      component workbench on :61000

  gen:types                  rebuild the schema db, regenerate types.ts
  bump                       set the app version (prompts, defaults to a patch bump)

  build:sidecar              build the go sidecar into src-tauri/binaries
  build:app                  tauri build (rebuilds the sidecar first)
  build:ladle                build the component workbench

  check:ts                   biome, nav, routes, build
  check:ts-typecheck-only    tsc --noEmit
  check:go                   vet, gofmt, go mod tidy
  check:rust                 cargo fmt, clippy
  check:all                  ts + go + rust
  check:schema-freshness     types.ts matches the migrations

  test:rust                  cargo test
  test:ts                    pnpm test run

  fmt:ts                     biome format --write
  fmt:go                     gofmt -w
  fmt:rust                   cargo fmt

  setup                      install js, go and rust dependencies
  setup:ts                   pnpm install --frozen-lockfile
  setup:go                   go mod download
  setup:rust                 cargo fetch
  clean                      dist, build, binaries, .schema
  clean:tauri                clean + src-tauri/target
  clean:npm                  clean:tauri + node_modules
  doctor                     check the toolchain and providers
EOF
}

case "${1:-}" in
  dev) shift; cmd_dev "$@" ;;
  ladle) shift; cmd_ladle "$@" ;;
  gen:types) shift; cmd_gen_types "$@" ;;
  bump) shift; cmd_bump "$@" ;;
  build:sidecar) shift; cmd_build_sidecar "$@" ;;
  build:app) shift; cmd_build_app "$@" ;;
  build:ladle) shift; cmd_build_ladle "$@" ;;
  check:ts) shift; cmd_check_ts "$@" ;;
  check:ts-typecheck-only) shift; cmd_check_ts_typecheck_only "$@" ;;
  check:go) shift; cmd_check_go "$@" ;;
  check:rust) shift; cmd_check_rust "$@" ;;
  check:all) shift; cmd_check_all "$@" ;;
  check:schema-freshness) shift; cmd_check_schema_freshness "$@" ;;
  test:rust) shift; cmd_test_rust "$@" ;;
  test:ts) shift; cmd_test_ts "$@" ;;
  fmt:ts) shift; cmd_fmt_ts "$@" ;;
  fmt:go) shift; cmd_fmt_go "$@" ;;
  fmt:rust) shift; cmd_fmt_rust "$@" ;;
  setup) shift; cmd_setup "$@" ;;
  setup:ts) shift; cmd_setup_ts "$@" ;;
  setup:go) shift; cmd_setup_go "$@" ;;
  setup:rust) shift; cmd_setup_rust "$@" ;;
  clean) shift; cmd_clean "$@" ;;
  clean:tauri) shift; cmd_clean_tauri "$@" ;;
  clean:npm) shift; cmd_clean_npm "$@" ;;
  doctor) shift; cmd_doctor "$@" ;;
  ""|-h|--help|help) usage ;;
  *) usage >&2; die "unknown command: $1" ;;
esac
