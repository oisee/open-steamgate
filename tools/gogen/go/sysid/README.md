# sysid

The system id of an OSGo host, by the same rule as the Node hosts
(`tools/osd-identity.mjs`): the setting `OSD_SID`, its alias `STG_ADT_SID`
(same meaning, `OSD_SID` wins), else `Default` (`OSD`).

API: `FromEnv(lookup) (sid, source)` with `os.LookupEnv` as the lookup;
`source` is the setting's name or `"default"`. `Describe(source)` is the
wording a log line uses ("default", "setting OSD_SID").

Invariants: a blank value counts as unset; the id is upper case and at most
three characters. `cmd/osgo` and `cmd/osabap` set `abap.SysID` from it at
start, so sy-sysid and the status service's Sid are the same id.
