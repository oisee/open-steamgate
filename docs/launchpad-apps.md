# Applications and tiles in the launchpad

An OSD content pack registers its applications and launchpad entries in one
`osd-pack.json`. No central launchpad file has to learn the pack's name.

```text
packs/example/
  osd-pack.json
  webapp/
    index.html
    manifest.json
```

The smallest registration is:

```json
{
  "name": "example",
  "webapp": "webapp",
  "tiles": [{
    "id": "example-workbench",
    "title": "Example workbench",
    "subtitle": "Inspect and run examples",
    "icon": "sap-icon://wrench",
    "url": "/app/example/"
  }]
}
```

At startup OSD serves the directory at `/app/example/`, exposes the declared
tiles through `/app/packs.json`, and the sandbox FLP adds them to **Content
packs**. A direct `url` works for UI5 and non-UI5 pages. Use an intent such as
`#Travel-manage` only when the application is also declared in the shell's
`applications` configuration; a tile alone does not register an intent target.

## Availability

A capability may remain visible without pretending it can run:

```json
{
  "id": "hana-tool",
  "title": "HANA tool",
  "url": "/app/example/hana/",
  "requires": "HDB",
  "disabledReason": "needs HANA"
}
```

`requires: "HDB"` is checked against the same live SQLScript probe as the
AMDP sandbox. On ANYDB the target is removed, the native UI5 `Disabled` state
greys the tile, the footer is marked as an error, and `aria-disabled=true` is
set. `enabled: false` provides the same visible disabled form for a static
decision. A disabled tile is not hidden: it advertises the capability and
explains why it is unavailable.

## Tile kinds and live values

`type` accepts `static` (the default), `dynamic`, or `image`:

```json
{
  "tiles": [
    {
      "id": "live-count",
      "type": "dynamic",
      "title": "Open findings",
      "url": "/app/example/",
      "serviceUrl": "/sap/opu/odata/sap/ZEXAMPLE_SRV/TileSet('OPEN')",
      "serviceRefreshInterval": 60,
      "numberUnit": "items"
    },
    {
      "id": "poster",
      "type": "image",
      "imageSource": "/app/example/poster.png",
      "url": "/app/example/"
    }
  ]
}
```

OSD binds the response to UI5's native `NumericContent`. The service may
return a plain number (an OData `$count` is therefore enough), or JSON:

```json
{"number": 42, "numberUnit": "items", "numberState": "Good", "info": "live"}
```

Optional `numberState` and `infoState` use UI5 value colors; `stateArrow` may
be `Up`, `Down` or `None`, and `subtitle`/`info` may be refreshed too. Failed
requests show an error value without disabling navigation. Keep refresh
intervals conservative (OSD enforces at least ten seconds) and use live
numbers for small status aggregates, not for starting a benchmark or another
costly job. Application-internal KPI tiles, such as ZVDB Vector Quality,
remain `sap.m.GenericTile` controls owned by that application.

The built-in shell entries in `webapp/flp.html` use the same UI5 tile types.
Pack applications should prefer `osd-pack.json`; editing the shell is reserved
for applications that are part of OSD itself and need intent navigation.
