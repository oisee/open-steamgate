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
  `.local/lars/open-abap-gui`. Upstream `main` is at **`ed96e89`** ("update",
  #162); the folder is on the fork branch **`html-viewer-sapevent`** at
  **`0324e1c`** (two commits on top of `ed96e89`: the `sapevent` raise, and
  `show_url` showing what `load_data` loaded), which is what the preview
  workflow pins (`OSD_GUI_REF`) and what "How close" below describes.
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

**Both halves are there now** (2026-09-18, backlog G.2). What follows is what
each half is, and where the seam between them runs.

`cl_gui_html_viewer` is a real substitute, not a stub. It has `load_data`,
`show_data`, `show_url`, `close_document`, a document history behind
`go_back`/`go_forward`/`do_refresh`, and it declares `sapevent` with the full
five-parameter signature abapGit's handler is written against (`action`,
`frame`, `getdata`, `postdata`, `query_table`), the last two on the `CNHT`
types SAP declares them with. `cl_gui_control` renders a registered viewer
into a sandboxed `<iframe srcdoc=...>` and rewrites what the document would
send to SAP GUI into forms that post to a transport the caller names
(`ty_sapevent`: a url, the name of the field that carries the action, hidden
fields of the caller's own):

- `<a href="sapevent:ACTION">` becomes a form whose submit button carries
  `ACTION` under the action field, as before;
- `<form action="sapevent:ACTION">` and a submit button's
  `formaction="sapevent:ACTION"` — which is how abapGit's forms are written
  (`zcl_abapgit_html_form=>render`) — are pointed at the transport with the
  action in the url's query string, so the body stays exactly the document's
  own fields;
- every rewritten form carries a hidden `gg_control` naming the viewer it
  belongs to, and forms posting somewhere else are left alone.

The return leg is `cl_gui_html_viewer=>dispatch_sapevent`: whoever answers the
transport's url hands it the query string, the body and the same transport; it
finds the viewer by `gg_control`, strips the transport's fields, and raises
`sapevent` on that viewer, so `SET HANDLER ... FOR EVENT sapevent OF
cl_gui_html_viewer` runs. The parameters are filled the way the frontend
fills them, **measured against the consumer rather than the frontend**,
because the frontend was not available and the consumer is strict
(`zcl_abapgit_gui_event`, which is the only reader abapGit has):

- `action` is the url before `?`, as written (abapGit lower-cases it);
- `getdata` is the text after `?`, untouched — abapGit undoes the escapes it
  expects there itself (`%3A %3F %3D %2F %23 %25 %26`);
- `postdata` is the form's `name=value` pairs joined with `&`, in lines of
  256 characters filled to the end, the last line carrying the rest, the
  text as typed with only `%`, `&` and `=` escaped. abapGit redeclares the
  table with 256-character lines and converts line by line
  (`zcl_abapgit_html_viewer_gui=>on_event`), joins the lines `RESPECTING
  BLANKS` except the last, and undoes exactly those escapes; a wider fill
  would lose the tail of every long form in abapGit, and it does not lose it
  on real systems. The line width SAP GUI itself fills is the one number
  nobody has measured; it is one constant (`c_post_data_chunk`);
- `query_table` is the same parsed, unless the viewer was constructed with
  `query_table_disabled`, which abapGit does.

The library's own tests drive both halves on a synthetic page
(`cl_gui_html_viewer.clas.testclasses.abap`, `ltcl_sapevent`, five tests:
an anchor with a query, abapGit's form shape with a side action, the line
fill, an unknown viewer, a foreign form), and its browser spec of the HTML
viewer example (`zcl_gg_ex_151`) still passes through the scaffold host,
which keeps folding the click into its own `gg_action` dispatch and ignores
the extra hidden field. `src/webgui/zcl_osd_webgui.clas.testclasses.abap`
keeps the original synthetic-anchor probe as part of `npm run unit`.

One more thing the real flow found: abapGit shows a page by `load_data`
without a url, which assigns one, then `show_url` of the assigned url
(`zcl_abapgit_gui=>cache_asset`, `render`). The substitute overwrote the
document with the url's text at that second step, so the frame read
`abapgit.html`. It now keeps what `load_data` loaded under the url it got
and resolves `show_url` and `show_data` from that
(`ANOMALY-2026-09-18-html-viewer-show-url`).

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

## The click comes back: proven, and against what

The round trip was proven 2026-09-18 at
`/sap/bc/gui/sap/its/webgui/sapevent/` (`src/webgui/zcl_osd_sapevent`, a
proof harness that says so in its header, and the seed of what a transaction
node needs: controls drawn into a page, the click coming back as an event).
`test/sapevent.mjs` plays the browser by hand and `test/e2e/sapevent.spec.mjs`
lets Chromium click inside the sandboxed frame; both end in the JSON the
harness answers a POST with, which is what abapGit's event class made of the
click.

What is real on that path, and what is not, because the distinction is the
proof:

| piece | status |
| --- | --- |
| `zcl_abapgit_html_viewer_gui`, abapGit's wrapper of `cl_gui_html_viewer`, constructed as abapGit constructs it, re-raising `zif_abapgit_html_viewer~sapevent` | real, from abapGit |
| `zcl_abapgit_html`, which writes every sapevent anchor abapGit has (`href="sapevent:select?key=…"` plus its `data-sapevent` marker) | real, from abapGit |
| `zcl_abapgit_gui_event`, the object `zcl_abapgit_gui=>handle_action` builds first, and its `query( )` / `form_data( )` | real, from abapGit |
| `cl_gui_html_viewer=>dispatch_sapevent` and the raise | real, the fork branch |
| `zcl_abapgit_gui=>on_event` | absent: three lines calling `handle_action`, whose first act is the `CREATE OBJECT` the harness repeats; the rest is the router and the pages |
| the "New Online Repository" form | **copied**: `zcl_abapgit_html_form` reaches `zcl_abapgit_ui_factory` and with it all of abapGit, so the harness writes the markup that class writes (the `<form>` with the main command as its action and a hidden submit, side actions as submits with a `formaction`) with the field ids and events of `zcl_abapgit_gui_page_addonline`, and says so |

Measured on the way: `zcl_abapgit_gui` reaches **371 of abapGit's 592
objects by name** (`node tools/osd-closure.mjs .local/lars/abapgit/src
zcl_abapgit_gui`), through `zcl_abapgit_exit` and the UI factory, and so does
any page class; the three real pieces above reach 17, 6 and 7. abapGit's own
CI transpiles the whole tree against open-abap-core, **open-abap-gui**,
open-abap-seo, express-icf-shim and `abapGit-web-classic` with
`unknownTypes: runtimeError` (`test/abap_transpile.json` there), and serves
it through `zcl_abapgit_web_sicf` (`test/express.mjs`), which passes the raw
POST body into `postdata` with a `todo, parse and pass data` beside it. So
"abapGit renders" is not blocked by the GUI layer or by the closure as such;
it is blocked by this tree building with `compileError` and layering only
the pack/delta half of abapGit. That is G.4's lift, and now a measured one.

What the proof asserts, concretely: a repository's anchor comes back as
`action = select`, `getdata = key=000000000002`, `query( ) = {KEY: …}`; the
form comes back as `action = add-repo-online` with `postdata` holding the
document's fields only (`url=…&package=$OSD&…&display_name=open steamgate
%26 friends, 100%25 offline&folder_logic=PREFIX`, none of the transport's),
and `form_data( )` holding the typed values under abapGit's upper-cased keys;
a side action's `formaction` is its own event; a 700-character value fills
256-character lines and abapGit joins them back; a POST naming no viewer is
not dispatched. State between the GET and the POST is class data of the
harness — one document per process, which is enough for a proof and is
exactly step 3 above.

## Tests

```
npx mocha test/webgui.mjs                       # the path, the tree, the command field
npx playwright test test/e2e/webgui.spec.mjs    # it renders, a node navigates, the field works
npm run unit                                    # ZCL_OSD_WEBGUI: the ok-codes, and the sapevent rewrite
npx mocha test/sapevent.mjs                     # the round trip against abapGit's markup, browser played by hand
npx playwright test test/e2e/sapevent.spec.mjs  # the same, Chromium clicking inside the frame
```

`test/sapevent.mjs` is in `npm run integration`. The fork's own tests of the
two halves run with `npm run unit` in `.local/lars/open-abap-gui`.

`test/webgui.mjs` is in `npm run integration`. The browser test does not assert
a status code: it opens folders, reads a node, clicks it and follows where it
goes, then types names into the command field.
