# AMDP, cut out and run in a real HANA

Backlog B.19. The idea is Alice's and it is the whole reason the track is
cheap: **an AMDP body is already valid SQLScript.** So we do not transpile it.
We cut it out of the ABAP class, wrap it in a `CREATE PROCEDURE`, and let a
real HANA execute it.

That sidesteps the thing that would have made this expensive. Measured on A4H
on 2026-09-18: of the 195 classes implementing `IF_AMDP_MARKER_HDB`, the three
customer ones are ours, and one of them — `ZCL_Z80_00_CPU_AMDP` — is a Z80
processor written as four SQLScript procedures, with eighteen `DECLARE`s,
thirty-six `SELECT`s and three loops in a single method. Interpreting that
would mean writing an engine for a second language. Handing it to HANA costs
a connection.

**The HANA is HANA Express in docker on the i7, and deliberately not the A4H
one**: that database is the sandbox the oracle work depends on, and our schema
has no business in it.

## The two halves

`tools/amdp-extract.mjs` — the scissors.

```
node tools/amdp-extract.mjs <class.clas.abap> [--types <file>]... [--procedure]
```

It finds every method declared `BY DATABASE PROCEDURE FOR HDB`, takes the body
**by source position** and the signature from the parsed class definition.

Two things in there are not obvious and both were measured rather than assumed:

- **The body comes out by position, not by concatenating tokens.** abaplint
  parses an AMDP body as a run of `NativeSQL` statements, and their
  concatenated tokens do not reproduce the source — they overlap. The body is
  therefore the text between the end of the `MethodImplementation` statement
  and the start of its `ENDMETHOD`.
- **Parameter types are read off the definition line.** abaplint's parsed
  class definition gives each parameter its name and direction but not its
  type, because a type needs a resolved registry with the DDIC in it, which a
  class read off a system does not have. The parameter's own token carries its
  row, so the type text is taken from that line.

Types a signature uses often live somewhere else — the Z80 CPU keeps its in
`ZIF_Z80_00_AMDP_TYPES` — so `--types <file>` contributes another object's
`TYPES`, and the class's own win a name they share. A table type becomes a
HANA `TABLE(...)` column by column; an unknown type comes back `undefined`
rather than guessed, so the caller refuses instead of generating a procedure
that will not compile.

`tools/amdp-run.mjs` — the other half.

```
node tools/amdp-run.mjs <class.clas.abap> <method> [--types <f>]... [--in name=json]...
```

It connects with the npm driver `hdb`, creates the schema if it is absent,
replaces the procedure and calls it. The connection comes from `HXE_HOST` /
`HXE_PORT` / `HXE_USER` / `HXE_PASSWORD`, or from `.local/hxe-password`, which
is where the laboratory's password lives and which is not tracked.

## The laboratory

`~/hxe/run.sh` starts it. The data is in a bind mount rather than the
container's writable layer, which is the lesson `~/dev/a4h/CLAUDE.md` paid for
twice: the database then survives `docker rm` and Portainer's Recreate, and
overlay2 does not copy a multi-gigabyte file in full on first write.

Ports 39013 (SYSTEMDB), 39017 (tenant) and the instance's own ranges. None of
them collide with 30213/30215, which are the A4H instance forwarded from i5,
nor with 3030, which is the showcase.

## What is not solved yet

- **Where the data is.** A body that selects from a table needs that table to
  exist in HANA with our rows. `ZCL_VSP_00_AMDP_TEST` does not — it computes
  from `DUMMY` — which is why it is the first specimen. Everything past it
  needs either mirroring the tables a procedure touches, or a copy of the
  schema in HXE.
- **How the call reaches it from transpiled ABAP.** Today the runner is a
  command. Making a transpiled `CALL METHOD` land in HANA is the next seam.
- **What the real framework generates.** SAP's AMDP framework turns a method
  into a HANA procedure with a naming and a wrapper of its own, and ours is
  currently a guess informed by the method signature. Reading a generated
  procedure out of A4H's catalogue is the way to check our shape against the
  original, and it is read-only.
