# SAMC XML

The sample renders byte-identical with the deserialize input abapGit accepted on A4H; abapGit's own pretty-printed serialisation is a follow-up. The template preserves that input's layout.

Each authority has a `program` and may specify `kind`: `class` (default), `report`, or `function_group`. A class produces its padded `CP` program ID, a report uses its name, and a function group uses `SAPL` plus its group name. An explicit `program_id` must equal that computed ID. Channels require nonempty `scope` and `messageType` values.
