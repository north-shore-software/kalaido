package engine

const (
	windowTumbling = "tumbling"
	windowSliding  = "sliding"
)

type Config struct {
	CadencePeriodSecs  int64    `json:"cadence_period_secs"`  // regeneration frequency
	WindowMode         string   `json:"window_mode"`          // tumbling | sliding
	WindowLookbackSecs int64    `json:"window_lookback_secs"` // data window length
	FragmentTypes      []string `json:"fragment_types"`       // empty = all types
	ColourIDs          []string `json:"colour_ids"`           // colour filters; empty = none
	Anchor             string   `json:"anchor,omitempty"`     // RFC3339; else created
}
