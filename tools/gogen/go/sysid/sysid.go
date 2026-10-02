// Package sysid is the system id of an OSGo host, by the rule the Node
// hosts apply in tools/osd-identity.mjs: one setting, OSD_SID, with
// STG_ADT_SID as an alias of the same meaning, and Default when neither is
// set. sy-sysid, the status service's Sid and every other surface take it
// from here, so they cannot disagree.
package sysid

import "strings"

// Default is the system id when no setting names one: the product.
const Default = "OSD"

// Settings are the names asked, in order: the setting, then its alias.
var Settings = []string{"OSD_SID", "STG_ADT_SID"}

// FromEnv returns the system id and the setting that gave it ("OSD_SID",
// "STG_ADT_SID") or "default". An empty or blank value counts as unset;
// the id is upper case and at most three characters, as on a real system.
func FromEnv(lookup func(string) (string, bool)) (sid, source string) {
	for _, name := range Settings {
		value, _ := lookup(name)
		value = strings.ToUpper(strings.TrimSpace(value))
		if value == "" {
			continue
		}
		if len(value) > 3 {
			value = value[:3]
		}
		return value, name
	}
	return Default, "default"
}

// Describe is how a log line or a doctor says where the id came from:
// "default" or "setting OSD_SID".
func Describe(source string) string {
	if source == "default" {
		return source
	}
	return "setting " + source
}
