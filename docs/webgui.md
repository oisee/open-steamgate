# SAP Easy Access, served by ABAP

`/sap/bc/gui/sap/its/webgui/` — the classic entry screen of a SAP system, on
this one, drawn by `ZCL_OSD_WEBGUI` (`src/webgui/`) out of what the system
actually serves. Launchpad tile "SAP Easy Access"; `test/webgui.mjs` and
`test/e2e/webgui.spec.mjs` are the tests.


![SAP Easy Access on open-steamgate](images/webgui.png)

*(The capture above is `docs/images/webgui.png`. The screenshot run that made it
also writes `.local/webgui/easy-access.png` and `easy-access-open.png`, the
second with every folder unfolded; those stay untracked.)*

## The path is the point

`/sap/bc/gui/sap/its/webgui/` is where the real ITS webgui answers on a real
system: SAP GUI in a browser. Mounting our entry screen there is a deliberate
nod and not an accident of naming, and the class says so in a comment. It costs
nothing, because nothing of SAP's is mounted anywhere near it: the node is one
`*.sicf.xml` of ours (`src/webgui/zosd_webgui.sicf.xml`) pointing at one class
of ours, served by `cl_express_icf_shim` like every other ICF service in this
tree (`tools/osd-icf.mjs`, `packs/lsd` is the other worked example).

The screen is the classic one, and is meant to be recognised as such: the blue
title bar with the system on the right, the menu bar, the command field with
its green tick and the standard buttons beside it, the folder tree with the
disclosure triangles, the tall image panel down the right-hand side with the
bulge in its left edge, and the status bar at the bottom carrying the message.

Nothing on the page is scripted. The folders are `<details>`/`<summary>`, so
they fold without JavaScript; the command field is a GET form; a node is an
anchor. The one trap this tree has paid for twice — a page written from ABAP in
backtick literals gets no escapes — does not apply, because there is nothing to
escape.

## What is on it, and where it comes from

Nothing in the menu is typed out. Everything below the four fixed folders is
read, in ABAP, out of the five status tables of `src/status/`:

| folder | table | filled from |
| --- | --- | --- |
| Applications | `ZOSD_SVC` where `KIND = 'APP'` | each app's own `manifest.json` |
| Services / OData Services | `ZOSD_SVC` where `KIND = 'ODATA'` | the `*.iwsv.xml` / `*.iwmo.xml` registration objects |
| Services / ICF Services | `ZOSD_SVC` where `KIND = 'ICF'` | the `*.sicf.xml` nodes |
| Services / Push Channels | `ZOSD_SVC` where `KIND = 'APC'` | the `*.sapc.xml` applications |
| Content Packs | `ZOSD_PACK` | `osd-pack.json` in every pack |
| the title and status bars | `ZOSD_SYS` | the façade |

Those tables are the system-status inventory, and the façade fills them from
one snapshot (`tools/osd-status.mjs`, `ZCL_OSD_STATUS=>REFRESH`). Reading them
rather than walking the tree a second time is the whole design: a menu that can
disagree with the system status is a menu that is wrong somewhere, and there is
only one list to be wrong. A service added anywhere in the tree appears on the
screen with no change to `src/webgui/`, and `test/webgui.mjs` asserts exactly
that by calling `servicesOf()` and `packsInfo()` and looking for every row.

Two things were added to that inventory for this, and they belong to it rather
than to the menu:

- **`ZOSD_SVC-TEXT`**, the name a human calls a service. Every source already
  carried it — `<DESCRIPTION>` in an IWSV, `<ICF_DOCU>` in a SICF node,
  `<DESCRIPTION>` in a SAPC application — and `servicesOf()` was dropping it.
  It shows up as a "Name" column in the system status app too.
- **`KIND = 'APP'` rows**, one per UI5 application. An app is a folder with a
  `manifest.json` in it: `webapp/` itself, every folder below it, and any pack
  that brings a webapp. `sap.app.id` is the component that answers, `title` is
  what it is called, and the path is the launchpad with the app's **own**
  inbound intent from `crossNavigation.inbounds` — not the folder, because
  `webapp/booking` has no page of its own at all and is only ever reached
  through the launchpad.

Because the screen reads the status tables, it needs them to be fresh, and only
the façade can make them so. The refresh that `ZOSD_STATUS_SRV` already paid for
is registered for this path as well (`test/start.mjs`, and `STATUS_SERVICE` in
`web/preview-backend.mjs` for the browser deployment). It has to be registered
*before* the SICF mount, because that mount answers the request instead of
passing it on.

