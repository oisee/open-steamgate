// Package sysid is the system id of an OSGo host, by the rule the Node
// hosts apply in tools/osd-identity.mjs: one setting, OSD_SID, with
// STG_ADT_SID as an alias of the same meaning, and Default when neither is
// set. sy-sysid, the status service's Sid and every other surface take it
// from here, so they cannot disagree.
package sysid

import (
	"fmt"
	"os"
	"strings"
)

// Default is the system id when no setting names one: the product.
const Default = "OSD"

// Settings are the names asked, in order: the setting, then its alias.
var Settings = []string{"OSD_SID", "STG_ADT_SID"}

// valid is SAP's format: exactly three characters, A-Z or 0-9, the first a
// letter (either case; the id is upper-cased). Bytes, so nothing outside
// ASCII can pass.
func valid(s string) bool {
	if len(s) != 3 {
		return false
	}
	for i := 0; i < 3; i++ {
		c := s[i]
		letter := c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z'
		if !letter && (i == 0 || c < '0' || c > '9') {
			return false
		}
	}
	return true
}

// FromEnv returns the system id and the setting that gave it ("OSD_SID",
// "STG_ADT_SID") or "default". A blank value (ASCII blanks only, as on
// Node) counts as unset; a value that is not a system id is an error, never
// truncated or skipped.
func FromEnv(lookup func(string) (string, bool)) (sid, source string, err error) {
	for _, name := range Settings {
		raw, _ := lookup(name)
		value := strings.Trim(raw, " \t\r\n")
		if value == "" {
			continue
		}
		if !valid(value) {
			return "", name, fmt.Errorf("%s=%q is not a system id: exactly three characters, A-Z or 0-9, the first a letter", name, raw)
		}
		return strings.ToUpper(value), name, nil
	}
	return Default, "default", nil
}

// Must is FromEnv for a program's start: an invalid setting refuses it.
func Must(lookup func(string) (string, bool)) (sid, source string) {
	sid, source, err := FromEnv(lookup)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	return sid, source
}

// Describe is how a log line or a doctor says where the id came from:
// "default" or "setting OSD_SID".
func Describe(source string) string {
	if source == "default" {
		return source
	}
	return "setting " + source
}
