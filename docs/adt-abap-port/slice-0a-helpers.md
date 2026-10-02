# Slice 0a: ABAP helpers

These helpers add no route rows. VERSIONS uses URI and ENTITY, SYSINFO uses
JSON, and SESSION uses USER. The existing HTTP diffs guard these extractions.
The STORE contract and front changes belong to slice 0b and F1/F2.

- URI encodes UTF-8 bytes with upper-case hex. DECODE_COMPONENT reports failure
  without raising; DECODE_SEGMENT retains Express's 400 refusal. QUERY takes
  raw query text, joins repeated scalar names with commas, decodes plus as
  space, and keeps failed percent decoding literal, like qs. It distinguishes
  absence from an empty value. The front's query record remains F2's work.
- ENTITY hashes the UTF-8 representation. NORMALIZED is the single If-Match
  rule; SEND splits If-None-Match into candidates. Callers supply the bare
  content type: SEND adds the charset, and a 304 keeps the type the 200 would
  have had (Node's `sendEntity` sets the type before `status(304).end()`,
  which keeps it; only Express's `send()` strips it on a 304).
  VERSIONS feeds explicitly disable the 200 charset: Node sends their bodies
  as Buffers, so their existing wire type is bare on both 200 and 304.
- TYPES contains the 15 Node TYPES rows in insertion order. SOURCES and
  LOCKABLE are derived. ADT_TYPE also handles STRU, which has no TYPES row.
  OBJECT_FROM_URI returns FOUND and OK separately: an unknown collection and
  a malformed encoded name are different outcomes. Callers choose the refusal.
- JSON appends object members in call order. QUOTE matches JSON.stringify for
  C0 controls and raw non-ASCII text. ADD_RAW accepts already serialized JSON.
- JS conversions expose NaN and Infinity separately from finite numbers.
  JS_INT accepts an optional radix (zero means JavaScript's default). GLOB
  treats only star as special and compares case sensitively. COLLATE keys are
  for ASCII repository identifiers, including punctuation and case ties;
  lists already ordered by the host are never re-sorted by ABAP. It is not
  a replacement for a general Unicode ICU collator.
- SCAN retains the Node patterns' raw captures, double quotes, case sensitivity
  and ASCII word boundaries. It does not parse or unescape XML. REFERENCES
  retains malformed-name OK flags so each route can choose its own refusal.
- CHECKREPORT and DOC_COMMON retain optional-field presence independently of
  empty strings. EMPTY_FEED takes a caller-supplied timestamp and retains the
  Node feed's unescaped identity fields.
- USER quotes the Basic header user, upper case, with a caller-supplied fallback.
  It does not authenticate credentials. SESSION supplies the identity fallback.

`node tools/adt-helper-fixtures.mjs` runs the Node document builders and writes
both `test/fixtures/adt-helpers/documents.json` and the two ABAP Unit includes.
`--check` rejects stale output. The mocha helper suite checks the complete type
catalog and other helpers directly against Node, including V8 localeCompare
on the local repository names. Every helper also has ABAP Unit coverage.
- SCAN's REFERENCES appends a row with `found = abap_true` and `ok = abap_false`
  (empty name) where Node's decode throws a URIError. Every caller checks `ok`
  before using the name.
- URI's QUERY matches qs for scalar keys only; `a[]=x` and `a[0]=x` are not
  parsed as arrays.