## A node has a kind

```
FOLDER       a branch, no target of its own
APP          a UI5 application, opened at the intent its manifest declares
SERVICE      an OData service, an ICF node, a push channel, a pack
TRANSACTION  something the system runs rather than something it links to
```

The kind is part of the model (`ZCL_OSD_WEBGUI=>GC_KIND`, carried into the HTML
as `data-kind`), not something the renderer guesses. `TRANSACTION` has exactly
one entry today, `ZABAPGIT`, and that entry answers *"not runnable yet"*. It is
there so the third kind exists before anything needs it: making a transaction
real is filling in one branch of `HANDLE_REQUEST`, not reshaping the screen.

This matters because of where this is going. abapGit should eventually arrive
as a transaction — you type its name and the system runs it — rather than as a
bespoke page with a URL of its own, because that is how a system works.

## The command field

The command field is the second way in, beside the tree, and it is resolved on
the **server**, against the same node list the tree is built from
(`ZCL_OSD_WEBGUI=>RESOLVE`), so the field and the tree can never send you to two
different places.

- `/n` and `/o` in front of a code are stripped the way SAP strips them, and the
  code is upper-cased and condensed.
- A node is matched first by its technical name (`ZSTG_DEMO_SRV`, `ZORK`,
  `STG.TRAVEL`), then by the name it is called by (`Travels`, `System status`),
  so both work.
- A match with a target answers `302` to that target. A match without one (a
  push channel has no page) comes back with the reason in the status bar.
- An unknown code comes back as `Transaction ZNOPE does not exist`, which is
  the message SAP puts in the status bar.
- A `TRANSACTION` node comes back saying it is not runnable yet.

The form is a GET, so the shim hands the query string on as it arrived and the
field is decoded in the handler: a browser sends a space as `+` and the rest
percent-encoded, and "System status" has a space in it.

## What a transaction node has to do when it is real

Today `RESOLVE` returns a node of kind `TRANSACTION` and `HANDLE_REQUEST`
answers with a message. A real one has four steps, and each of them is a thing
this tree can already nearly do:

1. **Find the object by name.** The object store knows every object of every
   layer (`tools/osd-store.mjs`, `zcl_osd_store`); a transaction code is not an
   object type we carry yet, so either a `*.tran.xml` joins the layers the way
   `*.sicf.xml` did, or the code maps to a report or a class by convention.
2. **Decide it is executable.** A `PROG` with a `START-OF-SELECTION`, or a class
   with `IF_OO_ADT_CLASSRUN` / a `MAIN`. `zcl_osd_store` already has the type
   and the source.
3. **Run it**, in a request of its own, with the screen's session around it.
   That is the part with no precedent here: a transaction is not a function
   call, it has a screen sequence, and the state has to live somewhere between
   two HTTP requests.
4. **Render what it draws through the GUI substitutes.** A program that runs
   builds controls; `cl_gui_control=>render_html` turns the controls that exist
   at the end of the step into markup, and the screen puts that where the tree
   is. The inbound leg — a click in that markup coming back as an ABAP event —
   is the piece that does not exist; see below.

## Where the GUI substitutes come from

