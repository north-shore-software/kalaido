package llm

import (
	"fmt"
	"log/slog"
	"sort"
	"strings"
)

func logger() *slog.Logger {
	return slog.Default().With("component", "llm")
}

// Trace switches on logging of every provider request body, user content
// included, so a rejected call can be reproduced verbatim from the sidecar
// log. The binary sets it from KALAIDO_LLM_TRACE at boot (the Tauri shell
// forwards KALAIDO_* variables, so `KALAIDO_LLM_TRACE=1 ./kalaido.sh dev`
// is enough). Off by default — the log would otherwise carry every document
// of every context on every call.
var Trace bool

// Shape summarises a call without its content: message count per role with
// the characters each role carries, how many messages are empty, the tools
// advertised and the temperature. It is written on every failure, so a log
// alone can tell an empty part, a runaway system prompt or an unexpected tool
// set apart from a fault on the provider's side.
func Shape(msgs []Message, tools []Tool, opts GenOptions) string {
	count := map[string]int{}
	chars := map[string]int{}
	empty := 0
	for _, m := range msgs {
		count[m.Role]++
		chars[m.Role] += len(m.Content)
		if strings.TrimSpace(m.Content) == "" {
			empty++
		}
	}
	roles := make([]string, 0, len(count))
	for r := range count {
		roles = append(roles, r)
	}
	sort.Strings(roles)
	var sb strings.Builder
	fmt.Fprintf(&sb, "messages=%d (", len(msgs))
	for i, r := range roles {
		if i > 0 {
			sb.WriteString(", ")
		}
		fmt.Fprintf(&sb, "%s:%d/%dch", r, count[r], chars[r])
	}
	fmt.Fprintf(&sb, ") empty=%d", empty)
	names := make([]string, 0, len(tools))
	for _, t := range tools {
		names = append(names, t.Name)
	}
	fmt.Fprintf(&sb, " tools=%v", names)
	if opts.Temperature != nil {
		fmt.Fprintf(&sb, " temp=%g", *opts.Temperature)
	} else {
		sb.WriteString(" temp=default")
	}
	return sb.String()
}

// LogRequest writes the full request body a provider is about to send, when
// Trace is on. url is the endpoint without credentials.
func LogRequest(provider ProviderID, model, url string, body []byte) {
	if !Trace {
		return
	}
	logger().Info("trace request", "provider", provider, "model", model, "url", url, "body", string(body))
}

// LogFailure records a provider call that did not yield a stream: the HTTP
// status (0 when no response came back), the call's Shape, any
// provider-specific detail, and the response body. Always written — this is
// the line that makes a failure diagnosable from the log after the fact.
func LogFailure(provider ProviderID, model string, status int, shape, detail, body string) {
	where := "no response"
	if status != 0 {
		where = fmt.Sprintf("HTTP %d", status)
	}
	logger().Error("request failed", "provider", provider, "status", where, "model", model,
		"shape", shape, "detail", detail, "body", strings.TrimSpace(body))
}
