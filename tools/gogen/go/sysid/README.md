# sysid

The system id of an OSGo host, by the same rule as the Node hosts
(`tools/osd-identity.mjs`): the setting `OSD_SID`, its alias `STG_ADT_SID`
(same meaning, `OSD_SID` wins), else `Default` (`OSD`).

API: `FromEnv(lookup) (sid, source, err)` with `os.LookupEnv` as the lookup;
`source` is the setting's name or `"default"`. `Must(lookup)` is the same for
a program's start and exits 2 on an invalid setting. `Describe(source)` is
the wording a log line uses ("default", "setting OSD_SID").

Invariants: SAP's format, exactly three characters, A-Z or 0-9, the first a
letter; lower case is upper-cased; only ASCII blanks are trimmed; a blank
value is unset; anything else is an error, never truncated.
`testdata/cases.json` is the one list of cases, read by this package's test
and by `test/osd-identity.mjs`. `cmd/osgo` and `cmd/osabap` set `abap.SysID`
from it at start, so sy-sysid and the status service's Sid are the same id.
