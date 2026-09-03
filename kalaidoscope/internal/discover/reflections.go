package discover

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// reflectionsFlow proposes reflections: colour scopes with a rhythm. The
// evidence is computed, not asked for (rhythm.go); the model reads it, judges
// which rhythms are a nameable recurring activity, and proposes each with a
// cadence from a fixed vocabulary and the date it started. Go builds the
// schedule, so a proposal can never carry an unparseable period, and the first
// version is effective from the onset: opening and committing the proposal
// backfills the series from there, exactly as "summarize from <date>" does.
type reflectionsFlow struct{}

func (reflectionsFlow) Kind() string   { return "reflections" }
func (reflectionsFlow) System() string { return prompts.DiscoverReflectionsSystem }

func (reflectionsFlow) Initial(c *Context) string {
	return prompts.DiscoverReflectionsInitial(c.Doc, c.coloursBlock(), c.rhythmsBlock(rhythmGrainMonth, nil))
}

// cadencePeriods is the fixed cadence vocabulary the model may use, mapped to
// the grid period. Go's time.ParseDuration has no day unit, so hours.
var cadencePeriods = map[string]string{
	"daily":     "24h",
	"weekly":    "168h",
	"monthly":   "720h",
	"quarterly": "2160h",
}

func cadenceNames() []string {
	return []string{"daily", "weekly", "monthly", "quarterly"}
}

var rhythmsTool = llm.Tool{
	Name:        prompts.RhythmsToolName,
	Description: prompts.RhythmsToolDescription,
	Parameters: json.RawMessage(`{"type":"object","properties":{` +
		`"grain":{"type":"string","enum":["week","month"],"description":` + strconv.Quote(prompts.RhythmsGrainParamDescription) + `},` +
		`"colourIds":` + stringArray(prompts.RhythmsColourIDsParamDescription) +
		`},"required":["grain"]}`),
}

var proposeReflectionTool = llm.Tool{
	Name:        prompts.ProposeReflectionToolName,
	Description: prompts.ProposeReflectionToolDescription,
	Parameters: json.RawMessage(`{"type":"object","properties":{` +
		`"name":{"type":"string","description":` + strconv.Quote(prompts.ProposeReflectionNameParamDescription) + `},` +
		`"message":{"type":"string","description":` + strconv.Quote(prompts.ProposeReflectionMessageParamDescription) + `},` +
		`"colourIds":` + stringArray(prompts.ProposeColourIDsParamDescription) + `,` +
		`"cadence":{"type":"string","enum":["daily","weekly","monthly","quarterly"],"description":` + strconv.Quote(prompts.ProposeCadenceParamDescription) + `},` +
		`"startTime":{"type":"string","description":` + strconv.Quote(prompts.ProposeStartTimeParamDescription) + `}` +
		`},"required":["name","message","colourIds","cadence","startTime"]}`),
}

func (reflectionsFlow) Tools(c *Context) []llm.Tool {
	return []llm.Tool{readColourTool, rhythmsTool, proposeReflectionTool}
}

func (reflectionsFlow) Existing(c *Context) ([]Existing, error) {
	return existingEntities(c)
}

func (reflectionsFlow) Coverage(c *Context, existing []Existing) string {
	return c.colourCoverage(existing)
}

type rhythmsArgs struct {
	Grain     string   `json:"grain"`
	ColourIDs []string `json:"colourIds"`
}

type proposeReflectionArgs struct {
	Name      string   `json:"name"`
	Message   string   `json:"message"`
	ColourIDs []string `json:"colourIds"`
	Cadence   string   `json:"cadence"`
	StartTime string   `json:"startTime"`
}

func (f reflectionsFlow) Dispatch(ctx context.Context, c *Context, call llm.ToolCall) (string, *Output, error) {
	switch call.Name {
	case prompts.RhythmsToolName:
		return f.rhythms(c, call), nil, nil
	case prompts.ProposeReflectionToolName:
		return f.propose(c, call, time.Now())
	default:
		return prompts.DiscoverRejected(prompts.DiscoverUnknownTool(call.Name)), nil, nil
	}
}