[`open-abap-gui`](https://github.com/open-abap/open-abap-gui), wired in as a
**library** and not as a pack, because it is SAP-namespace shim code exactly
like `open-abap-core` and the pack/delta half of abapGit: it is the substrate a
program compiles against, not content this system serves.

- URL: our fork, `https://github.com/oisee/open-abap-gui`; folder
  `.local/lars/open-abap-gui`, both remotes at **`ed96e89`** ("update", #162).
- Declared in `abap_transpile.json` (libs) and `abaplint.jsonc` (dependencies).
- **Only `/src` comes in.** The repository also carries `/scaffold` — 162
  example programs and a dynpro host of its own — and `/test`, and neither
  belongs in this build.
- **Three files under `/scaffold` are the exception**, named one by one:
  `zcl_gg_context_menu_state`, `zcl_gg_host_html`, `host/zcl_gg_host_surface`.
  `/src` refers to them by name — `cl_ctmenu` and `cl_gui_toolbar` keep their
  items in the first, the tree and grid controls render through the third,
  which asks the second for a CSS class — so they are closure and not example.
  They would be library files upstream; naming them costs three lines and keeps
  the other 159 out.

**What it cost, measured before and after:** 1173 objects → 1474, so **+301**.
That is exactly `/src` plus the three: 117 classes, 16 interfaces, 11 type
pools, 73 structures, 50 table types, 31 data elements. Nothing from the
examples, nothing from the test tree. (`ZCL_OSD_WEBGUI` and its two test classes
took it to 1476.)

The screen uses the library for real rather than only compiling against it:
every piece of text on the page is escaped by `cl_gui_control=>escape_html`, so
the class that will escape abapGit's HTML escapes this screen today. A library
nothing calls is a library nobody notices has stopped building.

## How close the substitutes are to carrying abapGit

Honestly: **the outbound half is there and the inbound half is not.**

`cl_gui_html_viewer` is a real substitute, not a stub. It has `load_data`,
`show_data`, `show_url`, `close_document`, a document history behind
`go_back`/`go_forward`/`do_refresh`, and it declares `sapevent` with the full
five-parameter signature abapGit's handler is written against (`action`,
`frame`, `getdata`, `postdata`, `query_table`). `cl_gui_control` renders a
registered viewer into a sandboxed `<iframe srcdoc=...>` and rewrites every
`<a href="sapevent:ACTION">` in the document into a form that posts the
caller's hidden fields plus `ACTION` under a field the caller names. That
rewrite is careful in the ways that matter — it does not parse attributes it
does not need, it leaves ordinary links alone, it knows `<abbr>` starts with
`<a` too — and `src/webgui/zcl_osd_webgui.clas.testclasses.abap` drives it end
to end in ABAP Unit, on a synthetic anchor, as part of `npm run unit`.

What is missing is the return leg. **Nothing in the library ever raises
`sapevent`.** `grep -rn "RAISE EVENT" src/ scaffold/` finds the event raised for
toolbars, timers, ALV grids, trees and DD elements, and never for the HTML
viewer. The one example that registers a handler,
`scaffold/examples/zcl_gg_ex_151`, therefore has a handler that can never fire.
The scaffold host does not use the event either: it points the rewrite at its
own `/dispatch` with `action_field = 'ucomm'` and folds the click into the same
`gg_action` command dispatch every other control posts to. That is a reasonable
design for the scaffold's own dynpro host; it is not the SAP contract, and
abapGit is written against the SAP contract.

So for abapGit's UI the gap is narrow and specific: something has to take the
POST the rewritten form produces and raise `sapevent` on the viewer object with
`action` and `postdata` filled the way SAP fills them (`postdata` as the body's
lines, `query_table` as the parsed fields), so that `SET HANDLER ... FOR EVENT
sapevent OF cl_gui_html_viewer` runs. That is one class and one test, not a
track.

The rest of what abapGit touches looks better than I expected. There are 31
`todo, implement method` stubs in `/src` and no `ASSERT 1 = 'todo'` at all, and
the stubs cluster almost entirely in the SALV form-layout classes
(`cl_salv_form_*`, 20 of the 31) — not in the container, viewer or
frontend-services path abapGit's UI actually walks. `cl_gui_custom_container`,
`cl_gui_dialogbox_container`, `cl_gui_docking_container`,
`cl_gui_splitter_container` and `cl_gui_frontend_services` are all implemented
rather than declared. Whether abapGit *runs* is of course a different and much
larger question than whether its screen draws — it wants DDIC serializers, a
transport layer and a hundred SAP APIs this tree does not have — but the GUI
layer is not the thing that will stop it.

## Out of scope, deliberately

**Running abapGit itself through the GUI substitutes is not part of this**, and
was not started. It is the obvious next step and it needs one thing proven
first, which is the next step's first task:

> **Prove that a click comes back.** Take abapGit's own HTML — not a synthetic
> anchor — put it through `cl_gui_html_viewer=>load_data` with `sapevent`
> registered, render it, post one of the resulting forms back, and show that
> `sapevent` reaches a handler with the action and the post data intact.

Not "wire up abapGit". One round trip, against real abapGit markup, with the
missing raise written and tested. Everything after that is a question of which
SAP APIs are missing, and that is a closure audit, not a screen.

## Tests

```
npx mocha test/webgui.mjs                       # the path, the tree, the command field
npx playwright test test/e2e/webgui.spec.mjs    # it renders, a node navigates, the field works
npm run unit                                    # ZCL_OSD_WEBGUI: the ok-codes, and the sapevent rewrite
```

`test/webgui.mjs` is in `npm run integration`. The browser test does not assert
a status code: it opens folders, reads a node, clicks it and follows where it
goes, then types names into the command field.
