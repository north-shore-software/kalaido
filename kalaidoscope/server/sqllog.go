package server

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"regexp"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// registerWriteEcho logs every SQL statement that changes persistent state.
// It replaces PocketBase's --dev firehose (which echoes every read too) for
// normal dev runs: reads are silent, and churn tables are excluded. Launch the
// sidecar with --dev (KALAIDO_PB_DEV=1 in the Tauri wrapper) to get the full
// unfiltered echo back — in that mode this hook installs nothing.
func registerWriteEcho(app core.App) {
	app.OnBootstrap().BindFunc(func(e *core.BootstrapEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		if app.IsDev() {
			return nil
		}
		for _, b := range []dbx.Builder{app.DB(), app.NonconcurrentDB()} {
			if db, ok := b.(*dbx.DB); ok {
				db.ExecLogFunc = echoWrite
			}
		}
		return nil
	})
}

// The queue status row is rewritten several times a second while anything
// runs; it is ephemeral coordination state, not user data.
var writeEchoSkip = map[string]bool{
	"llm_queue_status": true,
}

// Statements that change rows, and the table they touch. Reads go through
// QueryLogFunc (left nil) and never reach here; DDL is deliberately unmatched.
var writeVerb = regexp.MustCompile("(?i)^\\s*(?:INSERT INTO|UPDATE|DELETE FROM)\\s+[`\"']?([A-Za-z0-9_]+)")

const writeEchoMaxRunes = 500

func echoWrite(_ context.Context, _ time.Duration, sqlStr string, _ sql.Result, err error) {
	m := writeVerb.FindStringSubmatch(sqlStr)
	if m == nil {
		return
	}
	table := m[1]
	// Underscore tables are PocketBase internals (_migrations, _params, …).
	if writeEchoSkip[table] || strings.HasPrefix(table, "_") {
		return
	}
	line := strings.Join(strings.Fields(sqlStr), " ")
	if r := []rune(line); len(r) > writeEchoMaxRunes {
		line = string(r[:writeEchoMaxRunes]) + fmt.Sprintf("… (+%d chars)", len(r)-writeEchoMaxRunes)
	}
	if err != nil {
		log.Printf("db: %s — FAILED: %v", line, err)
		return
	}
	log.Printf("db: %s", line)
}
