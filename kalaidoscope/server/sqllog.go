package server

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// registerWriteEcho logs every SQL statement that changes persistent state (excluding to llm_queue_status).
// It is an alternative to PocketBase's --dev logging, which is too verbose most of the time (echoes every read, no tables excluded).
func registerWriteEcho(app core.App) {
	app.OnBootstrap().BindFunc(func(e *core.BootstrapEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		if app.IsDev() {
			return nil
		}
		log := logger(app)
		execLogger := func(ctx context.Context, d time.Duration, sqlStr string, res sql.Result, err error) {
			echoWrite(log, ctx, d, sqlStr, res, err)
		}
		for _, b := range []dbx.Builder{app.DB(), app.NonconcurrentDB()} {
			if db, ok := b.(*dbx.DB); ok {
				db.ExecLogFunc = execLogger
			}
		}
		return nil
	})
}

// Don't log writes to these tables.
var writeEchoSkip = map[string]bool{
	// The queue status row is rewritten several times a second while anything
	// runs; it is ephemeral coordination state, not user data.
	"llm_queue_status": true,
}

// Statements that change rows, and the table they touch. Reads go through
// QueryLogFunc (left nil) and never reach here; DDL is deliberately unmatched.
var writeVerb = regexp.MustCompile("(?i)^\\s*(?:INSERT INTO|UPDATE|DELETE FROM)\\s+[`\"']?([A-Za-z0-9_]+)")

const writeEchoMaxRunes = 500

func echoWrite(log *slog.Logger, _ context.Context, _ time.Duration, sqlStr string, _ sql.Result, err error) {
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
		log.Error("db write failed", "sql", line, "error", err)
		return
	}
	log.Debug("db write", "sql", line)
}
