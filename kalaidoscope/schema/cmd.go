// UNREVIEWED
package schema

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/spf13/cobra"
)

// RegisterCommand adds the `schema` console command:
//
//	schema bootstrap --dir D   create or upgrade D's database, print its status, exit
//	schema status --dir D      print D's status without changing it
//	schema retry --dir D       clear a failed marker, then upgrade as bootstrap does
//
// PocketBase bootstraps — and so runs the lifecycle — before any command
// executes, which is why the two variants that must act differently are
// recognised from the argument list at Install time (modeFromArgs).
func RegisterCommand(root *cobra.Command) {
	printStatus := func(*cobra.Command, []string) error {
		b, err := json.MarshalIndent(lastStatus, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(b))
		return nil
	}
	cmd := &cobra.Command{Use: "schema", Short: "Inspect or upgrade the database schema"}
	cmd.AddCommand(
		&cobra.Command{Use: "bootstrap", Short: "Create or upgrade the database, then exit", RunE: printStatus},
		&cobra.Command{Use: "status", Short: "Report the database's schema version without changing it", RunE: printStatus},
		&cobra.Command{Use: "retry", Short: "Clear a failed-migration marker and upgrade", RunE: printStatus},
	)
	root.AddCommand(cmd)
}

func modeFromArgs(args []string) mode {
	if len(args) >= 3 && args[1] == "schema" {
		switch args[2] {
		case "status":
			return modeInspect
		case "retry":
			return modeRetry
		}
	}
	return modeNormal
}

func nowUTC() time.Time { return time.Now().UTC() }
