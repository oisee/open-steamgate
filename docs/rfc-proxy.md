# Proxy caller: CALL FUNCTION without DESTINATION

`tools/rfc-proxy.mjs`, spike P1. A `CALL FUNCTION 'X'` with no `DESTINATION`
whose module is **not transpiled** here may be forwarded to a destination,
recorded, and replayed later without the system. It is opt-in: without
`STG_RFC_PROXY` nothing changes and the call dumps with
`CX_SY_DYN_CALL_ILLEGAL_FUNC` as before.

## How

The transpiler emits the same two lines for static and dynamic calls: an
`abap.FunctionModules[NAME] === undefined` check (the dump), then
`await abap.FunctionModules[NAME]({exporting, importing, tables, changing})`.
`installFunctionProxy(abap, {destination, allow, mode})` replaces the table
with a Proxy over the original. A defined name is returned untouched; an
undefined name matching `allow` (exact names or `PREFIX*`) is a forwarder to
the client `clientFor` builds for the destination, so live, record and replay
use the one client and the one capture format of `docs/rfc-channel.md` /
`tools/rfc-replay.mjs`; any other name stays `undefined`.

A call without DESTINATION has no EXCEPTIONS map in its parameters (the caller
catches a classic error and switches on its name), so the forwarder gives the
client a `raise(key)` that throws one; a captured or live classic exception
reaches the caller's `EXCEPTIONS name = n` as `sy-subrc`.

## Using it

    STG_RFC_PROXY=<destination>            turns it on
    STG_RFC_PROXY_ALLOW=Z_FOO,BAPI_FLIGHT_*  names that may be forwarded
    STG_RFC_PROXY_MODE=live|record|replay  default: the destination's entry in
                                           .local/rfc-destinations.json, else replay
    STG_RFC_CAPTURE=<folder>               capture folder (<folder>/<FM>/<n>.json)
    STG_RFC_NO_LIVE=1                      (or CI=true) live and record fall back
                                           to replay

`test/setup.mjs` wires it, Node only (the preview never installs it). With
`noLive` and no capture the forwarder throws, naming the module and the
capture path; it never answers empty.

## Seeing what was proxied

`proxyJournal()` returns `[{name, source, destination}]`, `source` being
`live`, `record` or `replay`; a transpiled module never appears in it.

## Local-ness

Anything asking "is this module transpiled" must not see the Proxy, or
`RfcFallbackClient` would take the forwarder for a local module. Use
`isLocal(name)` / `localFunctionModules()` from `tools/rfc-replay.mjs`; both
read the table the proxy wrapped (`localClient` and `RfcFallbackClient` do).

## Not proxied

A remote call carries parameters and results only. It does not carry
authority checks (they run on the other system, as its user), `COMMIT WORK`
(the remote LUW belongs to the remote system), ABAP memory (`EXPORT TO
MEMORY`), or enqueue locks. A module that depends on any of these needs a
transpiled replacement, not a proxy.

Tests: `test/rfc-proxy.mjs`, captures in `test/fixtures/rfc/Z_PROXY_PROBE_FM/`, probe class in `test/fixtures/rfc-proxy/` (synthetic).