func (reflectionsFlow) rhythms(c *Context, call llm.ToolCall) string {
	var args rhythmsArgs
	if err := json.Unmarshal(call.Args, &args); err != nil {
		return prompts.DiscoverRejected(prompts.DiscoverBadArgs)
	}
	var only map[string]bool
	if len(args.ColourIDs) > 0 {
		ids, reject := c.resolveColours(args.ColourIDs)
		if reject != "" {
			return prompts.DiscoverRejected(reject)
		}
		only = map[string]bool{}
		for _, id := range ids {
			only[id] = true
		}
	}
	return c.rhythmsBlock(strings.ToLower(strings.TrimSpace(args.Grain)), only)
}

func (reflectionsFlow) propose(c *Context, call llm.ToolCall, now time.Time) (string, *Output, error) {
	var args proposeReflectionArgs
	if err := json.Unmarshal(call.Args, &args); err != nil {
		return prompts.DiscoverRejected(prompts.DiscoverBadArgs), nil, nil
	}
	args.Name = strings.TrimSpace(args.Name)
	args.Message = strings.TrimSpace(args.Message)
	if args.Name == "" || args.Message == "" {
		return prompts.DiscoverRejected(prompts.DiscoverNameAndMessageRequired), nil, nil
	}
	spec, start, reject := buildReflectionSpec(args.Cadence, args.StartTime, now)
	if reject != "" {
		return prompts.DiscoverRejected(reject), nil, nil
	}
	colourIDs, reject := c.resolveColours(args.ColourIDs)
	if reject != "" {
		return prompts.DiscoverRejected(reject), nil, nil
	}
	if len(colourIDs) == 0 {
		return prompts.DiscoverRejected(prompts.DiscoverReflectionScopeRequired), nil, nil
	}
	for _, id := range colourIDs {
		if c.ubiquitousColour(id) {
			return prompts.DiscoverRejected(prompts.DiscoverUbiquitousColour(c.colourByRef(id).Name, id)), nil, nil
		}
	}
	contextSpec := api.ContextSpec{ColourIDs: colourIDs}
	versions := engine.AppendWindowSpecVersion(nil, spec, start)
	rec, err := insertProposed(c, "reflection", args.Name, args.Message, contextSpec, map[string]any{
		"window_spec_versions": pbutil.JSONObject(versions),
	})
	if err != nil {
		return "", nil, err
	}
	members := c.fragmentIDsForColours(colourIDs)
	c.markCovered(members)
	out := &Output{Kind: "reflection", ID: rec.Id, Name: args.Name, Status: engine.EntityProposed}
	return prompts.DiscoverProposedReflection(args.Name, rec.Id, len(members), args.Cadence, start.Format("2006-01-02")), out, nil
}

// buildReflectionSpec turns the model's cadence word and start date into the
// grid spec. The start is floored to midnight UTC and becomes the grid origin;
// the run summarizes one period each time (duration = period). Returns the
// rejection text when the input cannot become a schedule.
func buildReflectionSpec(cadence, startTime string, now time.Time) (api.WindowSpec, time.Time, string) {
	period, ok := cadencePeriods[strings.ToLower(strings.TrimSpace(cadence))]
	if !ok {
		return api.WindowSpec{}, time.Time{}, prompts.DiscoverUnknownCadence(cadence, cadenceNames())
	}
	start, ok := parseStartDate(startTime)
	if !ok {
		return api.WindowSpec{}, time.Time{}, prompts.DiscoverBadStartTime(startTime)
	}
	if start.After(now) {
		return api.WindowSpec{}, time.Time{}, prompts.DiscoverStartInFuture(start.Format("2006-01-02"))
	}
	p, _ := time.ParseDuration(period)
	if windows := int(now.Sub(start) / p); windows > engine.MaxGridWindows {
		return api.WindowSpec{}, time.Time{}, prompts.DiscoverTooManyWindows(windows, engine.MaxGridWindows)
	}
	spec := api.WindowSpec{
		StartTime: start.Format(time.RFC3339),
		Period:    period,
		Duration:  period,
	}
	return spec, start, ""
}

func parseStartDate(s string) (time.Time, bool) {
	s = strings.TrimSpace(s)
	for _, layout := range []string{"2006-01-02", time.RFC3339, "2006-01"} {
		if t, err := time.Parse(layout, s); err == nil {
			return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC), true
		}
	}
	return time.Time{}, false
}
