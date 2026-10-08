package objstore

import (
	"encoding/json"
	"strings"
)

// SystemProvider belongs to one request. A nil value means no answer, like
// undefined in Node's withSystem callback. It may call ABAP or yield: the
// store mutex is never held while consulting it.
type SystemProvider interface {
	System(kind, name, input string) (any, error)
}

// CallWithSystem passes request facts explicitly; nil preserves Call exactly.
func CallWithSystem(in map[string]*string, provider SystemProvider) Answer {
	text := func(k string) string {
		if in[k] != nil {
			return strings.TrimSpace(*in[k])
		}
		return ""
	}
	if provider == nil || strings.ToUpper(text("IV_COMMAND")) != "SYSTEM" {
		return Call(in)
	}
	kind := text("IV_TYPE")
	if kind == "" {
		var input struct {
			Kind string `json:"kind"`
		}
		_ = json.Unmarshal([]byte(text("IV_JSON")), &input)
		kind = input.Kind
	}
	kind = strings.ToUpper(kind)
	if !systemKinds[kind] {
		return Call(in)
	}
	a := storeEmpty()
	value, err := provider.System(kind, text("IV_NAME"), text("IV_JSON"))
	if err == nil && value == nil {
		a.Scalars["EV_ERROR"] = "SYSTEM " + kind + " has no answer here"
	} else if err != nil {
		a.Scalars["EV_ERROR"] = err.Error()
	}
	if a.Scalars["EV_ERROR"] == "" {
		if raw, ok := value.(map[string]any); ok {
			if source, ok := raw["raw"].(string); ok {
				a.Scalars["EV_SOURCE"] = source
				return a
			}
		}
		encoded, encodeErr := json.Marshal(value)
		if encodeErr == nil {
			a.Scalars["EV_JSON"] = string(encoded)
			return a
		}
		a.Scalars["EV_ERROR"] = encodeErr.Error()
	}
	code := "INTERNAL"
	if coded, ok := err.(interface{ Code() string }); ok && coded.Code() != "" {
		switch coded.Code() {
		case "NOT_FOUND", "CONFLICT", "READ_ONLY", "NOT_SUPPORTED", "INVALID_NAME", "INTERNAL":
			code = coded.Code()
		}
	}
	a.Scalars["EV_JSON"] = storeJSONRefusal(a.Scalars["EV_ERROR"], code)
	return a
}
