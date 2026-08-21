package prompts

import (
	"encoding/json"
	"fmt"
	"strings"
)

const MapSchemaDescription = `The map is a single JSON object with this exact shape:
{
  "dimensions": [{"name": string, "description": string, "themes": [{"name": string, "description": string, "aliases": [string], "fragments": number, "exemplar_ids": [string], "first_seen": string, "last_seen": string}]}],
  "entities": [{"name": string, "kind": string, "notes": string}],
  "relationships": [{"from": string, "to": string, "kind": string}],
  "narrative": string
}

A "dimension" is one independent axis along which the workspace's fragments vary — for example, what kind of activity a fragment represents, versus what tool or vendor it concerns, versus which external relationship it belongs to. Two fragments can share a theme on one dimension while differing completely on another. Illustrative, non-exhaustive examples of dimensions: what kind of activity this is; what tool, product, or subject matter is involved; which external relationship (client, partner, contact) it belongs to. The actual dimensions must be discovered from the material at hand, not assumed — a workspace's real axes of variation may be nothing like these examples. Most workspaces settle around 3-8 dimensions: don't spin up a new one for a single passing distinction, but don't force unrelated material onto one that doesn't truly fit either.

A "theme" belongs to exactly one dimension and must be a single coherent point on that dimension — broad enough to cover many fragments, specific enough to mean something. If a theme's description needs "and" to join two unrelated concerns, it is actually two themes: split it, filing each under whichever dimension it truly belongs to (the same one, or a new one). Never fold a fragment onto an existing theme just because it loosely fits — check every existing dimension against new material, and if it shows a pattern of variation no current dimension captures, add a new dimension with its own themes, in addition to (never instead of) the existing ones. Most fragments touch more than one dimension at once and should end up tagged in each dimension that plausibly applies to them, not just whichever single theme fits best overall.

Within each theme: "fragments" counts how many fragments have touched it so far, "exemplar_ids" lists up to 5 representative fragment IDs, and "first_seen"/"last_seen" are the earliest and latest event dates that touched it. "entities" are the recurring people, organisations, places, and projects. "kind" is one of "person", "organisation", "place", "project", or "other". "relationships" connect two theme or entity names with a short "kind" such as "part of", "works on", or "related". "narrative" is your own running account of what this workspace is about and how it is developing over time.`

const emptyMapNotice = "The map is empty so far: this is the first material ever added to the workspace."

func mapStateBlock(mapBody string) string {
	if strings.TrimSpace(mapBody) == "" || mapBody == "{}" || mapBody == "null" {
		return emptyMapNotice
	}
	return "Current map:\n" + mapBody
}

func MapMarkupPrompt(mapBody, fragmentBlock string) string {
	return `You are annotating one fragment from a user's personal workspace so it can be folded into the workspace map: a living index of the workspace's themes (grouped into dimensions — independent axes like what kind of activity, what tool/subject, which relationship), entities, and story.

` + mapStateBlock(mapBody) + `

Fragment:
` + fragmentBlock + `
Write a JSON object with exactly these keys:
{"summary": string, "themes": [{"theme": string, "dimension": string}], "entities": [string]}

- "summary": if the fragment is long, a dense summary of its content in at most 150 words; if it is short, a one-sentence reading of what it is about and why it likely exists.
- "themes": one entry per dimension in the current map that plausibly applies to this fragment — most fragments touch more than one dimension, so check them all rather than stopping at the first one that feels sufficient. For each, prefer the exact "name" of an existing theme within that dimension; propose a new short theme name, and the dimension it belongs to (an existing dimension's name, or a new one), only when nothing in the map covers it.
- "entities": the people, organisations, places, or projects the fragment mentions, using existing map entity names where they match.

Reply with only the JSON object.`
}

func MapIncorporatePrompt(mapBody, inputBlock string) string {
	return `You maintain the map of a user's personal workspace: a living index of its themes, entities, relationships, and story.

` + MapSchemaDescription + `

` + mapStateBlock(mapBody) + `

New material, in event-time order:
` + inputBlock + `
Update the map to incorporate the new material:
- Only add and refine. Never drop a dimension, theme, or entity that earlier material still supports; fold spelling and naming variants into "aliases" instead of creating near-duplicate themes.
- Keep themes at a useful grain: broad enough that each covers a meaningful share of the workspace, specific enough to mean something, and never a fusion of two unrelated concerns (split those into separate themes instead).
- Check the new material against every existing dimension, not just the one that first comes to mind. If it shows a pattern of variation no current dimension captures, add a new dimension with its own themes alongside the existing ones — don't force it onto a dimension it doesn't truly belong to.
- Update "fragments" counts, "exemplar_ids" (keep the most representative, at most 5), and "first_seen"/"last_seen" dates.
- Keep "narrative" a concise account of the whole space and how it has developed. Rewrite it freely, but keep it under 300 words.
- If an annotation is too thin to place confidently, call expand_fragment with that fragment's ID to read its full text before deciding.

Reply with only the complete updated map JSON object.`
}

func AnnotationBlock(fragType, id, eventTime, annotation string) string {
	return fmt.Sprintf("--- annotation of %s fragment (ID: %s, event time: %s) ---\n%s\n\n", fragType, id, eventTime, annotation)
}

const (
	ExpandFragmentToolName         = "expand_fragment"
	ExpandFragmentToolDescription  = "Fetch the full text of one fragment from the new material when its annotation is not enough to update the map confidently."
	ExpandFragmentParamDescription = "The fragment ID to expand, exactly as it appears in the material."
)

func MapExpandEcho(ids []string) string {
	return fmt.Sprintf("[You called %s for: %s]", ExpandFragmentToolName, strings.Join(ids, ", "))
}

func MapExpandResult(fragmentsBlock string) string {
	return `Full text of the requested fragments:

` + fragmentsBlock + `
Continue: reply with only the complete updated map JSON object.`
}

const MapExpandBudgetExhausted = "No further fragments can be expanded. Reply with only the complete updated map JSON object."

const MapExpandNotFound = "(no such fragments)\n\n"

const MapJSONRetryNudge = "Your last reply could not be read as a single JSON object with the required keys. Reply again with only the JSON object: no code fences, no commentary."

func ParseMarkupReply(text string) (json.RawMessage, bool) {
	return extractJSONObject(text, "themes")
}

func ParseMapReply(text string) (json.RawMessage, bool) {
	return extractJSONObject(text, "dimensions")
}

func extractJSONObject(text, requiredKey string) (json.RawMessage, bool) {
	start := strings.Index(text, "{")
	end := strings.LastIndex(text, "}")
	if start < 0 || end <= start {
		return nil, false
	}
	raw := json.RawMessage(text[start : end+1])
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(raw, &obj); err != nil {
		return nil, false
	}
	if _, ok := obj[requiredKey]; !ok {
		return nil, false
	}
	return raw, true
}
