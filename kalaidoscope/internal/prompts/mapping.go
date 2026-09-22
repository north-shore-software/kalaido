package prompts

import (
	"encoding/json"
	"strings"
)

const MapJSONRetryNudge = "Your last reply could not be read as a single JSON object with the required keys. Reply again with only the JSON object: no code fences, no commentary."

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
