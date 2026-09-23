package schema

// Collection is a canonical collection's name, typed so a query cannot
// silently name a table that does not exist. Every value here must match a
// TableDef in Canonical; the test in constants_test.go enforces it.
type Collection string

const (
	ColFragment             Collection = "fragment"
	ColIngest               Collection = "ingest"
	ColColour               Collection = "colour"
	ColColourFragment       Collection = "colour_fragment"
	ColProjection           Collection = "projection"
	ColReflection           Collection = "reflection"
	ColLens                 Collection = "lens"
	ColProjectionSnapshot   Collection = "projection_snapshot"
	ColReflectionSnapshot   Collection = "reflection_snapshot"
	ColReflectionWindow     Collection = "reflection_window"
	ColProjectionRefinement Collection = "projection_refinement"
	ColReflectionRefinement Collection = "reflection_refinement"
	ColChatConversation     Collection = "chat_conversation"
	ColChatMessage          Collection = "chat_message"
	ColUsage                Collection = "usage"
	ColMapRun               Collection = "map_run"
	ColDiscoverRun          Collection = "discover_run"
	ColFragmentAnnotation   Collection = "fragment_annotation"
	ColKalaidoscopeMap      Collection = "kalaidoscope_map"
	ColLLMQueueStatus       Collection = "llm_queue_status"
	ColKalaidoscopeConfig   Collection = "kalaidoscope_config"
)

// String lets a Collection be passed where PocketBase wants a plain name.
func (c Collection) String() string { return string(c) }

// colour_fragment.match_type values. One row per (colour, fragment); when a
// pair could carry several reasons the higher one wins, in this order.
const (
	MatchManualNegative = "manual_negative"
	MatchManualPositive = "manual_positive"
	MatchThing          = "thing"
	MatchPrompt         = "prompt"
)

// NotDeleted is the filter clause selecting live rows of a soft-deleting
// collection. Soft-deleted rows carry a timestamp in deleted_at; live rows
// carry the empty string, never NULL, so this is the whole test.
func NotDeleted() string { return "deleted_at = ''" }
