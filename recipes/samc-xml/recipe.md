# SAMC XML

The sample renders byte-identical with abapGit's own serialisation captured on A4H (`docs/probes/abap-daemons/zosd_t_amc.serialized.samc.xml`). The template starts with the UTF-8 BOM abapGit writes and lays the file out one element per line; the model builder sorts channels by CHANNEL_ID, as abapGit does.

Each authority has a `program` and may specify `kind`: `class` (default), `report`, or `function_group`. A class produces its padded `CP` program ID, a report uses its name, and a function group uses `SAPL` plus its group name. An explicit `program_id` must equal that computed ID. Channels require nonempty `scope` and `messageType` values.
