package agent

import (
	"encoding/json"
	"strconv"

	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

func IDTool(name, description, param, paramDescription string) llm.Tool {
	return llm.Tool{
		Name:        name,
		Description: description,
		Parameters: json.RawMessage(`{"type":"object","properties":{"` + param + `":{"type":"string","description":` +
			strconv.Quote(paramDescription) + `}},"required":["` + param + `"]}`),
	}
}

func IDsTool(name, description, paramDescription string) llm.Tool {
	return llm.Tool{
		Name:        name,
		Description: description,
		Parameters: json.RawMessage(`{"type":"object","properties":{"ids":{"type":"array","items":{"type":"string"},"description":` +
			strconv.Quote(paramDescription) + `}},"required":["ids"]}`),
	}
}

func EmptyTool(name, description string) llm.Tool {
	return llm.Tool{Name: name, Description: description, Parameters: json.RawMessage(`{"type":"object","properties":{}}`)}
}

func StringArraySchema(description string) string {
	return `{"type":"array","items":{"type":"string"},"description":` + strconv.Quote(description) + `}`
}
