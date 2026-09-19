# Backlog

Everything open, as a tree, with who owns it and what it waits on.
Written 2026-09-13. `AGENDA.md` stays the narrative record of what was
decided and why; this is the list.

Owners: **S** open-steamgate (this session's repository), **T** the
transpiler session (`src/segw/**`, the ABAP generators, connectivity, APC),
**V** vsp (the Go bridge, the only thing that touches a real system),
**R** open-rfc-go (the RFC/CPIC transport and the ADT bridge),
**A** Alice — a decision nobody else can take.

---

# Where it stands, and what is next — 2026-09-19

OSD is a system a client cannot tell from one: Eclipse works over HTTPS and
over RFC, the demo runs on three machines and in a browser, content arrives
as packs fetched from repositories, and the runtime is measured against a
real system frame by frame. What is left is not "make it work" but "make it
answer the way a system answers", and two or three tracks that were never
started.

**Since 2026-09-18 it also has its own screens, and they are the shortest
way to show what it is.** SAP Easy Access, a data browser in SE16's shape, an
SQL trace in ST05's shape, an AMDP sandbox the original cannot do at all,
and an editor that writes through the same object store the ADT façade
writes through — all of them ABAP, all of them without a line of JavaScript,
each on the path the original answers on. Beside them a branch of a whole
system is now real: a worktree with its own port and database, and two
sieves — responses and SQL — each calibrated on a system compared with
itself before it was pointed at anything interesting.

**Both "loud" and "small and safe" buckets of the order of work below are
empty as of 2026-09-19.** What is named next there was chosen by the same
rule and is not started: G.5, G.6, G.7, and W.2, the differential debugger.

```
A — the ADT surface: what a client may ask
│   the client works today; the rest is coverage
├─ A.1  editor documents for FUGR, MSAG, DOMA, TTYP, VIEW, SHLP     open
├─ A.2  function groups and modules as create targets               open
├─ A.3  data preview beyond the freestyle door                      open
├─ A.4  the metadata bootstrap                                      DONE
├─ A.4b an RFC client that CALLs, not only describes                open
├─ A.5  session affinity across parallel RFC connections            open
├─ A.6  debugger endpoints                                          open
├─ A.7  ATC, refactorings, quick fixes, where-used                  open
├─ A.8  CTS                                                         open
├─ A.9  creating an object: the second dialog nobody reads          open
├─ A.10 what the client complains about while it works              open
├─ A.11 a service of several CDS views, no hand-written class       DONE 09-17
└─ A.12 SRVD + a minimal SRVB: the service definition as an input   next-ish

B — the runtime underneath: what the answers are made of
│   the track is done; these are the named gaps
├─ B.1  SADL beyond read-only, and beyond one table              DONE 09-19
├─ B.2  BOPF / RAP / drafts: one runtime, two front ends           decided 09-18
├─ B.19 HANA and AMDP: the i7 runs it, A4H is the oracle            decided 09-18
├─ B.3  OData V4                                                    a track of its own
├─ B.4  the RFC runtime, both directions                            open
├─ B.5  multi-record framing, measured against a long answer        open
├─ B.6  the client and MANDT story                             dormant + a detector
├─ B.7  the database seam beyond three backends                     open
├─ B.8  SICF and SM59 as applications, the way SEGW is one          open
├─ B.9  a forced build mutates a generation under its name       DONE 09-19
├─ B.10 the base image named by the schema alone                    DONE 09-17
├─ B.11 the binary beyond the checkout (a system pack)              open
├─ B.12 work processes, and a channel that never waits              DONE 09-16
├─ B.13 a new SMW0 object never reaches an existing database        DONE 09-17
├─ B.14 a cast in a CDS view drops the field                     DONE 09-19
├─ B.15 does our pipeline read a view entity?                    DONE 09-19
├─ B.16 the demo DPC ignores $orderby                               DONE 09-17
├─ B.17 the arithmetic protocol: 30 ns an operation, and who        measured,
│       fixes it                                                    ranked
└─ B.18 the release bundle runs 3.5x slower than the same build     measured,
                                                                    undiagnosed

C — the side quest: RFC in, DIAG out
├─ C.1-C.4  the oracle read, the stub that answers                  DONE
├─ C.5  one ticket, three doors: HTTP, RFC, DIAG                    open
└─ C.6  whether it goes further                                     a decision

D — the RFC gateway: every RFC-enabled module, exposed
│   the channel calls any module of the tree; no wire face yet
├─ D.1  a generic "call this module" endpoint                       DONE 09-17
├─ D.2  which modules are exposed, and finding them                 half done
├─ D.3  the signature -> metadata graph builder                  half DONE 09-19
├─ D.4  the bridge becomes a generic RFC server                     open
├─ D.5  the SOAP-RFC facade, likely the easiest win                 open
└─ D.9  docs/adt-facade.md for abapGit #7880                        DONE 09-17

E — content packs and layers: what the tree is made of
├─ E.1  ordered source roots, duplicates refused                    DONE 09-16
├─ E.2  a pack is a directory, not a rebuild                        DONE 09-16
├─ E.3  what a pack may carry                                       open
├─ E.4  the Zork console does not fit its box                       DONE 09-19
├─ E.5  the launchpad asks for a config we do not serve           DONE 09-19
├─ E.6  a pack cut out of a system, with stubs on the perimeter     open
├─ E.7  the oracle's leftovers: Pages stops mid-show, profiling     open
├─ E.8  a DIAG stream as a demo                                     milestone 1 DONE
└─ E.9  a pack has a page of its own                                open

G — the classic screens, and the GUI substitutes under them
├─ G.1  SAP Easy Access, served by ABAP                             DONE 09-18
├─ G.1b the drop, drawn, and a menu bar that works                  DONE 09-18
├─ G.2  prove a sapevent click comes back                           DONE 09-18
├─ G.3  a transaction node that actually runs                       DONE 09-18
├─ G.5  SICF as a Fiori Elements application, and live                open
├─ G.6  a class with an interface becomes a screen (the Neptune       open
│       concept, named by Alice 2026-09-18)
├─ G.8  an AMDP sandbox first, an SE80-shaped workbench after   waves 1-2 DONE
├─ G.9  SE16-shaped data browser: a page over reads we already have  DONE 09-19
├─ G.10 ST05-shaped SQL trace, which is also O.1's instrument    DONE 09-19
├─ G.1c the name is ours and the picture is the joke                DONE 09-18
├─ G.1d the naming rule as a check, not as a list                   DONE 09-19
├─ G.7  the screen is usable from the keyboard                       next-ish
└─ G.5  SICF as a Fiori Elements application, and live                      [S]
     Alice, 2026-09-18: a real application, the analogue of transaction
     SICF, as a proper Fiori Elements app where handlers and the rest are
     configured.
     ├─ half the model is already here and in SAP's own shape: a
        *.sicf.xml carries URL, ICFSERVICE (name, orig_name), ICFDOCU
        (description per language) and an ordered ICFHANDLER_TABLE of
        classes. Eight nodes in the tree today
     ├─ missing against the real one: logon data (client, user, language,
        the order of the authentication procedures), service parameters as
        name/value pairs, error pages, the session timeout and the
        stateful flag, the active/inactive flag (inactive answers 403),
        and aliases pointing at another node
     ├─ the shape to build: DDIC tables + CDS views with associations + a
        stg.yaml service + a Fiori Elements list report and object page,
        exactly as src/status/ is built; the object page's sections are
        handlers, parameters, descriptions, logon
     ├─ the write-back follows the SEGW editor: the tables are the truth
        at runtime and the ICF registry reads them, and an export writes
        *.sicf.xml back so abapGit can carry it away. @ObjectModel.
        writeEnabled already makes a one-table projection writable and the
        dispatcher already answers 405 for a write the model forbids
     ├─ reached from the status app, not only from the launchpad (Alice):
        the Services section's path becomes a link into this editor by
        intent. The annotation compiler already emits both shapes -
        `lineItem: [{value: Path, semanticObject: IcfNode, action: manage}]`
        makes the value itself navigate, and `{intent: {semanticObject,
        action, label}}` makes a button - so the work is one line of YAML
        in src/status/zosd_status.stg.yaml plus an inbound in this app's
        manifest, the way SegwProject-manage and EasyAccess-show already
        work. Nothing to add to tools/stg-compile.mjs
     └─ what makes it worth doing rather than pretty: **the settings
        become live**. Change a node's handler class and the next request
        goes elsewhere; deactivate a node and it answers 403; add a second
        handler and it runs after the first. Today our nodes are static -
        they arrive from XML at build time - so this is a behaviour of a
        real system that we do not have at all

G.6  A class with an interface becomes a screen                          [S]
     Alice, 2026-09-18, naming the Neptune concept: implement one
     interface in a class and its public attributes and tables are the
     model a Fiori screen binds to. No DDIC, no annotations, no OData -
     serialize the object, post it back, run a method, serialize again.
     ├─ measured, not assumed: **every part of the loop already exists
        here.** `cl_abap_objectdescr` enumerates attributes with their
        visibility and lists the implemented interfaces, so "does this
        class implement ours" is a runtime question with no registry;
        `ASSIGN data->(ls_attribute-name) TO <any>` is the dynamic access
        by name, and it is not hypothetical - `/ui2/cl_json` uses exactly
        that line to serialize an object today; the JSON serializer
        already walks an object reference into its public attributes, and
        we already use it in the status service and the RFC channel; and
        the endpoint is the ICF handler pattern every page here uses
     ├─ what is left to write: the interface itself (init and an event
        handler), writing values back into the attributes, and a UI5 host
        page that holds the model and posts it. Days, not weeks
     ├─ why it is worth having beside B.2 rather than inside it: RAP and
        BOPF are for a *modelled* business object - buffer, composition,
        draft, locks - and are expensive because that is expensive. This
        is "I have a class, give me a screen", which is a different and
        much larger pile of tasks. The RFC channel (D.1) is the same idea
        for function modules, so this is its sibling, not B.2's
     ├─ **compatibility is not a property of our code, it is an importer**
        (Alice, 2026-09-18). Our interface lives under our own name in our
        own namespace and we publish nothing carrying theirs. A tree
        imported from such a product gets a **generated shim** - an
        interface under the vendor's name that delegates to ours - written
        **into the imported folder**, never into this repository. The
        mechanism already exists: the `input_folder` layer order where the
        later folder wins, and the pack overlay that brought the demo and
        Zork in over fetched upstream sources. So the customer's classes
        run unchanged and we ship nothing named after anybody
     ├─ the namespace is the technical reason, not only the legal one: a
        registered namespace needs its owner's key on a real system, so an
        object we invented there would exist here and be impossible to
        create where it has to run. Interface *signatures* are a different
        matter and are what this project already reimplements clean-room
        for `/IWBEP/`, which is the precedent to follow
     ├─ **the compatibility report falls out of the same pass, free**: the
        importer must walk the classes, find the implementations and match
        the methods anyway, so it can say how many classes were matched,
        which methods it could not find and which capabilities are not
        supported. That is the number worth having - not "does it work"
        but how much of it does
     └─ **export is a consequence, not a feature**: carrying a class
        written against our interface back out to theirs works exactly as
        far as we implemented their contract faithfully. Worth naming as a
        goal, not worth promising

G.7  The screen is usable from the keyboard                              [S]
     Alice, 2026-09-18: the menu and the tree must work with the arrow
     keys and Enter as well as the mouse, and Page Up / Page Down too.
     ├─ this is what a real SAP GUI user expects and it is also plain
        accessibility: a tree nobody can walk without a mouse is half a
        screen
     ├─ the constraint that makes it interesting: `ZCL_OSD_WEBGUI`
        currently ships **no JavaScript at all** - the folders are
        `<details>`, the menu folds out on `:hover` and `:focus-within`,
        a node is an anchor, and a browser test asserts a script count of
        zero. Tab and Enter therefore already reach every node and every
        menu entry. What is missing is arrow-key movement, which the
        browser does not give a list of links for free
     ├─ so decide honestly rather than by reflex: how much of it is
        reachable with `tabindex`, `<details>` and the roving-focus
        pattern in HTML alone, and where a small script genuinely earns
        its place (arrow keys across a tree, Page Up / Page Down by a
        screenful, Home / End). If a script goes in, it is small, it is
        the only one, and the test that asserted zero scripts becomes a
        test that asserts exactly one and says why
     ├─ the real screen's habits worth copying: arrows move, Enter opens,
        Right/Left expand and collapse a folder, Page Up / Page Down move
        by a page, and the command field keeps focus on load so a name
        can be typed immediately
     └─ it belongs with G.1b's work rather than after abapGit: the screen
        is the thing people touch first

G.1c The name is ours and the picture is the joke        [S]  DONE 2026-09-18
     Alice, 2026-09-18, with the original screen's background in front of
     her: drop "SAP" from our own names, and the image panel is not one
     drop - it is rain on a surface.
     +- **the naming rule, and it has a line in it**: a name *we* invent
        does not carry somebody else's trademark, so "SAP Easy Access"
        becomes **"Easy Access"** in the title bar with `open-steamgate`
        beside it, exactly where the real one puts the system. Same for
        the class descriptions, the ICF documentation, the launchpad tile
        and the pack names. But a *statement of fact about SAP software*
        keeps the word, because removing it would make the sentence false:
        the light show really does play to a real SAP GUI over DIAG, and
        `docs/` describes a real SAP system throughout. Rename what we
        call ourselves; do not rewrite what is true
     +- **the picture**: the original is a pool seen from above with
        concentric ripples and business words half-submerged in it. So:
        many drops striking a surface, their rings spreading and crossing,
        rain, mist over the water, a gate of steam standing in it, and a
        sun above. SVG in the page as the drop already is - no bitmap, no
        fetch, and the browser test that asserts zero images stays
     +- **the slogan, hers**: `Open SteamGate` and under it *the next
        level of vaporware*. It earns its place: the screen's status line
        already says "a gateway that is not there", and a project that
        reimplements a gateway nobody can buy should say so first
     +- **codenames, steam-related, for release names.** The bathing
        traditions are the better seam - geographically spread, each with
        a story, and none of them anybody's trademark: **Loyly** (Finnish,
        and the best of them: it names *the steam itself*, the burst off
        the stones - which is the vaporware joke made literal), Sauna,
        Banya, Hammam, Sento, Onsen, Jjimjilbang, Temazcal, Rasul,
        Sudatorium, Laconicum, Tepidarium, Caldarium, Thermae, Aufguss
        (the German ritual of pouring), Kiuas (the stove), Parilka.
        If a machine-shaped set is wanted instead: Boiler, Piston,
        Flywheel, Governor, Condenser, Throttle, Injector, Whistle,
        Firebox, Safety-valve; and from the world itself: Geyser,
        Fumarole, Solfatara, Plume
     +- G.7 (the keyboard) and this share the same file, so whichever runs
        second rebases rather than both editing `zcl_osd_webgui` at once
     +- **DONE 2026-09-18.** The title bar is "Easy Access" with the system
        beside it; the ICF documentation, the class description and the
        launchpad tile follow. The three remaining "SAP Easy Access" in the
        class are comments describing the real screen, which is a statement
        of fact and stays. The picture is a second SVG, `.artscene`, behind
        the wordmark: sun, rain as one `<pattern>` with a single
        `animateTransform` on it, mist drifting, a gate of steam standing in
        the water, and four rings spreading from where the drops land, each
        two `<animate>` elements. It is separate from `.artbg` because that
        one stretches with the splitter and would turn every ring into an
        egg. 4.7 KB, no script, no bitmap, no second request - the browser
        test still asserts a script count of zero and it still passes.
        `.artname` is now `Open<b>SteamGate</b>` and `.artnote` the slogan,
        "the next level of vaporware"; the status line's "a gateway that is
        not there" moved aside for it. Tests: test/webgui.mjs asserts the
        name, the absence of the old one, the slogan, the scene and the
        absence of any <img>; 17 passing, and the six browser tests pass

G.1d The naming rule as a check, not as a list           [S]  DONE 2026-09-19
     `npm run naming` (`tools/osd-naming-scan.mjs`), in CI beside the leak
     scan, suite `test/naming-scan.mjs`. Seven naming positions, `.naming-
     allow.json` tracked with a reason per entry. What it found on the first
     run: the pack called itself **"SAP LSD"** in eight places -- a name we
     give ourselves carrying a word we have no claim to -- and that is now
     "LSD". What is left are four statements of fact, each allowed by name:
     "...plays to SAP GUI", and the title **"ZORK on SAP HANA"**, which
     passes the rule's own test -- take the words out and the sentence has
     no content left, because all of its content is what the thing runs on.
     `ABAP` is deliberately not a brand word here (the agreed headline
     contains it), and transaction codes are deliberately not either: in a
     title they are what the screen is called over there, so flagging them
     would flag mostly true sentences, and a check that cries wolf gets
     ignored. The test asserts the scanner **can fail**, which is the
     property a scanner is least likely to have and most likely to be
     trusted for.
     Raised 2026-09-18 by fable-osd, who caught her own README headline
     breaking the rule Alice set in G.1c, and agreed with this session.
     ├─ the rule: a name **we give ourselves** carries no third-party brand
     │  word; a **statement of fact about their software** keeps it, because
     │  without it the sentence would be false. "in a real SAP system code
     │  is branched by transports and data is not branched at all" stays as
     │  it is; a page title does not
     ├─ the headline settles as **`An ABAP application server you can
     │  clone`**, with the boundary in the next sentence: not an ERP, no
     │  business applications, a subset of the language and of the
     │  dictionary. The noun is a claim of compatibility and people read it
     │  literally, so the line that says what is *not* here is what keeps
     │  the headline true -- it is a definition of scope, not an apology
     ├─ why a check and not a document: "no live identifiers" sat in
     │  CLAUDE.md from the first week and did no work at all -- both leaks
     │  were caught by attention, and attention runs out. A list of what we
     │  call what goes stale silently
     ├─ so scan the **naming positions**, the way `npm run leak` scans byte
     │  views: `<title>`, the launchpad title and tile texts, `shellLogo`
     │  and icons, pack names and `osd-pack.json`, ICF node texts and
     │  `ZOSD_SVC`, class descriptions, the page titles ABAP writes in
     │  backtick literals. A third-party brand word in one of those fails
     └─ `.naming-allow.json`, tracked, every entry with a reason, exactly
        like `.leak-allow.json` -- so an exception can be told from a way of
        making the build green. Stated limit: a text scan cannot tell "what
        we call ourselves" from "what we say about them"; the **position**
        carries that, which is why positions are what is checked, and prose
        stays a person's job

G.8  SE80 in the screen: edit ABAP, CDS and AMDP                         [S]
     Alice, 2026-09-18: "кастомная SE80-like транзакция - в которой можно
     будет редактировать код, CDS (ахаха SAP!) и AMDP (охохо SAP!!!) - и
     ставить брейкпоинты". Weighed rather than estimated, because the parts
     are very unequal.
     ├─ **what this is not**: editing already works from Eclipse, through the
     │  ADT facade, and has since 2026-09-15. The value here is editing
     │  **without Eclipse** -- in a browser, on our own screen, out of our own
     │  tree -- and the three jokes that fall out of it
     ├─ **the jokes are the point, and two of them are real capability**:
     │  ├─ **CDS in SE80.** On a real system CDS cannot be edited in SE80 at
     │  │  all, only in Eclipse. Here CDS is already parsed, generated and
     │  │  published, so an editor for it is a screen and not an engine
     │  ├─ **AMDP in SE80**, which on a real system is not even a question --
     │  │  there is no SQLScript editor in SE80. Here, since 2026-09-18,
     │  │  there is everything needed not only to show it but to **run it and
     │  │  show the result**: the scissors, the deploy, the call, and the
     │  │  table-function type check
     │  └─ and ABAP itself, which is the ordinary part
     ├─ **the text control is already there and it is the real contract.**
     │  `open-abap-gui` carries `CL_GUI_TEXTEDIT`, 349 lines, with
     │  `set_text_as_r3table`, `get_text_as_r3table`, `get_textstream`,
     │  `set_readonly_mode`, `get_selection_pos`, `protect_lines`,
     │  `go_to_line`. Alice said a custom control would be acceptable and
     │  matching ABAP's contract merely nice -- it turns out we get the real
     │  contract for nothing, because Lars already wrote it. What is missing
     │  is only the **rendering**: nothing turns it into an editable area,
     │  and nothing brings the text back
     ├─ **the screen, not a Fiori app**, and for a measured reason rather
     │  than taste: the webgui screen already has a session in ZOSD_TSES, a
     │  `sapevent` click that comes back into ABAP, keyboard handling, and
     │  ships **zero JavaScript** with a test asserting it. An editor is
     │  "state between requests plus a click", which is exactly what is
     │  already built. A Fiori app would have to learn all of it again
     ├─ **the cost, split so it is honest**:
     │  ├─ *cheap*: a `<textarea>` in a form, posted back through the same
     │  │  handler -- pure HTML, no script, and the zero-script test survives
     │  ├─ *medium*: making it feel like an editor without JavaScript. Line
     │  │  numbers and syntax colouring have to be **server-rendered**, which
     │  │  is possible (abaplint tokenises, we already own the parse) but is
     │  │  a real piece of work, and the caret cannot be styled at all
     │  └─ *a track of its own*: **breakpoints.** There is no debugger here.
     │     A.6 is unbuilt, and its message schemas are shared with O.2, the
     │     step-trace oracle. This must be priced separately or the item
     │     becomes bottomless
     ├─ **the order is wrong as first written, corrected by the critic
     │  2026-09-18**: starting with SE80 means starting with its most
     │  expensive part -- an object tree, navigation, many types -- for its
     │  cheapest reward. The one thing that cannot be copied in the original
     │  is AMDP, and it is nearly ready. So the first artefact is **one
     │  sandbox page**: an AMDP method on the left, a run button, the result
     │  table on the right. A day's work and a finished act. Then the same
     │  editor generalises to other object types, and only then does a tree
     │  in SE80's shape go under it. Demonstration first, generalisation
     │  after -- the order that got us here.
     ├─ **decide before the first line of the editor**: highlighting either
     │  breaks the zero-JavaScript property the screen's test asserts, or is
     │  **rendered by the server**. The second is real here, because the
     │  parser is already in the process -- the facade parses the whole
     │  system at start -- so the server can hand back coloured HTML while
     │  editing happens in a plain textarea. That gives back exactly the
     │  display/change pair the original SE80 had, and it is a joke on the
     │  original rather than a compromise: a screen that colours text on the
     │  server, because in nineteen-ninety-something that is how it was done
     ├─ **where does an edit land? -- ANSWERED, and it was answered before
     │  the question was written.** This bullet used to say it was the first
     │  item of the estimate and that until it was settled the editor was a
     │  toy. It was settled on 2026-09-15 by the ADT facade, in
     │  `tools/osd-store.mjs`, and nobody wrote the answer back here:
     │  ├─ `write()` lands the object **in the file it came from**, in its
     │  │  own root; a new object goes to the first writable root, in the
     │  │  folder of its package, as the two files abapGit would write. So
     │  │  abapGit sees it, git sees it, and the layer that owned the name
     │  │  still owns it -- an edit cannot silently move an object between
     │  │  layers, because it never chooses a layer
     │  ├─ `inactive` is the written-and-not-yet-activated set, `check` is
     │  │  the parse, `activate` is the check over the object and everyone
     │  │  who uses it, and `publish` is the transpile plus the replacement
     │  │  of the serving process
     │  └─ so the one thing the editor must NOT do is open a second write
     │     path. That is the whole risk of the wave, and it is the opposite
     │     of the risk this entry described
     ├─ **and the danger the old bullet created is worth naming**, because
     │  it is a failure mode of this document rather than of the code: an
     │  entry that asks what the tree can already do costs more than a
     │  missing entry. A missing one is looked for; this one would have been
     │  believed, and the next session to open G.8 would have spent an
     │  evening deciding something decided
     ├─ **what a save costs, measured 2026-09-19** in a worktree of its own
     │  (`osd-branch add`), 1518 objects:
     │  ├─ cold build 12.04 s; **a second build with no change at all**
     │  │  12.10 s and a *different* generation name; one comment changed
     │  │  12.02 s; the same content again 0.21 s, cached
     │  ├─ the second line of that table is **historical since `267f9a7`**,
     │  │  which took `gen/` out of the hash and put the generators and
     │  │  their imports in instead: a fresh tree now builds in 9.5 s and
     │  │  its second build is a cache hit at 0.16 s under the same name.
     │  │  What the measurement had said was that a generation name was a
     │  │  function of the content **plus the build history of that tree**,
     │  │  because `gen/` was written by the build and fed its own hash --
     │  │  a representative standing in for the generators, which the hash
     │  │  could not see. That is now fixed at the cause
     │  └─ and what the fix does **not** change is the price of Activate:
     │     a save changes `src/`, so the hash differs whatever `gen/` does,
     │     nobody has built that content before, and the transpile runs.
     │     `publish()` is a full build plus a process recycle, ~12 s here,
     │     and no edit ever hits the cache -- the cache helps only when the
     │     content was built before, which is an undo. Which decides a piece of the screen: **Check and
     │     Activate are two buttons**, because a cheap operation and an
     │     expensive one under one name is a button people stop pressing
     ├─ **a cheap middle for breakpoints**, which gives most of the feeling
     │  for a fraction of the price: not an interactive debugger but a
     │  **step recording** -- run it and show every statement with the
     │  variables' values. It is a log rather than a protocol, we need it
     │  anyway for O.2, and it costs incomparably less than A.6.
     ├─ **wave 2 done 2026-09-19: the editor exists** --
     │  `/sap/bc/osd/edit/`, `src/webgui/zcl_osd_edit`. Pick an object from
     │  the list, change the source in a text area, Check, Save, Activate.
     │  No JavaScript, one form, server-rendered like the rest of the webgui
     │  ├─ it reaches the tree through `CALL FUNCTION 'ZOSD_STORE'
     │  │  DESTINATION 'STORE'` (`tools/osd-store-destination.mjs`), which
     │  │  is LIST / READ / WRITE / CHECK / ACTIVATE over the store the ADT
     │  │  facade already writes through. **The third user of that seam, not
     │  │  a third seam** -- the AMDP tile and the ST05 screen are the other
     │  │  two -- and deliberately not a second write path
     │  ├─ **ACTIVATE builds.** `activate()` is only the verdict; the
     │  │  modules the runtime loads are written by the transpile behind it.
     │  │  A screen that said "activated" over a system still answering with
     │  │  the old code would be a worse sentence than a slow button. Whether
     │  │  the running process was *replaced* is a second question with a
     │  │  different answer per host, and the screen says which of the two
     │  │  happened rather than implying the better one
     │  └─ and it found the gap that only a posting screen could find:
     │     **a form posted to a screen arrives with no form fields.** The
     │     shim fills them from the query string alone, so every button
     │     answered the object list, silently, as though nobody had typed
     │     anything. SE16 navigates by GET and the webgui posts through
     │     `sapevent`, which is why no screen before this one met it.
     │     ANORMALIES `posted-form-has-no-fields`, workaround
     │     `src/webgui/zcl_osd_form`, and the fix belongs in the shim
     ├─ **wave 3's first item, from fable-osd using the screen** (the way a
     │  defect should be found) -- **DONE 2026-09-19**: the default list is
     │  cut at 300 and the types sort together, so 607 classes filled it and
     │  **no CDS view was visible at all**. The screen was honest -- "300
     │  shown of 1140" -- and still unfindable by anyone who did not already
     │  know to type `DDLS`. Honest and unfindable are different failures.
     │  ├─ the fix is not a bigger limit but a **tally beside the list**:
     │  │  `CLAS 702 · INTF 210 · TABL 199 · … · DDLS 13 · …`, each a link
     │  │  to `?type=` that keeps whatever filter was already typed. The cut
     │  │  now hides the tail of one type instead of whole types
     │  ├─ a structure of its own (`ZOSD_TYPE_S`: a type and a count), not a
     │  │  number pushed into the object row -- two things obliged to differ
     │  └─ and the half that is easy to get wrong, which is a test: the
     │     tally counts what the **filter** matched, **before** the type
     │     narrows it. Counted after, asking for DDLS would answer "DDLS is
     │     all there is" -- an instrument confirming the choice just made
     ├─ **what wave 3 is, and what it is not.** Not a tree in SE80's shape:
     │  the expensive part for the cheapest reward, which the critic already
     │  said once. The three that are worth it are server-rendered
     │  highlighting (the parser is in the process), the CDS half (fable-osd
     │  has it), and a step recording instead of a debugger
     └─ **the name is not SE80.** The rule we set for ourselves -- call
        what is ours by our own name, keep "SAP" in a statement of fact --
        does not stretch to transaction codes. A transaction of ours called
        SE80 is not our name, it is somebody's product. `ZOSD_*` with a line
        saying "corresponds to SE80" is cleaner and describes more exactly
        what we did.

G.4  abapGit through the substitutes — **PARKED 2026-09-18 by Alice** after a, b decided
     Split 2026-09-18 on the critic's reading: under one number the three
     block each other for no reason. The first two are decisions this
     circle can take today; only the third is work.
     ├─ G.4a the page stack — **decided 2026-09-18: serialisable, no pinned
     │  process.** abapGit keeps the stack as live objects
     │  (`mt_stack TYPE ty_page_stack`, `page TYPE REF TO
     │  zif_abapgit_gui_renderable` plus a bookmark flag) and our session
     │  carries a string (ZOSD_TSES, G.3), so the question was whether a
     │  page can be rebuilt from data. Measured in the clone rather than
     │  assumed: **36 renderable pages; 11 take no creation parameters at
     │  all**, and of the 54 parameters the rest declare, 17 are
     │  `REF TO zif_abapgit_repo(_online)` — which the router itself
     │  already rebuilds from a key (`..._repo_view=>create(
     │  lv_last_repo_key )`) — and the remainder are flat: structures from
     │  `zif_abapgit_definitions` / `_persistence` / `_git_definitions`,
     │  `abap_bool`, `string`, `tadir`, `devclass`, `trkorr`, `sci_chkv`.
     │  ├─ the six that looked like genuinely live objects are **all
     │  │  serialisable too**, which is what settled it: `zcl_abapgit_stage`
     │  │  holds exactly two fields (a stage table and a SHA1),
     │  │  `zcl_abapgit_merge` holds a repo reference plus four flat
     │  │  tables and a string, and both object filters hold a TADIR table
     │  ├─ so a stack entry becomes {page class, parameters}, a repo
     │  │  becomes its key, and `/ui2/cl_json` — already used in the status
     │  │  service and the RFC channel — carries the rest
     │  └─ what is NOT the design: replaying the router's actions. The
     │     router mixes page construction with service calls in the same
     │     branches (`zcl_abapgit_services_git=>create_branch` sits beside
     │     `..._merge_sel=>create`), so replaying a path would redo side
     │     effects. The stack is stored as what it is, not as how it was
     │     reached
     ├─ G.4b the build mode — **measured 2026-09-18, and it is not a
     │  setting we can simply flip per pack.** abapGit's own CI uses
     │  `unknownTypes: runtimeError` (its `test/abap_transpile.json:93`),
     │  we use `compileError` (`abap_transpile.json:98`). Read in the
     │  transpiler source, the option is **per transpile run**, not per
     │  input folder: it is one field of `ITranspilerOptions`, defaulted
     │  once in `index.ts:35`, and consulted in `validation.ts`,
     │  `statements/create_object.ts` and `expressions/new_object.ts`.
     │  ├─ so the three ways are: flip our whole build to `runtimeError`
     │  │  and lose the net over our own code; keep `compileError` and
     │  │  supply the missing DDIC, which is G.4c; or build abapGit as a
     │  │  separate generation with its own options and serve it beside
     │  │  ours
     │  └─ the third is the only one that keeps both properties, and it
     │     costs an upstream change or a second build — which is why this
     │     is a decision and not a line of config
     ├─ G.4c the closure: 371 of 592 objects. This is the work, and it is
     │  third, not first
     ├─ **and abapGit does not get vendored into the tree** — 592 objects
     │  arrive the way the demo and Zork do, as a pack with `sources` and
     │  `osd-fetch` (E.2). So the first artefact of G.4c is a manifest,
     │  which ties this entry to track E more tightly than the tree shows
     └─ **parked 2026-09-18.** Alice: "там мне кажется больше мороки чем
        пользы пока" — this is the whole of abapGit, and the trouble
        outweighs the benefit at this point in the queue. The two cheap
        questions were answered first and are recorded above, so whoever
        unparks it starts from two decisions rather than from nothing;
        what remains under the number is G.4c, the closure of 371 of 592
        objects, and it is work rather than a decision

W — what this actually is, and the two things to bet on
│   The workstation session, thinking aloud 2026-09-18, and Alice on the
│   second of them: "OMG!!! это гениально". Recorded here rather than left in
│   a conversation, because they reframe tracks that already exist.
│
│   The framing: we keep describing this through a negative -- "a gateway
│   that is not there". There is a stronger statement available for what is
│   already built: **a SAP system you can clone.** Not a service, not a
│   runtime: a whole system as a repository that unfolds into a folder or a
│   browser tab. Seen that way several tracks stop being separate -- a
│   content-hashed generation is a version of the system, a pack is a
│   package, abapGit is the transport, and the browser preview is the proof
│   that a system fits in a file. The product's main surface is then not
│   `/sap/opu/odata/` but `osd clone && osd up`.
│
├─ W.1  a branch of a whole system, data and all      two sieves + plumbing DONE
│    If a system can be cloned it can be branched, and a git branch of an
│    entire system *including its data* does not exist in the ABAP world at
│    all: there, code is branched by transports and data is not branched by
│    anything. The shape is not "a code editor": it is **two systems side by
│    side and a switch between them** -- the same system on two branches,
│    running twice, and a comparison of what each answers.
│    ├─ **why it is possible here and not there, and it is not about code.**
│    │  ABAP branches code after a fashion, through transports. It is the
│    │  data: in a system the database is one and shared, so "the same
│    │  system with other data" is another system somebody has to install.
│    │  Here the database is a **file**, the seed is a **repository
│    │  artefact** (TABU JSON under `data/`), and a generation is immutable
│    │  and addressed by the hash of its inputs. So a branch carries state
│    │  as well as sources, and two branches cannot physically disturb each
│    │  other. **This fell out of decisions taken for entirely other
│    │  reasons**, which is what makes it the most valuable accident here.
│    ├─ **the minimum is nearly assembled**: take a git ref, unfold it into
│    │  a worktree, build it (the build is cached by input hash, so the
│    │  second branch is often free), serve it on its own port with its own
│    │  database file. Exactly **one** new artefact is missing: a **request
│    │  log and its replay** -- a list of HTTP calls run against both.
│    │  The log and the replay are an hour. **The normaliser is the work**,
│    │  and the estimate belongs to it, not to the plumbing.
│    ├─ **the order, and it is not the obvious one.** The minimum is the
│    │  *first* sieve only -- responses -- and it does not touch the SQL
│    │  seam at all. So W.1 and G.10 do not compete for it: the order is
│    │  W.1 minimum, then capture SQL as the second sieve, then G.10 as a
│    │  screen over a log that by then already exists. Backwards, G.10 is a
│    │  handsome page with no consumer and no normaliser behind it -- and
│    │  the normaliser is the whole job (fable-osd, 2026-09-18).
│    ├─ **three sieves, and the interesting cases live between them**:
│    │  ├─ *responses*, normalised for order, time and identifiers
│    │  ├─ *SQL*, taken at the one seam every statement goes through (O.1)
│    │  └─ *steps*, a statement with its variables (O.2)
│    │  Each is strictly finer than the last, and the **most valuable case
│    │  is when the responses agree and the SQL differs**: the right answer
│    │  arrived by accident, and that is what later breaks on a change of
│    │  data volume or row order. No ordinary test sees it.
│    ├─ **what this does to the oracle track, and it is the turn that
│    │  matters.** Until now "oracle" meant *us against a real system*:
│    │  expensive, by hand, only when A4H is up. Branch comparison is *us
│    │  against us* -- free, and in ordinary CI. And most of the questions
│    │  we actually ask an oracle are "did my change break anything?",
│    │  which needs no real system at all. A4H stays necessary for exactly
│    │  one class: "and how is it really?" That is much cheaper than we had
│    │  been assuming.
│    ├─ **three uses, in ascending order of cheek**: our own runtime's
│    │  regression (one system on two transpiler versions -- it would have
│    │  caught the release-bundle slowdown and the sort defect before either
│    │  was argued about); **A/B of somebody else's code** -- "prove your
│    │  refactoring changed nothing", which does not exist in the ABAP world
│    │  and is probably the first honest statement of use for an outsider;
│    │  and a **behavioural bisect**, because generations are immutable and
│    │  input-addressed, so the comparison is a predicate for `git bisect`
│    │  and "which commit changed this answer" stops being an investigation.
│    ├─ **where tools like this die: noise.** If the difference is never
│    │  empty, nobody looks at it after a week. So the discipline is the
│    │  opposite of the intuition -- **begin where there must be no
│    │  difference** (one branch on two runtimes, one system twice) and get
│    │  the instrument to stay silent. Calibrating the normaliser on the
│    │  knowingly identical comes before pointing it at a real change. And a
│    │  way to say "this difference is expected and approved" is needed from
│    │  the start, or every deliberate change paints everything red.
│    ├─ **on HANA, isolation is not by file.** Two branches that point at
│    │  one HANA server must live in **different schemas**, or the property
│    │  the whole bet rests on -- a branch cannot disturb another branch --
│    │  stops holding exactly where the interesting work is. A question of
│    │  deployment and naming, and it has to be answered before the second
│    │  branch is ever pointed at a server somebody else is using.
│    ├─ **one question to settle out loud**, because it changes what a
│    │  comparison means: does the second branch start from the first's data
│    │  or from its own seed? Both are useful and they are different --
│    │  a shared seed is a clean A/B of code; its own data checks that a
│    │  migration or another seed does not change behaviour. Unnamed, people
│    │  get different results and call the instrument unreliable.
│    └─ and it has an obvious showcase: two systems on one screen, the same
│       request into both, the difference highlighted -- a demonstration and
│       a working instrument at once. In a world where branching a whole
│       system is impossible in principle, the picture alone is the joke.
├─ W.2  **the differential debugger**                           the other bet
│    Three things that arrived separately: the frame oracle (the same ABAP
│    computes a picture here and on a real system, and we diff), a step
│    trace (a log of statements with their values, O.2), and a facade that
│    can talk to a real client. Together they are a debugger that runs one
│    piece of code in both places and stops at the first divergence. For a
│    project that transpiles somebody else's language that is not a
│    convenience, it is **the measuring instrument** -- and a product of its
│    own. Eight anomalies in two days came out of the crude version of this
│    on pictures; the version on statements would find them in handfuls.
├─ W.3  AMDP in the browser, by way of DuckDB
│    Now that AMDP really runs, the funniest thing and the most useful
│    coincide: teach SQLScript to execute in DuckDB as well as HANA and AMDP
│    reaches the browser preview -- a Z80 written in SQLScript, playing
│    something, on a public link with no HANA anywhere. That is the
│    `FOR DUCKDB` polyglot from B.19, and it turns the demo from "come and
│    I'll show you" into a URL.
├─ W.4  the closure, as a service and as the honest answer
│    CLAUDE.md said on day one that the long pole is the dependency closure
│    of real classes, and that it must be measured before architectural
│    commitments. We then built half a system and never made that number a
│    live metric. Make it a service: point it at a repository, get back what
│    would run, what would not, and why. It is a marketing instrument, a
│    backlog generator and the honest answer to "is this a toy" at once --
│    and it is the same machine the Neptune importer (G.6) needs.
├─ W.5  ABAP tests in ordinary CI, in tens of seconds
│    Not "emulate SAP": put a repository of Z code in, get green or red. It
│    needs no new track, only W.4 measured and published.
├─ W.6  the backlog as something the system says about itself
│    The facade already records every path a client asked for and did not
│    get. Generalise it: every layer logs what it was asked for and could
│    not do, and the backlog stops being a file somebody maintains. This is
│    the line `npm run parked` and the leak scan are already on -- not
│    "remember the rule" but "let the check ask".
└─ W.7  **the risk, which is not technical**
     There are many live tracks now and each can be deepened forever. The
     failure mode is not collapse, it is spreading thin: seven half-done
     things instead of two finished ones. The defence exists already -- the
     rule about measuring before deciding -- and it should be extended from
     choosing implementations to choosing tracks. The other half of the same
     risk: this runs on Alice's attention, which is the one resource we can
     neither measure nor replenish.

O — the oracles: proving we answer the way a system answers
│   Proposed by the workstation session 2026-09-18 and owned by it. These
│   were spread across A and B; the instrument has outgrown one track.
│   `o4d-record --compare` (a frame as the oracle, eight anomalies in two
│   days) is O.0 and already exists — whoever writes O.1 reads its code
│   rather than starting over.
├─ O.1  an SQL trace taken on both sides, compared             high, do first
└─ O.2  a step trace through the debugger endpoints            after O.1, with A.6

U — the user, and the thing itself
├─ U.1  the user's path, measured by a stranger                     DONE 09-17
└─ U.2  the status app on the browser deployment                    DONE 09-17

N — the no-regret set (docs/shift-right-and-quick-wins.md)
├─ N1  a real file-backed SQLite client                             DONE
├─ N2  the workbench-only entry point                               DONE
├─ N3  transpile as a library call                                  DONE 09-16
├─ N4  activation ordering                                          DONE (generations)
└─ N5  the black-box conformance suite                              DONE 09-17
```

### Track WD -- Web Dynpro, with the handlers in the page

Proposed 2026-09-18 by fable-osd; the case is in
[`docs/webdynpro-in-the-browser.md`](webdynpro-in-the-browser.md).

Run a component **and its own ABAP handlers** in the browser, reaching the
application server only when the ABAP goes outside it -- database, RFC, locks.

It reads as madness and is not, for three reasons that are already true here:
the transpiler runs ABAP in a page; the boundary to data is **one object with
eleven methods**, so "go to the server only for data" is a second
implementation of an existing seam rather than a new architecture; and that
seam is **already asynchronous**, so the point where execution would have to
pause is exactly where a remote call would go. The real work is three things:
the context (nodes, lead selection, cardinalities, supply functions -- the
largest piece), the phase model, and drawing with **our own** HTML rather
than imitating Unified Rendering.

Seven waves. The first was to be a corpus measurement designed to close the
track in a day. **It was run on 2026-09-19 and it did not close it**
([`docs/webdynpro-measured.md`](webdynpro-measured.md)): against 2710
components and 151,000 controller method bodies on the sandbox, **25
framework methods cover 80% of all framework calls and 62 cover 90%** --
overwhelmingly the context API. The critic expected a long tail, which would
have ended the track for the price of an afternoon; the tail is there (661 of
4,735 declared methods are called at all) but the head is small enough to
build.

What the same review **did** kill is the original argument, and the author
withdrew it: the data boundary is not where the proposal put it (real
controllers reach the outside through a model, and in the one real component
available that model is BOPF), the seam is statement-level so one round trip
becomes N, and any sound server-side re-validation reconstructs the round
trip the track existed to remove. What survives is the other product --
**Web Dynpro running with no system behind it at all**, in the preview where
the ABAP and the database are already in the page, where none of those three
objections applies because there is no remote call. The beachhead moves from
a plain component to an **FPM feeder** (687 of them on the sandbox): an
ordinary ABAP class that transpiles today, with no generated controller and
no context API, whose screen is a configuration file.

**The security rule is written before the speed, on purpose:** a handler run
in the browser is a **prediction, not a decision**. An `AUTHORITY-CHECK` in a
page is not a check, and a write "approved" by the client is a security
boundary handed to whoever opened the developer tools. Everything that writes
is replayed or re-checked on the server.


**What is being worked on now:** N5, the conformance suite — the same
requests asked of a base URL rather than of an in-process app, so "our
tests pass" becomes "we answer the way a system answers". U.2, the status
app on the browser deployment, is done: there is no façade there, so the
worker says what it knows about itself and leaves the rest visibly empty.

## Deploying: the i7 follows Pages

Alice's standing rule is that a finished milestone goes to both addresses --
the i7 showcase and GitHub Pages -- **from one commit**, each verified by
reading what it actually serves. Two attempts on 2026-09-19 failed the "one
commit" half, and not through carelessness: Pages is triggered automatically
by a push, the i7 is built by hand and takes minutes, and a second push
during the build leaves them on different commits. Chasing a moving target
does not converge.

So the order is fixed rather than coordinated: **Pages first, the i7 after
it, from the commit Pages published.** When a preview deployment run goes
green, rebuild the release from exactly that commit and restart the i7. No
asking anybody to hold pushes, and the rule holds however often the tree
moves.

Verification stays what it was, on both: fetch the served page (or the
published `sw.js`) and read in it the thing that was supposed to change. A
green workflow is not a deployment, and a build command exiting 0 is not one
either.

And one check that makes a divergence visible **without anybody's word for
it** (fable-osd): both targets print their generation in the footer, so the
statement to make is not "I built them from the same commit" but **"both
pages show the same generation"**. Anyone can check that, including the
person who did not do the deploying.

## Who drives what, settled 2026-09-19

Alice asked the two sessions to agree a division and get on with it. It is by
**what each already has in hand**, so that neither of us is in the other's
files:

**fable-osd** — one connected thread, journal → sieve → screen:
- **W.1, the remainder**: the branch plumbing (a ref into a worktree, its own
  port and its own database file), then the **second sieve, SQL at the O.1
  seam**. It is the machinery she built all day — three comparing
  instruments, a normaliser with a reason per rule, the third value kept
  apart from the two — and it carries over whole.
- **G.10, the ST05-shaped SQL trace**: a screen over the log W.1 will by then
  be filling. The backlog says "nearly free", and that is only true if the
  sieve and the screen are the same person.
- Before pausing: a mechanical comparison of the grammar against the binder,
  so that "we found five silent substitutions by hand" becomes "the two are
  compared automatically".

**this session** — what it has already shipped and owns:
- **E.5**, the launchpad asking for a config we do not serve — **done
  2026-09-19.** It was three things rather than one, and the guard that
  settled it now allows none of them:
  - `404 /appconfig/fioriSandboxConfig.json` — **fixed.** The UShell sandbox
    fetches an optional external config on top of our inline
    `sap-ushell-config` and merges it. We have nothing to add, so the honest
    answer is an empty merge. Written once in
    `tools/osd-sandbox-config.mjs`: the two express hosts take a route from
    it, the preview build writes a file from the same body, because the path
    is absolute and a rule about what every host must answer belongs in a
    module they all import.
  - `500 /sap/bc/osd/amdp/engine` — **fixed 2026-09-19**, and it was three
    layers, each hiding the next:
    1. the destination raised a plain JavaScript `Error`, which the ABAP
       `CATCH cx_root` around the CALL FUNCTION cannot catch (fable-osd);
    2. `tools/amdp-destination.mjs` imported `connection` from
       `amdp-run.mjs` **statically**, and the preview bundle ignores that
       module on purpose — webpack turns such an import into a
       `webpackMissingModule` that throws the moment the binding is touched,
       before any guard can run. The comment beside the IgnorePlugin already
       said "the destination itself says so when it is called". It did not;
       the intention was written next to the code that was supposed to carry
       it, and not carried;
    3. `loadProcedures` calls `existsSync`, and a service worker has no disk
       — the polyfill has no such function, so the constructor threw.
    Each fix uncovered the next, which is what a guard written at the bottom
    rather than at the boundary does. It answers `200 {"engine":"none"}` now,
    and the guard asserts that rather than allowing the 500.
  - `uncaught: Cannot read properties of undefined (reading
    'appSpecificRoute')` — **fixed 2026-09-19**, and it was **not ours**, as
    the first version of this entry claimed. It is inside
    `sap/ushell/library-preload.js`, and there is nothing of ours between the
    page loading and the throw. Measured by entry: an empty hash throws once
    and `#Shell-home` throws not at all, with the same 96 tiles; every real
    intent opens cleanly either way; an intent that does **not** exist throws
    the same thing twice, which is the shape of the underlying fault and is
    theirs. The launchpad sets `#Shell-home` before the bootstrap runs —
    choosing the entry that works out of two the shell offers.

  **How it was nearly filed as "does not reproduce".** The first look read
  the console of the public preview and found one error and zero bad
  responses, which said "no". It said no because the page had **not run**:
  an ephemeral browser profile has no durable storage, the service worker
  cannot register, and `web/index.html` renders "the preview could not
  start". A second look with a persistent profile rendered 96 tiles — and
  counted tiles rather than responses. Two probes, each blind to what the
  other saw, and the conclusion came from the union of their blind spots.
  The guard below is what settled it.

  `test/e2e/preview.spec.mjs`, "the launchpad's console and network,
  characterised": it waits for the worker, proves the tiles rendered, and
  then names every refused request and every console line that is ours. It
  goes red on a fourth thing, and red when one of the three is fixed — an
  allowance that outlives its defect is the failure this shape is for.
- **G.9, the remainder** — **done 2026-09-19.** Sort by clicking a column
  (and round again on the second click, with an arrow saying which way), and
  a key cell that opens the one row it identifies. The drill-down is
  deliberately **not** a second way of reading a row: it is the filter that
  already exists, so the record a person opens is read by the same path as
  the list they opened it from and the two cannot disagree. Every link is
  built in one place and keeps what the person already chose, because four
  places drift and the first to drift silently drops a filter somebody typed.
  The sort column is read against the entity's own fields, the same rule as
  the filter, so a name that is not one never reaches the dynamic ORDER BY.
- **E.4**, the Zork console not fitting its box.
- **B.14** and **B.15**, one build each.
- then **D.3**, the signature → metadata graph, since D.1 put the channel
  under it. **Half done**: the channel answers the resolved type closure;
  the codecs are the bridge's half. And the premise the entry rested on was
  false — there is no `ADTRestGraph` in the bridge, so the contract is ours
  and declared rather than matched.
- and out of D.3, **the data preview's own types**: a table field typed by a
  data element showed no type and no letter at all, six of 1041 in this
  tree. Fixed with the same resolver.

**Together, next**: **B.1**, SADL beyond read-only — the largest of the
waiting ones, split by read and write. This session takes **reads**
(associations in a projection); fable-osd takes writes when B.9 is done.

**Deliberately not taken**: **B.18**, the release bundle 3.5x slower. The rule
"no performance number is taken through a release bundle" already closed the
harm, and closed harm is a poor reason to hurry.

**The SQLScript front end is paused**, and the line is a property rather than
a percentage: **no body silently computes a different program.** Where it
stands at the pause — 78 of 364 bodies reach an engine; of the rest, **174
are blocked by the imperative shell** we decided at the outset not to
interpret (54 calls of another procedure, 51 FOR loops, 21 writes, 17 WHILE,
15 CALL) and 111 by relational SQL not yet written. So the ceiling without an
interpreter is 190, and the cliff has been descended: **no construct left in
the relational remainder is worth more than eleven bodies.** What follows is
a tail, and each step of it costs what the last one did and buys a third as
much.

## Status, 2026-09-19 — what closed, and what the day cost

150 commits between two sessions. The list below is what moved; the reasons
live in the entries further down and in
[`docs/retro-2026-09-19.md`](retro-2026-09-19.md).

**Closed today**

| item | what it means now |
| --- | --- |
| **E.4, E.5** | the public preview has an empty complaint list; the console was measured, not guessed, and the launchpad lands on an intent |
| **G.9** | sort by clicking a column, open a row by key — read through the same filter the list uses |
| **G.10** | the SQL trace: a bounded ring in the host, an analysis (`npm run sql:summary`) and a screen at `/sap/bc/osd/st05/` |
| **G.8 wave 2** | an object is edited, checked and activated from a screen, through the same store the ADT façade writes through |
| **B.9** | a forced build compares and reports; the build is byte-for-byte reproducible, 2249 of 2249 files |
| **B.14, B.15** | a cast over a real column is a column; a view entity goes through, and every build now proves it |
| **B.1** | associations survive a projection (read); a projection of a writable view writes through to the table (write) |
| **D.3, first half** | the channel says what a DDIC type *is*, resolved through the domain |
| **W.1** | all three parts: the journal, the branch plumbing, and the SQL sieve |

**Numbers worth keeping**

- the unit run's database work: **6793 → 1711 statements, 1563 → 446 ms**
- a generation is now a function of the tree, not of its build history:
  a fresh tree builds once (9.5 s) and the **second build hits the cache**
  (0.16 s). It never did before.
- SQLScript: **78 of 364** corpus bodies reach an engine; **21 constructs**
  agree with SAP's own compiler on one HANA
- a clean worktree, empty `$HOME`: **0 failures** across unit, integration
  and the browser suites

**Five silent corruptions found and refused in one day** — GROUP BY, HAVING,
DISTINCT, EXCEPT/INTERSECT and qualified columns in the SQLScript front end,
a `WHERE` dropped from a CDS view, and a CDS view checked by nobody. Every
one of them parsed, lowered or passed, and computed something else.

**Still open, in the order we would take them**

- **G.8 wave 3**, the CDS half of the editor: activation for a view means
  running `cds2ddic`, not only transpiling — a class edit changes one object,
  a view edit changes three generated ones, and "what counts as activated"
  is a different question there
- **D.3 second half**, the type graph on `/sap/bc/osd/rfc/functions/<NAME>`
- **B.18**, the release bundle 3.5× slower than the same build — deliberately
  not hurried: the rule "no performance number is taken through a release
  bundle" already closes the harm
- **B.3** (OData V4), **A.12** (SRVD + SRVB), **D.3/D.4** (the RFC server
  whole), **G.6** (a screen out of a class interface)
- **incremental transpilation** — the only lever that moves the editor's
  ~12 s save, and not part of any wave

---

## The order of work, settled 2026-09-18

Alice asked for the queue to be sorted into three, and it was agreed between
the two sessions rather than decided by one. A bucket is not a priority
ranking: it says **what kind of thing an item is**, and the three kinds are
paid for differently.

**Loud per hour.** Every one of these is something a stranger can be shown.
1. **G.8, the AMDP sandbox and now the editor** — **wave 1 done 2026-09-18,
   wave 2 done 2026-09-19** (an object edited, checked and activated from a
   browser page, through the same store the ADT facade writes through).
   SQLScript that can be edited and run from the
   screen, which cannot be done in the original at all. It runs **fully on
   any deployment that has a server**: the i7 at 3030 with HANA Express
   beside it is the whole feature, nothing withheld. What it cannot reach is
   the **GitHub Pages preview**, and the reason is not the database and not
   a licence -- that preview is a service worker in a browser with no
   server, no process and no socket, so *no* backend of any kind is
   reachable from it, HANA, ClickHouse or otherwise. For SQLScript to run
   there it would have to run **in the page**, which is W.3 (DuckDB-WASM,
   or translating SQLScript to plain SQL). So the line to carry is "the
   public preview links to the deployment, not to a sandbox of its own",
   not "the feature is limited".
2. **G.9, the SE16-shaped data browser** — **wave 1 done 2026-09-18, wave 2
   done 2026-09-19** (a selection per field and a choice of columns, both
   through `zcl_stg_request_context=>where_for_option`, the same clause
   builder an OData `$filter` goes through). Deployed and read back on the
   i7. **Wave 3 done 2026-09-19** and the track is closed: sort by clicking
   a column, and a key cell that opens the one row it names through the
   filter that already exists rather than through a second read.
3. **W.1 minimum** — the request log, its replay and the first sieve.
   **Done 2026-09-19**: `tools/osd-replay.mjs` (`npm run replay`),
   `test/request-log.json` as a tracked list of calls rather than a capture,
   suite `test/replay-compare.mjs`. Calibrated the way W.1 asks — one system
   served **twice, in two processes**, silent — and every normaliser rule was
   put there by that run rather than predicted; the one it found was the
   process id in `zcl_osd_webgui`'s identity line. An approved difference
   takes a reason from the start. What is left of W.1 is the branch plumbing
   (a ref into a worktree, its own port and database file) and then the
   second sieve, SQL at the O.1 seam.
4. **G.10, the ST05-shaped SQL trace** — a screen over a log that W.1 will
   by then be filling, which is what makes it nearly free. **Done
   2026-09-19**, in three waves and in that order: the tracer at the seam,
   then the analysis (`npm run sql:summary`: where the request went, and
   what it did twice), then the screen at `/sap/bc/osd/st05/`. Written
   analysis-first on purpose — this entry's own warning was that a screen
   built first is a handsome page with no consumer behind it.

**This bucket is now empty, 2026-09-19**, which is worth saying rather than
quietly starting the next thing. All four are done, the two sessions took
roughly half each, and every one of them was demonstrated rather than
described: a data browser, a trace, a sandbox, an editor, and a branch of a
whole system with two sieves over it.

What would go in it next, ranked by the same rule — what a stranger can be
shown per hour — and **not started**:
- **G.5, SICF as a real application.** Half the model is already in SAP's
  own shape (`*.sicf.xml` carries URL, service, docu and an ordered handler
  table), and the tree already serves those nodes, so this is a Fiori
  Elements app over data that exists. The loud part is that a changed
  handler goes live with the recycle
- **G.6, a class with an interface becomes a screen** (the Neptune concept,
  Alice's name for it). The parse is in the process, so the input is
  already there; this is the one that turns the workbench into something
  people build *with* rather than look at
- **G.7, the screen from the keyboard.** Small, and it is the difference
  between a demo and a tool: a tree nobody can walk without a mouse is half
  a transaction
- and **W.2, the differential debugger**, which is the other bet and is now
  the only part of W.1's story that does not exist

**Small and safe.** Low risk, and each one removes a future evening.
- the exception that walked past the transactional bracket — **done
  2026-09-18**, and it was ours, not SAP's: see `docs/luw-buffer.md`
- B.14 (a cast in a CDS view drops the field), B.15 (does the pipeline read
  a view entity) — **both done 2026-09-19**, and they cost what was
  estimated: B.14 one build and a second attempt after the first fix was
  worse than the defect, B.15 no fix at all, because the answer was yes
- E.5, the launchpad asking for a config we do not serve — **done
  2026-09-19**, and the shape of the fix is the point: one body in
  `tools/osd-sandbox-config.mjs`, served by both express hosts and written
  as a file by the preview build, rather than three answers that would
  drift. It did show in the console of the public preview
- E.4, the Zork console not fitting its box — **done 2026-09-19**
- B.9, a forced build mutating a generation under its own name — **done
  2026-09-19**, and it found a real one: the generation's own config
  carried the builder's pid, so 1 file of 2249 differed. The promise in
  the hash-addressed name was true all along and one defect hid it
- `node tools/osd-inputs.mjs` after `src/luw` and `src/amdp` — one command,
  and it catches the silent name override that has cost an evening before
  (run 2026-09-18: two overrides, both intended and both named)

**This bucket is empty too, 2026-09-19.** Everything named in it is done,
and two of them turned out to be worth more than "small": B.9 found a
generation carrying the builder's pid, and the hash defect behind it was
then fixed at the cause (`gen/` was an input to the hash it produced;
the generators are the input now). What replaced this bucket during the day
came from doing the work rather than from planning it — a posted form that
arrives with no form fields, a unit run that could not say it had run
nothing — which is the argument for keeping the bucket rather than the list.

**Waiting its turn, and waiting is the right answer.** Structural work whose
cost is real and whose harm is already contained.
- B.18, the release bundle 3.5x slower than the same build. Not deferral:
  the rule "no performance number is taken through a release bundle" closes
  the harm, so the bundle is worth fixing and is not worth hurrying.
- B.6, the client and MANDT story — dormant, and W.1 makes it *more*
  dormant, not less: see B.6.
- ~~B.1 (SADL beyond read-only)~~ — **done 2026-09-19, both halves**: a
  projection carries the associations it re-exposes, and a projection of a
  writable view writes through to the table under it, with every link of the
  chain that refuses named. It came out of this bucket because it was split
  by read and write and taken by the two sessions at once
- B.3 (OData V4), A.12 (SRVD + SRVB)
- D.3 **half done 2026-09-19** (the channel answers a type's resolved
  closure; the codecs are the bridge's half) / D.4, the RFC server whole;
  G.6, a screen out of a class interface

**The SQLScript front end, which this list did not name and should.** It is
its own track (B.19 / the splitter docs), it has been the bulk of two
sessions' work, and it is measured rather than estimated, so it belongs here
where the estimates are. Where it stands, 2026-09-19:

- three stages exist — lexer, combinators in abaplint's shape, binder/typer
  — and the grammar is extended **by measurement**, not by a syntax list:
  `node tools/sqlscript/coverage.mjs` says how many corpus bodies go through
  whole, and `node tools/sqlscript/why.mjs "<histogram line>"` shows the
  bodies behind one line of it. The second tool exists because three times
  the top entry meant something other than its name
- the number that counts is **bodies that reach an engine**: 37 → **78 of
  364** (10% → 21%), re-measured 2026-09-19 at the pause. "Parsed" is 131
  and is not the same claim — the 53 between the two numbers parse and are
  then refused, which is the property the pause was declared on. The
  teaching corpus, the one a reader is likelier to meet, stands at **39 of
  101 (39%)**
- the denominator says what it was counted with: 364 SQLScript bodies of 372
  `BY DATABASE` ones, the rest `LANGUAGE GRAPH`, `SQL` and `LLANG`
- the comparison instrument has three numbers and only the third signs "no
  divergences found": 67 lower, 67 of 67 would force whole, **7** are
  actually run both ways and **0 of the 7** contain an expression that can
  diverge at all
- next by the histogram: `SELECT *` at the root, the ten "comparison without
  an operator", then `FOR` (which is two constructs under one token)

**What I would take after those** — written 2026-09-18 and kept as a record
of how well a queue predicts a day: B.1, D.3, then A.12. **B.1 and D.3's
first half were done on 2026-09-19**, and A.12 is still next. What the list
did not contain is most of what the day actually produced — the editor, the
trace, the branch plumbing, and four defects nobody could have named in
advance. A queue is worth keeping and is not worth believing.

> The numbered sections below ("The standing list", 0 to 8) are the older
> plan and stay as history; the tree above is the current one.
> [`plan-spikes-and-sprints.md`](plan-spikes-and-sprints.md) lays the
> sprints out, [`shift-right-and-quick-wins.md`](shift-right-and-quick-wins.md)
> has the value-against-cost table, and
> [`generations.md`](generations.md) is the mechanism that absorbed N4.

---

## Track A — ADT coverage surface

*Make more of what a real client asks answerable. The measure is not a count of
endpoints: it is how far an ordinary session gets before something 404s.*

The catch-all under the façade already records every unanswered path by method
(`Refusals`, `adt-surface.md`), so **the worklist writes itself** — run a
client, read what it asked for and did not get. That is the method for this
whole track; everything below is what it has produced so far.

```
A.1  Editor documents for the object types that have none                [S]
     ├─ FUGR, MSAG, DOMA, TTYP, VIEW, SHLP — each has its own editor format
     ├─ the object is already in the tree and in the search; opening it 404s
     ├─ test/zosd-test.mjs lists exactly which
     └─ order by what a client opens first, not alphabetically

A.2  Function groups and modules as create targets                       [S]
     └─ a group is a folder of includes with a header of its own
     └─ blocked on nothing; nothing has asked for one yet

A.3  Data preview                                                        [S]
     ├─ seen live 2026-09-15: Eclipse says "Data Preview is not supported
     │  in this system" on a CDS view served by us; A4H answers it
     ├─ /sap/bc/adt/datapreview/ddic?… and /datapreview/ddic/<T>/metadata
     └─ the SADL runtime already does the query half; this is the wrapper

A.4  The metadata bootstrap, proven live                            [R] DONE
     ├─ was: implemented and shape-verified offline, never run live, because
     │  the Eclipse that tested it had the answers cached
     ├─ done 2026-09-16 by pointing a plain RFC client (the `rfc` CLI in
     │  open-rfc-go) at the bridge: `rfc describe SADT_REST_RFC_ENDPOINT`
     │  returns the interface with both parameters typed
     ├─ it found a defect on the way: the gateway header's communication and
     │  connection index were constant. Eclipse never looks, an RFC client
     │  does, and refused every reply. A reply carries communication index
     │  zero and the connection index the call came in on — echoing the
     │  request's 0xffff "unset" is equally wrong
     ├─ and a gap: an RFC client resolves structures with RFC_METADATA_GET
     │  then RFC_GET_STRUCTURE_DEFINITION, not DDIF_FIELDINFO_GET. The
     │  latter is now answered from the same dictionary
     └─ STILL OPEN, and still shared with C.3: whether a client accepts
        uncompressed 0303 rows for a LARGE table. Both tables exercised so
        far are small enough that the system sends them uncompressed too

A.4b An RFC client that can CALL it, not only describe it                [R]
     ├─ `rfc call SADT_REST_RFC_ENDPOINT` stops in the client's own classic
     │  structure codec: "classic RFC type v is not implemented"
     ├─ this function's parameters are recursive and travel as BASXML; the
     │  client has that codec (internal/xrfc) but `rfc call` does not use it
     └─ the bridge is not in the way — this is client work, and it would make
        the bridge drivable from a script as well as from Eclipse

A.5  Stateful session affinity across parallel connections               [R]
     ├─ Eclipse opens many RFC connections at once; each gets its own cookie
     │  jar and CSRF token today, which is correct for isolation and wrong
     │  for a lock/write/activate that must land in one ADT context
     ├─ the real client carries sap-adt-connection-id; we do not use it
     └─ needed before writes-over-RFC are trustworthy, not before reads

A.6  Debugger endpoints                                                  [S]
     ├─ debugger/listeners is a long poll and the second most frequent call
     │  in a real session; breakpoints is a POST
     ├─ answering them emptily is most of the value: it stops the client
     │  retrying, and debugging can stay unimplemented for a long time
     └─ **the message schemas are shared with O.2** and the two must be
        written together. A.6 is us *answering* `debugger/listeners` and
        `breakpoints`; O.2 is us *calling* the same endpoints on A4H to
        record a step trace. Done apart, the schemas get written twice and
        drift. Note also that the entry carries two different sizes under
        one number: answering emptily is small, being the oracle's client
        is not

A.7  ATC, refactorings, quick fixes, where-used                          [S]
     └─ not started, not blocking; listed so a 404 reads as a plan

A.10 What the client complains about while it works                      [S]
     Free findings: with CDS data preview and the package tree working
     (2026-09-16), Eclipse's own Workspace Log still carries three OSD
     complaints. None of them stops anything today; each is a thing the
     client wanted and did not get.
     ├─ "Couldn't get URI from discovery for CDS Annotation ADT Resource",
     │  repeated on every CDS editor open. A4H answers
     │  /sap/bc/adt/ddic/cds/annotation/definitions with 188 KB of CDATA —
     │  the annotation grammar, which is what feeds code completion and the
     │  syntax colouring of @-annotations in the DDL editor. We answer 404.
     │  Note before copying: that document is SAP's own content, so it is
     │  not ours to bundle (clean-room, CLAUDE.md). What we can serve is the
     │  annotations our own runtime understands, which is a smaller and
     │  honest document
     ├─ "Properties file content do not contain an entity tag for the source
     │  file" (determineEtagForSourceFile), on every source open. Our
     │  source-properties document carries no ETag at all
     │  (tools/adt-source-properties.mjs); the source response does. Cheap,
     │  and it is the value the client wants to send back on a save
     └─ "An exception occurred invoking extension
        com.sap.adt.semanticfs.packageContent" for the project object, with
        "Unhandled event loop exception" beside it. Unread; the semantic
        filesystem asks for package content in a shape we have not measured

A.9  Creating an object: two dialogs, and only one of them is read   [S]
     There are two, and they fail differently — worth keeping apart,
     because conflating them cost a wrong conclusion once already.
     ├─ the GENERIC wizard, "New ABAP Repository Object", still says "No
     │  authorization to create objects in the system" and asks us
     │  NOTHING: no request reaches the façade when it opens, and there is
     │  no authorization check anywhere in what Eclipse sends a real
     │  system either. So it decides from what it holds, and what that is
     │  has not been found yet. Unfinished.
     └─ the TYPE-SPECIFIC dialogs — New ABAP Class, and Copy ABAP Class
        from the object's own menu — open fine and get as far as the name
        check. That is where the measurement below comes from.
     Measured 2026-09-16 with STG_ADT_DUMP:
     ├─ A.9a POST /sap/bc/adt/oo/validation/objectname                   [S]
     │  ├─ 404 here, and it is what the dialog reports. The client asks
     │  │  before it will enable Finish, with objname, packagename,
     │  │  description and objtype=CLAS/OC in the query and nothing in the
     │  │  body. The same call gates Copy ABAP Class
     │  └─ the answer is a short document saying whether the name is free
     │     and legal; the store already knows both (exists(), and the name
     │     rules it enforces on create). Small, and it unblocks create
     ├─ A.9b Save failed: "Cannot invoke java.util.Map.get(Object)
     │  because exceptionProperties is null"                             [S]
     │  ├─ a client NPE, not a message from us: it is reading the
     │  │  properties of an exception document and finding none. Saving an
     │  │  include reproduced it
     │  └─ our exceptionDocument writes <properties/> empty; A4H's carries
     │     entries. Compare against the corpus before guessing which
     ├─ A.9c "Loading outline failed" on an interface                    [S]
     │  ├─ "Index 0 out of bounds for length 0" in
     │  │  AdtStructuralInfoService.mergeOutlineContentWithRndBasedOutline
     │  ├─ the client merges OUR objectstructure with ITS own parse of the
     │  │  source, and one of the two came back empty. A class outline
     │  │  works, so it is the interface shape
     │  └─ not in the dump yet: the failing project reaches us over RFC.
     │     Re-run with the dump on that project
     └─ A.9d two more misses from the same session                       [S]
        ├─ GET /sap/bc/adt/functions/groups/<name> — the FUGR editor, A.1
        └─ GET /sap/bc/adt/oo/classes/<name>/includes/localtypes — a class
           include we do not carry. A real class has all four includes
           whether or not they have content

A.8  CTS                                                                 [S]
     └─ deliberately absent: there is no transport system here, and the
        boundary to a real system is an abapGit archive from a git ref
```

---

## Track B — the runtime underneath

*Deepen what the answers are made of: OData, SADL, RFC, and the database seam.*

```
B.1  SADL beyond read-only                           [S]  DONE 2026-09-19
     ├─ today: CDS projections, an analytics cube, $select -> GROUP BY,
     │  and writes only on a projection of exactly one table
     ├─ **associations in a projection — done 2026-09-19.** `parseDDLS`
     │  reads one view at a time and a view's associations are the clauses it
     │  declares; a projection declares none, it re-exposes an element the
     │  view underneath declared. So `_Child` was collected as "exposed" and
     │  had nothing to be exposed **of**. Measured before the fix on a
     │  projection of a view with one association: the base came back with
     │  its association and the projection with none, silently
     ├─ it is a pass over all the views (`inheritAssociations`) rather than a
     │  line inside one, because the answer is in a different file and
     │  `parseDDLS` never has two. The inherited association names the view
     │  it came from, and one whose ON column the projection **renamed** is
     │  refused by name rather than emitted with pairs that name a column the
     │  target does not have
     └─ next: a write path that is not the single-table special case

B.19 HANA, AMDP and where each machine stands                            [S]
     Decided 2026-09-18 by arithmetic rather than preference.
     ├─ **HXE is up on the i7, 2026-09-18**, and the first AMDP body ran
        in it end to end: `ZCL_VSP_00_AMDP_TEST=>CALCULATE_SQUARES` cut out
        of the class, deployed as a procedure and called, returning the
        five squares. Startup 169 s, instance HXE/HDB90, SYSTEMDB 39013,
        tenant 39017.
        ├─ **the load-bearing assumption is confirmed and is generous**:
        │  `CREATE PROCEDURE` refuses a missing table and names it *with a
        │  position* - `Could not find table/view NO_SUCH_TABLE_HERE in
        │  schema OSD: line 3 col 44`. So HANA is the oracle for which
        │  tables a body needs, and no SQLScript parser is required.
        │  `SYS.OBJECT_DEPENDENCIES` then lists it, which is the
        │  after-the-fact completeness check
        └─ **snapshots need no work**: HXE persists under `/hana/mounts`,
           the one directory the recipe says to bind, so the database is
           already outside the container - 3.7 GB there against 73.6 kB in
           the writable layer. That is the property `~/dev/a4h/a4h-lite.sh`
           had to be written to get for A4H, whose image keeps 38.3 GB in
           the writable layer. A save/restore script in its spirit is worth
           having when we start wanting clean states between experiments;
           until then it is not needed. (Alice, 2026-09-18: "это если прям
           надо - можно и попозже")
     ├─ **decided 2026-09-18: `STG_DB=hana` is the AMDP mode.** Alice:
        "работать целиком на хане имеет смысл если мы веселимся с AMDP и
        там всё мило и красиво бежит". So HANA is not a general backend
        and not a default - it is the mode you switch into when the work
        *is* AMDP, and in that mode everything falls out:
        ├─ the procedure and the tables are in **one database**, so the
        │  mirroring question disappears entirely, along with the
        │  iterative "create, read the error, mirror, retry" plan. That
        │  plan stays written down because it is what you need when the
        │  data layer is *not* HANA, which is every other mode
        ├─ `sy-dbsys = HDB`, which is what a real system reports, so the
        │  oracle work gets a fidelity it cannot get any other way
        └─ and the cost is bounded and known, because it was measured
           before deciding (docs/db-backends.md): per **statement**, not
           per row - a 200-row SELECT is 3.8x the in-process cost, a
           single-row SELECT 52x, an INSERT 146x. Set-wise ABAP ports
           nearly free, row-at-a-time ABAP does not
     ├─ **the two pieces of work, in order**:
        ├─ **the DDL generator, and it does not exist anywhere**: the
        │  transpiler has real schema generators for SQLite, PostgreSQL
        │  and Snowflake and `hdb: ["todo"]` for HANA - a literal string.
        │  This is first because without a schema there is nothing to
        │  point a client at
        └─ **the client**: eleven methods on the npm driver `hdb`, the
           same shape as `tools/duckdb-client.mjs`. Three differences to
           measure rather than assume, the ones DuckDB taught us: the DDL
           flavour, trailing blanks in CHAR comparison, and savepoints -
           HANA has real ones, so that third one should be easier here
           than it was there
     ├─ **what HANA Express is actually for, Alice 2026-09-18**: it is
        **not** a database backend for OSD. It is the engine for one
        narrow case - **cut the AMDP body out of the ABAP class and run it
        in HANA Express**. The body is already valid SQLScript, so HANA
        executes it natively and we never write an interpreter for a
        second language. That is what makes the track cheap, and it is a
        different design from "a fourth DatabaseClient".
        ├─ it also settles the earlier question: transpiling AMDP is not
        │  on the table. Our own `ZCL_Z80_00_CPU_AMDP` - eighteen
        │  DECLAREs, thirty-six SELECTs and three loops in one procedure -
        │  is why
        ├─ **and it must not be the A4H HANA** (Alice, same day): that one
        │  is the sandbox everybody's oracle work depends on, and our
        │  schema has no business in it. HXE is the clean laboratory the
        │  entry always said it should be
        └─ the questions that design raises, none of them answered yet:
           ├─ **where the data is.** An AMDP body selects from tables.
           │  Those tables have to exist in HXE with our rows, so either
           │  the tables it touches are mirrored before the call, or HXE
           │  holds a copy of the schema. Which one is the first real
           │  measurement
           ├─ **how the procedure gets there.** On a real system the AMDP
           │  framework generates a HANA procedure from the method body.
           │  We would do the same: body plus signature in, `CREATE
           │  PROCEDURE` out, cached by a hash of the source
           └─ **how the call travels.** Transpiled ABAP calls the method;
              something has to bind the table parameters, call the
              procedure and read the result back. The npm driver `hdb` is
              the transport
     ├─ **an earlier reading of this entry, kept because the facts in it
        are still true**: a real HANA is reachable from the i7 today -
        premise of this item was that a HANA has to be stood up locally.
        There already is one, and it is reachable from the i7 two ways:
        ├─ `~/dev/a4h` is the landscape and carries the recipe: instance
        │  **02**, SYSTEMDB on **30213**, tenant **HDB** on **30215**, and
        │  the tenant holds the ABAP schema **SAPA4H**. Running
        │  `SELECT DATABASE_NAME, ACTIVE_STATUS FROM M_DATABASES` through
        │  the documented `ssh <host> "docker exec <container> su - hdbadm
        │  -c 'hdbsql ...'"` route answers `SYSTEMDB YES` / `HDB YES`
        ├─ and **both ports already answer on the i7 itself**, forwarded
        │  by the long-running `tools/osd-tcp-forward.mjs`: a TCP connect
        │  to `127.0.0.1:30213` and `:30215` succeeds. That process is
        │  therefore **load bearing, not the idle leftover it looks like**
        │  - its capture file has not grown since 2026-09-14, but the
        │  forwarding is what makes HANA reachable from here at all
        └─ so what is left is a **database client**, not a database: the
           seam in docs/db-backends.md takes an eleven-method
           `DatabaseClient` and a fourth implementation needs no change
           anywhere else. Upstream's `packages/database-hdb` is a
           `todo.txt` naming the npm driver `hdb` and nothing more, so the
           work is ours, and it is the same shape as
           `tools/duckdb-client.mjs`
     ├─ **and the old correction stands: the HXE image was never pulled.** `docker images` holds exactly two,
        `sapse/abap-cloud-developer-trial:2023` (62.4 GB) and portainer;
        `docker ps -a` holds `a4h-107`, **exited four weeks ago**, and
        portainer. So the sentence below was the plan, not the state - the
        image has never been pulled. Anyone starting B.19 pulls it first,
        and should know it is a 1.8 GB download before anything can be
        measured locally. Note also that A4H exists here as a **local
        container** as well as at the address `.mcp.json` names; the
        container is stopped.
     ├─ **the corpus, measured on A4H 2026-09-18 through the vsp CLI**
        (`vsp query SEOMETAREL --where "REFCLSNAME = 'IF_AMDP_MARKER_HDB'"
        --top 5000`), which is the cheap question the peer session asked
        for instead of reading every class:
        ├─ **195 classes implement the marker** - which corroborates the
        │  194 recorded earlier from a different route. 167 SAP standard,
        │  22 `CL_ABAP_AMDP_MC_*` compiler fixtures, 3 partner namespace,
        │  and **3 customer classes**
        ├─ **the three customer ones are the interesting part, and they
        │  are all ours**: `ZADT_CL_AMDP_TEST`, `ZCL_VSP_00_AMDP_TEST` and
        │  `ZCL_Z80_00_CPU_AMDP`. The last one is a **Z80 CPU written as
        │  four SQLScript procedures** - `run_steps` alone is 148 lines
        │  with 18 DECLAREs, 36 SELECTs and three loops - and it is the
        │  hardest shape of AMDP there is: imperative, stateful, nothing
        │  like a wrapper over a view. So the corpus says both things at
        │  once: what SAP writes is largely portable, and what *we* wrote
        │  is not portable at all
        ├─ **the sampling caveat stands**: A4H is a delivered sandbox, so
        │  it cannot say whether third-party customers write AMDP. It says
        │  how SAP writes it, and it says what we ourselves wrote
        └─ **how SAP writes it, sampled**: 10 standard classes, 27 AMDP
           method bodies, cut out with a regex - **15 are one portable
           SELECT**, 10 use table variables or are imperative, 1 has no
           SELECT, 1 has several. That supports the thin-wrapper
           hypothesis below, with the caveats stated rather than buried:
           the sample is 10 of 167 and was not random, and the classifier
           treats `:=` as a table variable, so the imperative count is an
           upper bound
     ├─ **a measurement trap that cost the first answer**: `vsp query`
        documents `--top` as "0=all", and `--top 0` **silently returns
        exactly 100 rows**. The first run of the query above answered
        "100 classes, none of them customer", which is wrong in both
        halves, and the round number was the only clue. Alice spotted it.
        Pass an explicit large `--top`, and treat any result that is
        exactly 100 as suspect until a second page is checked with
        `--skip`
     ├─ **HANA Express runs in docker on the i7, and only there.** The
        workstation is WSL2 on a 31 GB Windows host, so the Linux side
        sees 15 GB by the default "half the host" rule; HXE wants 16-24 GB
        and would take all of it, leaving nothing for agents, transpiles
        and webpack - and a Windows reboot would take the database with
        the session, which has already happened once. The i7 has 125 GB,
        16 cores, 581 GB free and docker without sudo, and the image is
        1.8 GB compressed. Raising WSL's memory in `.wslconfig` to 24 GB
        is still worth doing, for the agents, not for HANA
     ├─ **the oracle already exists and it is A4H**: `sy-dbsys = HDB`,
        release 758, and **194 AMDP classes, 191 of them SAP standard**,
        readable through ADT (measured 2026-09-18). A separate HXE is a
        clean laboratory, not the source of truth
     ├─ what a real one looks like, read off A4H: `method … by database
        procedure for hdb language sqlscript using CdsFrwk_Open_So_Items_
        By_TaxR.` with a one-line body selecting from a **CDS view with a
        parameter**. A large part of the standard's AMDP is a thin wrapper
        over CDS rather than a table-variable engine, and CDS we already
        generate and read - so the portable share may be much larger than
        it looks. **Measure it before designing anything**: read all 194,
        cut the bodies out with our parser and count how many are one
        portable SELECT, how many use table variables, how many call
        calculation-engine functions, how many are imperative
     ├─ the parser is ready for that cut and it cost nothing: abaplint
        already swallows an AMDP body whole as one `NativeSQL` statement
        (verified by parsing a real class), so the body comes out by
        source position. `FOR HDB` is a string literal in one line of
        `method_implementation.js`, so `FOR DUCKDB` is a one-line grammar
        change - but see the next point before reaching for it
     ├─ **a dialect does not need a grammar fork**: a marker interface of
        our own beside `IF_AMDP_MARKER_HDB` picks the target, and the
        source stays legal ABAP that compiles unchanged on a real system.
        Forking abaplint's grammar for a non-standard `FOR <db>` is a
        divergence in the language itself, which is worse than the carried
        patches we just spent a day getting rid of
     └─ **not inside HANA**: XS Classic is SpiderMonkey at about ES5 and
        deprecated, and our runtime needs classes, async/await, BigInt and
        8893 top-level awaits; XSA is a separate application server that
        costs 3 GB+ to get a Node we already have. Co-location on one
        machine buys the missing network hop and nothing is lost

B.2  BOPF / RAP / drafts: one runtime, two front ends                    [S]
     ├─ **started 2026-09-18**, and the first two pieces are in:
     │  ├─ **a composition**: `@ObjectModel.association.type:
     │  │  [#TO_COMPOSITION_CHILD]` makes the target a part rather than a
     │  │  thing pointed at, and deleting the parent takes the children
     │  │  with it, in the one LUW the request is already in. The
     │  │  `#TO_COMPOSITION_PARENT` end deliberately does not cascade, the
     │  │  same asymmetry a BDEF has between `composition of` and
     │  │  `association to parent`. ZC_STG_TRAVEL / ZC_STG_BOOKING is the
     │  │  worked pair; docs/cds-writes.md
     │  └─ **a transactional bracket, which turned out to be missing
     │     entirely**: nothing in this system ever committed. All three
     │     database clients implement begin/commit/rollback, so the whole
     │     server ran inside one transaction that ended at disconnect.
     │     A `$batch` changeset is now one LUW - a `COMMIT WORK` fences
     │     off everything earlier (the rows the boot writes, an earlier
     │     part of the same batch), then the changeset either commits or
     │     rolls back as a whole. Without the fence a failing changeset
     │     would have undone the process's entire uncommitted history.
     │     The test was checked by removing the rollback and watching it
     │     fail, which is the rule this repository learned the hard way
     ├─ **the parts are readable at runtime**: `ZIF_STG_CDS_COMPOSITION`,
     │  implemented by the generated source class of a view that declares a
     │  child and by no other, so the runtime asks with a cast and carries
     │  on when the cast fails. `children( )` answers the navigation a
     │  client sees, the child view, and how a parent key becomes a child
     │  key. Unit-tested by its content and by the child *not* implementing
     │  it, not by the fact that it compiles - an interface implemented
     │  with an empty method looks the same in a build as a working one
     ├─ **what blocks the deep insert, named so it is not rediscovered**:
     │  `zcl_stg_sadl_dpc` has no `create_deep_entity`, and a generic one
     │  cannot be written the way the demo's hand-written one is. The entry
     │  provider fills a **typed deep structure** - the demo declares
     │  `ts_travel_deep` in its MPC and the provider walks `is_set-navs`
     │  into it - and a generic DPC has no such type. So the next piece is
     │  either a deep structure built at runtime through RTTI (and whether
     │  the transpiler carries `cl_abap_structdescr=>create` with a table
     │  component is the thing to measure first), or a second path in the
     │  provider that hands the nested rows over untyped
     ├─ next in this track: the buffer proper (changes held in memory for
     │  the length of an interaction rather than written through), then
     │  draft. The order is the peer session's, and the argument is sharper
     │  than "cheaper first": a draft is **not a persistent buffer**, it
     │  stands on one. Activating a draft re-runs the behaviour - the
     │  validations and determinations - and that run happens in the
     │  buffer, so a buffer folded into the draft leaves the save sequence
     │  nowhere to happen. What does carry over is the **delta** (entity,
     │  key, operation, state after), which is designed serialisable from
     │  the first day: in a LUW it lives in memory, for a draft the same
     │  delta is written to a table keyed by the draft. Persistence is then
     │  a change of storage, not of model - and the browser preview, which
     │  has no process at all, is why persistence will come
     ├─ still out, as stated on day one
     ├─ oracles planned but not built: docs/oracle-rap.md, oracle-draft.md
     ├─ gated on 0.4 / 0.5 (Alice: build sample objects on the sandbox?)
     │
     ├─ **the order, decided 2026-09-18**: build the runtime once, shaped
     │  in RAP's vocabulary, and enter it first through CDS annotations,
     │  with a behaviour-definition grammar as the second front end.
     ├─ what decided it, measured rather than assumed: abaplint parses a
     │  BDEF with **one regular expression** that extracts the entity name
     │  and its alias (`objects/behavior_definition.js`) - no create/update/
     │  delete, no actions, validations, determinations, draft, locks or
     │  field control. The `@ObjectModel` annotations, by contrast, we
     │  already parse in full: virtual elements, writeEnabled and the
     │  analytics annotations all run on them today. So RAP's front end is
     │  a grammar to write and CDS-BOPF's is free
     ├─ the runtime is the same either way and is most of the work: a
     │  transactional buffer, the composition tree, draft, delegated CUD,
     │  locks, ETags. The choice is only which language describes it first
     ├─ the vocabulary inside is RAP's from day one, because a managed RAP
     │  implementation with `persistent table` + `lock master` says almost
     │  exactly what the CDS-BOPF annotations say (`transactionalProcessing
     │  Enabled`, `writeActivePersistence`, `writeDraftPersistence`,
     │  `association.type: [#TO_COMPOSITION_CHILD]`, `transactional
     │  ProcessingDelegated` on the consumption view). Cheap front end,
     │  modern model
     ├─ writing the BDEF grammar against a runtime that exists is far
     │  easier than designing both at once - and it is a real contribution
     │  to abaplint when it comes, which is a reason to do it second and
     │  not first
     └─ first milestone, and it is visible: a **draft-enabled Fiori app**
        over one composition - header and items, create, change, activate -
        declared in annotations, the machinery ours, checked in a browser

B.3  OData v4                                                            [S]
     └─ the serializer is v2; v4 is a second shape over the same model, and
        nothing in the dispatcher assumes v2 except the JSON writer

B.4  The RFC runtime, both directions                                    [R]
     ├─ today: destinations resolve local / replay / live / record / fallback
     ├─ the bridge is an RFC *server* for exactly one function module
     └─ next: serve more than SADT_REST_RFC_ENDPOINT, so a real RFC client
        (SM59 test, an external caller) reaches a transpiled function module

B.5  Multi-record framing, properly measured                             [R]
     ├─ splitting works and a 606 KB answer was accepted in two records
     └─ but the operation-info length on a *continued* record is inferred
        from single-record captures; capture a real long answer and check

B.6  The client/MANDT story — dormant, with a detector to build      [S+T]
     Re-read 2026-09-18 by the workstation session, acting as critic, and
     the label was wrong rather than the place in the queue.
     ├─ the facts are unchanged: fixed client 123, no implicit MANDT
     │  (ANORMALIES.md). The demo keeps T0009 visible on purpose
     ├─ **but upstream considers the question closed by design**: in
     │  abaplint/transpiler#606 Lars answers "or just ignore it, the runtime
     │  does not need a client, run several instances" — and running one
     │  instance per client is exactly what we do. So this is not a
     │  first-order risk today; it is a **dormant property**
     ├─ it wakes on exactly two events, and neither is in the queue: one
     │  runtime serving more than one client, or running a customer's real
     │  DPC that branches on `sy-mandt`. That is why it sits below G.5/G.6
     │  and that is correct — what was wrong was calling it an alarm
     ├─ **turn it into a detector rather than a standing worry**, the way
     │  `npm run leak` was made: fail the build when transpiled code reads
     │  `sy-mandt`, or when a SELECT hits a CLIDEP table with no explicit
     │  client condition. An alarm nobody touches for a year does not work;
     │  a check does
     └─ and W.1 lowers it further rather than raising it (fable-osd,
        2026-09-18): a client is SAP's own multi-tenancy -- one instance,
        several isolated sets of data -- and a **branch** answers exactly
        that need here, with its own database, its own seed and its own
        port. We get the isolation from a file rather than from a column,
        and the better W.1 works the less MANDT is wanted. HANA does not
        change this either, with one caveat that is not about MANDT at all:
        two branches on one HANA server must sit in different schemas, or
        the isolation-by-file property stops holding there (W.1)

B.8  SICF and SM59 as applications — **merged into G.5**, see there      [S]
     ├─ Alice, 2026-09-16: a SICF editor over the *.sicf.xml / *.sapc.xml the
     │  tree carries (tools/osd-icf.mjs already lists and mounts them), the
     │  way src/segw is SEGW as an application over its own tables
     ├─ a node may point at an ABAP handler (if_http_extension, served by the
     │  child through the shim, as today) OR at a JS — later maybe Go —
     │  implementation: the door (POST /osd/sql) is already a node answered
     │  by JS, so the shape exists; missing is declaring it in a *.sicf.xml
     │  and an editor over the set
     ├─ SM59 in the same manner later: destinations as objects with an
     │  editor, over the .local/rfc-destinations.json the RFC runtime reads
     │  (local / replay / live / record / fallback); track D's gateway makes
     │  the outbound half real
     └─ **merged 2026-09-18.** This entry and G.5 describe the same work in
        two tracks, which is how a thing gets built twice by two owners.
        G.5 carries the fuller specification (Alice, 2026-09-18) and is the
        surviving number; the two ideas that live only here — a node that
        may point at a JS rather than an ABAP handler, and SM59 later —
        move with it. Nothing new starts under B.8

B.9  A forced build mutates a generation under its name                 [S]
     ├─ Astra, 2026-09-16: `--force` replaces the directory build/by-input/<hash>
     │  holds, so a consumer pinned to that name sees changed content under
     │  an unchanged name, which is what immutability was for
     ├─ since 2026-09-16 the swap is two renames (no moment without a live
     │  generation), and the rule that decides the output is part of the
     │  hash, so a forced build differs from the cached one only when the
     │  transpiler or the builder changed under the same inputs
     └─ DONE 2026-09-19: a forced build compares and reports. Identical ->
        the name keeps its bytes and nothing is written. Different -> it is
        a FINDING, said out loud and not overwritten; `--replace` takes the
        new bytes under the same name, in so many words.
        **Measured before any of it was written, because the answer was not
        known**: two forced builds of one generation differed in **1 of 2249
        files**, and the cause was single -- the builder's own process id,
        baked into the copy of `abap_transpile.json` the generation carries
        (`output_folder: build/tmp/<hash>.<pid>/output`). An artefact
        addressed by the hash of its inputs must not carry the number of the
        process that wrote it; nothing reads that copy after the build, so
        it now describes itself (`output_folder: "output"`). With that gone
        the build is byte-for-byte reproducible, twice in a row, 2249 of
        2249 files. So the promise in the name was true and one defect was
        hiding it -- a repair, not a property to rewrite.

B.10 The base image is named by the schema alone                  [S]  DONE 2026-09-17
     ├─ Astra, 2026-09-16: .local/db/base/<schema-hash>.sqlite; a change to
     │  the seed rows (data/*.tabu.json) or to the seeding rules with the
     │  same DDIC keeps the name, so a new instance copies old rows
     └─ the identity is schema + seed data + the loader that applies them;
        a persistent user database is never reseeded by this, only the
        image a new database is copied from
     └─ DONE 2026-09-17 with B.13: the image is named by the schema and
        the rows that went into it, and the tables the generation writes
        at start (tadir, wwwparams, t100) are rewritten from the
        generation on every boot over an existing file

B.12 One work process, and a channel that never waits                    [S]  pool DONE 2026-09-16
     ├─ tools/osd-pool.mjs: OSD_WORKERS children, a push channel pinned to
     │  one for the life of its socket, HTTP on the primary. Deployed to
     │  the second machine with four: over the network 111 frames/s on one
     │  socket, 369 on four, three processes busy at once instead of one
     │  core at 100 %. Nothing in the ABAP or the page changed. Still open
     │  below: HTTP across workers (needs a decision about what a session
     │  is), and the page's missing back-pressure, which is the demo's
     ├─ measured 2026-09-16 on a 16-core machine: one core at 100 %, the
     │  other fifteen at 1 %, load average 1.04. The serving runtime is one
     │  process with one JavaScript thread, so every session's ABAP runs on
     │  the same core — that is one dialog work process, not a pool
     ├─ a frame costs 0.7 ms direct and 1.3 ms through the façade on an idle
     │  server; with a second session playing the demo it is 55 ms at the
     │  median. The cost is contention, not the ABAP
     ├─ and the demo's page never waits: it fires a frame request every
     │  24.6 ms and draws whatever comes back. Over a slow link 247 requests
     │  produced 43 drawn frames and 205 outstanding, replies 4 s behind —
     │  which is why an effect plays slowly and the next one rushes. Two
     │  independent defects: no back-pressure in the page, one core here
     ├─ the client's fan-out buys nothing, which is the proof: the demo's
     │  PRELOAD pulls frames on four sockets at once, and the server stays
     │  at one core (109 % of one, the rest of sixteen idle). Measured on an
     │  idle server here: 474 frames/s on one socket, 599 on two, 491 on
     │  four — flat, and four sockets are slightly worse than one. Four
     │  throats, one work process
     ├─ the pool: the supervisor already owns process lifecycle (recycle,
     │  reap, registry), so N children with sessions pinned to one of them
     │  is the shape — SAP's dispatcher and its dialog work processes, and
     │  what makes APC and the ABAP Daemon Framework scale on a real system
     └─ for this demo specifically a frame is a pure function of (demo,
        tick) through the JSON path, so the per-session state that matters
        is small (which demo, running or not) and frames are cacheable by
        key — the page already has a CACHED mode

B.11 The binary beyond the checkout                                      [S]
     ├─ **two defects the binary's own suite caught on 2026-09-19, and both
     │  are about a path taken from `import.meta.url` inside a bundle** --
     │  the thing CLAUDE.md warns about, in two new places:
     │  ├─ **every main-guard fired.** `process.argv[1] &&
     │  │  import.meta.url.endsWith(argv[1].split("/").pop())` is right for
     │  │  `node tools/x.mjs` and true in EVERY module of the binary, where
     │  │  the shared url ends in `/osd` and argv[1] is the binary: the
     │  │  first such module the bundle evaluates runs its own `main()` and
     │  │  the binary becomes that tool. `build/osd doctor` answered
     │  │  "no packs: nothing in packs". Twenty files carried the form; it
     │  │  had been waiting for an import that changed the evaluation order.
     │  │  Fixed with `runsAs("<file>.mjs")` in `tools/osd-main.mjs` -- the
     │  │  name is a **literal**, because it cannot be derived from a url
     │  │  there is only one of. `test/osd-main.mjs` keeps the form out, and
     │  │  went red on its first run against the helper's own comment, which
     │  │  quotes what it replaces
     │  └─ **the binary and node can no longer name the same generation**,
     │     and it is not the stale binary it looked like: since `267f9a7`
     │     the hash covers the generators, and `generatorClosure()` walks
     │     `fileURLToPath(new URL(".", import.meta.url))`, which inside the
     │     binary is `/$bunfs/root/`. Measured: editing `tools/cds2ddic.mjs`
     │     moved the node hash and left the binary's unchanged. Open, and it
     │     belongs to the hash's design rather than to the binary: either
     │     the closure is read from the tree being served, or the equality
     │     of the two hosts stops being the property that test asserts
     ├─ measured on a second machine 2026-09-16 (bun-spike.md part five):
     │  the Bun binary needs nothing; the Node hosts need a closure of four
     │  packages beside the workspace, because generated code imports the
     │  runtime by name and setup.mjs imports the database adapter, and
     │  neither is bundled outside Bun. scripts/make-release.mjs assembles
     │  a directory that works for all of them
     ├─ what still travels beside any host: src/, webapp/, data/ and the
     │  setup hook — OSD's own content, which wants to be a pack of its own
     ├─ SP4 (bun-spike.md part three) runs the workbench from one binary
     │  with the checkout as its workspace; a directory with only ABAP in
     │  it needs src/, webapp/, data/ and test/setup.mjs brought along —
     │  that is E.2, and the boundary is recorded rather than tested around
     ├─ not measured: other platforms (each needs a native run), APC over
     │  the binary, TLS, the preview build; the parent's 500 MB RSS is the
     │  store's parse plus the bundle and wants a look
     └─ `osd doctor` lists runtime classes the bundle renamed; a bundler
        change that renames another one shows up there first

B.7  Database seam                                                       [S]
     ├─ SQLite, DuckDB and sql.js today; a third needs no change elsewhere
     │  (docs/db-backends.md). bun:sqlite is 1.1, gated on 0.1
     └─ **DuckDB is parked entirely, 2026-09-18 (Alice)**: "можно
        полностью забыть пока - мы его исследуем когда прям необходимость
        появится острая. То есть далеко в будущем."
        ├─ what that means in practice: `tools/duckdb-client.mjs`,
        │  `STG_DB=duckdb`, `npm run unit:duckdb`, `npm run start:duckdb`
        │  and `npm run bench:cube` stay where they are and keep working;
        │  nothing is deleted. What stops is **investing** in it - no new
        │  features are measured against it, no defect in it is chased,
        │  and it is not a reason to shape anything else
        ├─ **it does not get in the way, checked rather than assumed**:
        │  `npm test` is lint + unit + integration and none of them touch
        │  it. `test/setup.mjs` imports `tools/duckdb-client.mjs` only
        │  behind `STG_DB === "duckdb"`, a dynamic import inside the
        │  branch, so the default build never loads it and
        │  `@duckdb/node-api` is not on the default path at all. Alice,
        │  2026-09-18: "если лежит и есть пить не просит и не мешает - то
        │  ок", and if it ever does get in the way of a build or a test,
        │  it goes to a branch or is ignored rather than fixed
        ├─ the upstream branch `feat/database-duckdb` (PR #1835 in
        │  abaplint/transpiler) is Lars's to merge and needs nothing from
        │  us; `npm run parked` keeps naming it, which is correct
        └─ do not confuse this with B.19: HANA and AMDP are a different
           track and are not parked. DuckDB was the analytics engine
           experiment, HANA is the dialect a real system speaks
```

---

## Track C — the side quest: RFC in, DIAG out

*Answer SAP GUI on the dispatcher port with a screen. Start by showing one
picture and nothing else.*

The point is not to implement DIAG. It is that this project already speaks the
gateway half of a system's front door, and the other half — the one SAP GUI
knocks on — is a protocol we can already *read*. Answering it at all, even with
one static screen that says the guru meditates, turns "an OData runtime with an
ADT façade" into "something a SAP client connects to", and tells us exactly how
big the real thing would be.

**What the oracle says.** A SAP GUI logon against a sandbox was captured
through a passive tap (40 frames, dispatcher port 3200, kept under `.local/`,
never here):

- the conversation is **NI-framed**, like RFC, and opens with the same
  `ffffffff` route request;
- **30 of 37 payload frames are SAP-LZH compressed** — the `1f 9d` magic with
  algorithm byte `0x12`, the same container `pkg/sapcompress` in vsp already
  decodes;
- the handshake frames that are *not* compressed carry readable items: the
  codepage (`4110`, `utf-8`), the protocol level (`4103`), a session id.

```
C.1  Decide the smallest honest goal                                     [A]
     ├─ proposal: SAP GUI connects, gets a logon screen or a single dynpro
     │  carrying one message, and stays connected long enough to read it
     └─ non-goal, explicitly: a usable GUI, transactions, or input handling

C.2  Read the oracle properly                                       [R] DONE
     ├─ done 2026-09-16: docs/diag-notes.md. Frame = 8-byte header + body,
     │  body optionally SAP-LZH (flag in the header; setup frames are
     │  UNCOMPRESSED, so a stub needs no writer). Items are (type, id, sid,
     │  len, value); 0x10 APPL / 0x12 APPL4 / 0x0c end. The screen chrome
     │  (title, menu, geometry, session/status) is mapped
     ├─ the SAPGUI capability shipped (9d232e5) made SAP GUI actually connect:
     │  it sends an NI route request carrying _NAVIGATION=…;D_WB_ACTION=EXECUTE
     │  and waits for a screen. diag-catch records it and never replies
     └─ ONE unknown left: the DYNT/DYNT_ATOM field-item layout, the text
        *in* a screen. That is the gap between reading a screen and writing
        one, and it is what C.4 needs

C.3  The LZH *writer* question                                     [A] ANSWERED
     └─ answered by the measurement in C.2: a DIAG setup frame is sent
        UNCOMPRESSED (the header's compress flag is zero), so a stub needs
        no LZH writer at all. The writer stays a want for parity with a real
        system's traffic, not a blocker for C.4

C.4  A dispatcher listener that says one thing                     [R] DONE
     ├─ done 2026-09-16, and not the way it was sized: nothing had to be
     │  measured. open-diag-go's lsd already is a self-contained DIAG server
     │  with an embedded, scrubbed wrapper and a screen writer; one flag,
     │  -stub guru|spectrum, makes it answer every frame with one still
     │  screen and end cleanly on close (branch osd-stub there)
     ├─ measured with Eclipse: F8 on ZOSD_TEST_DEMO_PROG hands SAP GUI to
     │  :3201 with a reentrance ticket in the hello, and the guru is painted.
     │  Three client frames, each answered with the same screen
     ├─ the local lab: façade :3030, bridge :3301, stub :3201, one instance
     │  (01) on one WSL address; the Eclipse project is Custom Application
     │  Server with that host and instance
     └─ docs/diag-notes.md: the stub as built, and what the hello carries

C.5  One ticket, three doors: SSO across HTTP, RFC and DIAG               [S+R]
     ├─ measured: the GUI logs on by cookie (<LOGIN COOKIE=…/> in the hello),
     │  RFC has a credential tag for a ticket (0x0670, open-rfc-go writes it),
     │  HTTP takes it as a cookie. Every door exists; no authority does
     ├─ the façade mints a signed claim (user, client, issued, nonce; HMAC,
     │  60 s, single use) instead of 24 random bytes; the stub, the bridge
     │  and the HTTP middleware verify with the shared secret, offline
     ├─ then the bridge checks a logon for the first time, the stub knows
     │  who pressed F8, and a page on the façade can jump into SAP GUI the
     │  way Eclipse does
     └─ docs/diag-notes.md, "SSO across the three doors"; about a session-day

C.6  Then, and only then, decide whether it goes further                 [A]
     └─ a real DIAG server is a large thing; this track is allowed to stop
        at C.4 having proved the point
```

---

## Track D — the RFC gateway: expose every RFC-enabled function module

*The ADT bridge terminates RFC for one function module. Make it a real gateway
for all of them: an external RFC client calls any exposed function module of
this project as if it were RFC-enabled, and gets a typed answer.*

Added 2026-09-16 (Alice). The point is that the door is already open — the
bridge is an RFC server, it already answers RFC_GET_FUNCTION_INTERFACE and
carries typed parameters, and its DefaultDispatcher already has a working
STFC_CONNECTION handler, which is exactly "call a function module over RFC and
get a typed answer". What is hardcoded to the one ADT function becomes generic.

What already exists, and is why this is a track and not a project:
 - OSD transpiles and runs function modules today (FUNCTION z_osd_test_status_text
   in src/zosd_test/, a FUNCTION-POOL that runs).
 - the fugr importer already reads a module's signature from a *.fugr.xml
   (zcl_stg_segw_fugr, tools/segw-gen-mapping.mjs, ZSTG_FM_PARAM).
 - the bridge has both metadata halves (RFC_GET_FUNCTION_INTERFACE / DDIF /
   RFC_GET_STRUCTURE_DEFINITION answered) and the codecs that encode arbitrary
   typed values (internal/xrfc, internal/classicrfc, internal/structure).

**Correction, 2026-09-19.** This paragraph used to end "all currently driven
by one hand-built graph (ADTRestGraph)". **There is no `ADTRestGraph` in the
bridge** — fable-osd read the clone (HEAD `1a0e11b`) and searched three
spellings; none of them appear in any file. What the bridge has is
`pkg/graph`, which is a **code dependency** graph: `Node{id,name,type,package}`
and `Edge{from,to,kind}` with kinds `CALLS`, `REFERENCES`, `LOADS`,
`CONTAINS_INCLUDE`, fed from the ADT API, `CROSS`/`WBCROSSGT` and `D010INC`.
It answers who references whom, not what `ZOSD_TEST_STATUS` means.

So **there is no consumer with the contract D.3 was written to match**, and
the type closure is not an `Edge` — it is a name resolved to a value, and
forcing it into `REFERENCES` would produce a graph a codec cannot read a
letter out of without a second pass. The contract the channel answers is
therefore **ours, declared**, which is the honest version of the choice: an
invented contract wears somebody else's name, and the first reader believes
there is a second party to it.

Feeding `pkg/graph` from this tree is a separate and cheap thing if it is
ever wanted — `Node{id:"DTEL:ZOSD_TEST_STATUS", type:"DTEL"}` plus an
`Edge{kind:"REFERENCES", ref_detail:"FM:..."}` — but that is an **export into
a graph**, not the channel's contract, and the two should not be mixed.

The one genuinely new piece: a **signature → metadata graph** builder. Every
handler today is fed a graph made by hand; a generic gateway builds that graph
from the module's real signature (its parameters and their DDIC types). That is
the meat of the track; everything else is wiring what exists.

```
D.1  A generic "call this module" endpoint in OSD             DONE 2026-09-17
     ├─ ICF service ZOSD_RFC at /sap/bc/osd/rfc/: GET /functions,
     │  GET /functions/<NAME>, POST /call/<NAME> {IMPORTING, CHANGING,
     │  TABLES} -> {EXPORTING, CHANGING, TABLES} or {EXCEPTION}, all JSON
     ├─ tools/osd-fm-registry.mjs reads the *.fugr.xml the way
     │  segw-registry.mjs reads *.iwsv.xml, and writes gen/rfc/: the
     │  registry (TFDIR/ENLFDIR of this tree, with the signature) and the
     │  typed dispatcher — generated because the transpiler resolves a CALL
     │  FUNCTION's parameter list at transpile time and has no
     │  PARAMETER-TABLE
     ├─ the gate: no REMOTE_CALL = 'R', no call, twice over — the channel
     │  refuses with 403 and the dispatcher has no method for it
     ├─ an exception is a field of a 200, not an HTTP error: the call
     │  reached the module and the conversation is intact, which is what an
     │  RFC client is told; only a system failure is a broken call
     ├─ src/rfc/ (channel + if_http_extension + the SICF node),
     │  test/osd-rfc.mjs, test/unit/zcl_osd_rfc_test, docs/rfc-channel.md
     └─ NOT in it: the RFC wire, the SOAP envelope, authentication, and
        calling out through the same channel

D.2  Which modules are exposed, and finding them             half done 09-17
     ├─ DONE: the registry is derived from the *.fugr.xml of the content
     │  folders, and GET /functions is the catalogue — every module with its
     │  group, its remote flag, whether the tree implements it, whether it is
     │  exposed, and the reason when it is not
     ├─ open: RFC_FUNCTION_SEARCH answered from it (a name mask -> the
     │  matches), so SE37's remote test, an SDK, or another system's CALL
     │  FUNCTION … DESTINATION can discover them
     └─ open: mode c) Alice named: a switch that drops the remote-enabled
        gate and exposes ANY transpiled module — a regeneration with a flag,
        since the dispatcher is generated from the same list

D.3  The signature -> metadata graph builder          [R]  half DONE 09-19
     ├─ **done**: `tools/osd-type-graph.mjs` resolves a DDIC type name to
     │  what it is, and `/sap/bc/osd/rfc/functions/<NAME>` carries the
     │  closure as `TYPES`. The chain is DTEL -> DOMA (the element usually
     │  carries no DATATYPE at all: it names a domain) and TABL/TTYP ->
     │  components, walked. A type the tree does not hold is `UNRESOLVED` by
     │  name rather than defaulted to CHAR, which is what a caller would
     │  then encode with
     ├─ generated into `gen/rfc/` rather than resolved at run time, for the
     │  reason everything there is: the dictionary is files and the runtime
     │  has no files
     ├─ **left**: the codecs, which are the bridge's half (D.4)
     ├─ feeds the generic metadata handlers (RFC_GET_FUNCTION_INTERFACE, DDIF,
     │  RFC_GET_STRUCTURE_DEFINITION) so they answer for ANY module
     └─ and feeds the codecs, so import params decode and exports encode

D.4  The bridge becomes a generic RFC server                            [R]
     ├─ one handler for any unknown FM name: look up the signature (D.3),
     │  decode the imports, call OSD (D.1), encode the exports
     ├─ STFC_CONNECTION and RFC_PING already work; this generalises them
     └─ result: `rfc call <ANY_FM>` through the bridge reaches a transpiled
        module. A4.b's "rfc call needs the recursive codec" is the same client
        gap and is shared

D.5  mode b) the SOAP-RFC facade — likely the easiest first win        [S]
     ├─ /sap/bc/soap/rfc: a SOAP envelope naming the module and its params ->
     │  the result, HTTP-only, no RFC transport and no bridge in the path
     ├─ reuses D.1 directly; provable with curl; the classic way any
     │  RFC-enabled module is also a web service
     └─ a good place to START the track: it exercises D.1 + D.3 without the
        RFC framing, so the marshalling is proven before the transport is

Smallest first win: taken, 2026-09-17. D.1 is done over z_osd_test_status_text
and a second demo module written for it (z_osd_test_item_list: an optional
import, a scalar export, a TABLES parameter and a classic exception), reachable
by curl. D.3/D.4 put it on RFC, where `rfc call` and SE37 reach it. The three
modes Alice named map to: a) = D.4 (full RFC gate), b) = D.5 (SOAP-RFC),
c) = the switch in D.2.

What D.1 measured, and what the two faces still need: both need DDIC *types*
rather than type names — internal length, decimals, output length, the line
type of a table type as a structure — which is what D.3 builds and neither the
registry nor JSON needs. Both also need authentication (S_RFC per function
group) and a third state between success and exception, namely SYSTEM_FAILURE.
docs/rfc-channel.md has that list in full.

Recommendation: D.3 next, then D.5 on top of it. D.5 needs no transport work
at all and would then be a second envelope in front of a proven core.
```

---

## Track E — content packs and layers: what the tree is made of

*Objects come from more than one folder, and today the first one the disk
walk reaches wins, silently. Make the layering explicit, and make a pack
something you add without a rebuild.*

Added 2026-09-16 (Alice), to give the split document's piece E a track of
its own; the letters of the two lists agree from here on.

```
E.1  Ordered source roots, and a duplicate that does not keep quiet     [S]  DONE 2026-09-16
     ├─ one list, one order: the input_folder of abap_transpile.json is the
     │  layer order for the store and the builder alike, and the LATER
     │  folder wins, as 1.5 says (tools/osd-inputs.mjs `layers`,
     │  tools/osd-store.mjs `rootsOf`). Measured before deciding: the
     │  transpiler on its own writes the later folder's module last, while
     │  abaplint's registry in memory files the first and calls the second
     │  "already defined" — so the winner is decided here and not left to
     │  either. A library is not a layer: it fills only what no root has
     ├─ the builder hands the transpiler the winner only: every file of a
     │  hidden object goes into the build's exclude_filter, the manifest
     │  lists `overridden`, the log says "overridden: CLAS X: <file> hidden
     │  by local/used". Proven with the real transpiler over a two-layer
     │  tree: the winner's method in output, the loser's absent
     ├─ the same file name twice inside one folder is refused before a lock
     │  is taken, both files named (code DUPLICATE; test/osd-build.mjs)
     ├─ local/ is no longer one root: only listed folders are the system, so
     │  677 objects of local/abapgit, local/cpm, local/vivid-vibes left the
     │  ADT tree, which no build ever had. An import now appends its folder
     │  to the list (`Import#enlist`), the newest layer
     └─ `node tools/osd-inputs.mjs` prints overrides, duplicates and shadows

E.2  A pack is a directory, not a rebuild                                [S]  DONE 2026-09-16
     ├─ a pack is a directory with an osd-pack.json in it: ABAP (src/ by
     │  default), seed rows (data/), table definitions (src/ddic), a page
     │  (webapp/), a name and an order. tools/osd-packs.mjs is the only
     │  place that knows this, and everything else asks it
     ├─ found in <root>/packs/ and in every directory OSD_PACKS names (a
     │  pack itself or a container of them); layered after the folders
     │  abap_transpile.json lists, so a pack wins a name it shares and the
     │  build reports the override with both files (E.1)
     ├─ what a pack brings: its ABAP to the transpile and to the ADT tree
     │  as a package of its own ($VIBES, not $SRC), its rows to the seed,
     │  its tables to the DDIC lookup, its page to /app/<name>
     ├─ proven with the compiled binary: build/osd built before the pack
     │  existed serves its class through ADT, its rows through the door and
     │  its page over HTTP, with nothing rebuilt but the generation
     ├─ found on the way and fixed: a generator that read every layer
     │  picked up a CDS fixture under test/ and failed the build, so
     │  generators read content (src + packs), not layers; and cds2ddic now
     │  removes what it no longer generates, because a pack taken away left
     │  its table accessor behind and the next build failed on a table that
     │  did not exist
     └─ a pack that adds generated objects settles on the second build: the
        hash is taken before the generators run and gen/ is an input. The
        dev loop does that second build by itself

E.5  The launchpad sandbox asks for a config we do not serve   [S]  DONE 2026-09-19
     ├─ Alice, 2026-09-16, from the browser console on the second machine:
     │  GET /appconfig/fioriSandboxConfig.json answers 404 on every open,
     │  red in the console and harmless — the ushell sandbox looks for its
     │  own file before it takes window["sap-ushell-config"]
     ├─ the answer is not {}: the file the sandbox asks for is where the
     │  sandbox's own settings belong, so what it gets is the config, and
     │  the 404 stops as a consequence rather than as the fix
     └─ **one body, three hosts**: `tools/osd-sandbox-config.mjs` is the
        config, `tools/osd-serve.mjs` and `test/start.mjs` serve it and
        `scripts/build-preview.mjs` writes it as a file, because the
        preview has no server to ask. Three hand-written answers to one
        question is the shape that drifts, and this list already holds the
        case that proved it (the dialog step, written once next to one of
        its three callers)

E.4  The Zork console does not fit its box           [S]  DONE 2026-09-19
     ├─ Alice, 2026-09-16, from the launchpad tile: a long line runs past
     │  the right edge of the terminal frame instead of wrapping inside it,
     │  and the block cursor sits on its own line
     ├─ **it was arithmetic, not a CSS opinion.** xterm renders `cols` x
     │  `rows` at whatever the font measures and the element only clips it:
     │  100 columns of 16px Courier is about 960px, in a box declared 820px
     │  wide. Measured before the fix, in a browser: the drawn terminal stuck
     │  out **127px** past the drawn border. The box is sized by its contents
     │  now, so the frame is exactly as wide as the terminal it draws,
     │  whatever the font does — the one arrangement that cannot be half a
     │  column out
     ├─ the cursor was a consequence of the same thing: with the terminal
     │  wider than its box, a long line wrapped where nobody could see it and
     │  the prompt appeared to stand alone. The last line the machine writes
     │  is `>` with the cursor on it, asserted
     └─ `test/e2e/zork.spec.mjs` asserts **where the two boxes are**, not what
        the stylesheet says — a stylesheet that happens to be wrong would pass
        the second and fails the first

E.3  What a pack may carry                                               [S]
     └─ ABAP and DDIC (today), SEGW projects and CDS (today, through the
        generators), a Fiori app under webapp/ (2.10: a UI5/BSP object type
        so a client can deploy one), SICF and APC declarations (B.8)
     └─ a folder fetched from a repository at a commit, with an overlay
        (sources in the manifest, tools/osd-fetch.mjs) — DONE 2026-09-17;
        packs/o4d and packs/zork are the worked examples and the public
        preview builds from them

E.7  The oracle's leftovers (docs/frame-comparison.md, 2026-09-17)      [S]
     └─ Pages: the demo stops in the middle of plasma while the same
        build on the i7 plays the whole demo; the worker is one thread
        and plasma is 641 rectangles a frame — measure whether it is the
        page's back-pressure (B.12) or a worker error the page swallows
     └─ where the transpiled ABAP is slow: some effects run far below
        the system's speed on one core; profile a frame of plasma,
        julia_morph and the 4D cells in the runtime (node --cpu-prof on
        the serving child) before reaching for fast-math; the suspects
        are Float allocation per operator and the string templates that
        build every colour
     └─ sorted triangles: amiga_ball, amiga_ball_2, sierpinski sort by z
        without a second key, so equal depths paint in an order the sort
        chooses; the demo needs a tie-break key (a PR to vivid-vibes),
        and the runtime's SORT should be checked for stability against
        the kernel's on a table with many equal keys
     └─ ignition's seed chain and one line of copperbars: not traced
     └─ one worker against eight on a problem scene with the APC session
        pinned, to separate arithmetic and table order from state
        distribution (Astra)
     └─ 2026-09-17, later: with the console fix the browser demo reaches
        the frame before rotozoom (Alice); the stop moved, the cause is
        still unmeasured
     └─ work processes in the browser too (Alice): several workers
        behind the service worker, one runtime each, and a page that
        pulls frames over several sockets and interleaves them — the
        B.12 pool, in a browser. Idea only.

D.9  docs/adt-facade.md, the version #7880 links to               [S]  DONE 2026-09-17
     └─ Astra's docs/adt-facade-proposed.md (uncommitted, 2026-09-17) is
        the top half of the next version: the role for the abapGit
        roadmap, the object-type matrix, activation as it is now (the
        original still says fire-and-forget). Before it goes in: DOMA/TTYP
        rows say "no ADT route", persistence names STG_DB=file, the
        RFC bridge points at docs/adt-over-rfc.md, the DIAG sentence
        shrinks to the stub, the review scaffolding goes, the "Do not"
        cadence softens; and the client contract of the original stays
        below it (403/405, encoded names, in-the-tree vs runnable,
        STG_DB_STRICT, unit-run alerts, the shim's pseudo-headers).
        DONE 2026-09-17 evening: merged with the seven corrections, the
        client contract kept below; 696 -> 542 lines, leak scan clean.
        The draft file stays untracked until Astra drops it.

B.13 A new SMW0 object never reaches an existing database file    [S]  DONE 2026-09-17
     └─ found 2026-09-17 with the lsd pack: with STG_DB=file the rows of
        wwwparams are seeded when the file is created, so an object added
        to a pack later (ZLSD-MUSIC) is in the generation and not in the
        table, WWWDATA_IMPORT finds no parameters, and the page answers
        404 while a fresh database serves it. The seed (or the schema
        fingerprint) has to notice a generation's W3MI set changing, or
        the media rows should be read from the generation rather than
        from the table. Until then: delete the file (or use another
        STG_DB_PATH) after adding media to a pack.

U.1  The user's path, measured                                      [S]  DONE 2026-09-17
     └─ a fresh agent with only docs/using-osd.md brought a pack (a YAML
        service over its own table with seed rows, a CDS view with
        @OData.publish), served it on another port, changed a line,
        broke the syntax on purpose: 12 minutes, both services answered.
        What tripped, and what changed for it: the guide now names
        STG_PORT and STG_DB_PATH, says how a running server picks up a
        build (it does not: npm run dev recycles, npm start restarts),
        shows where the file shapes come from and the CDS service's
        naming (<VIEW>_CDS, <View>Set, upper-case properties), and
        reads a failed build's line; stg-compile --all now removes a
        gen/stg project folder no YAML declares (the pack's service kept
        being registered after the pack was gone). Report under
        .local/try/user-path-report.md. Left: the error text for a
        missing period points at the next statement (abaplint's wording);
        the failed line sits among the generators' output.

A.12 SRVD and a minimal SRVB: the service definition as an input       [S+A]
     └─ Alice asked 2026-09-17 whether to take CAP-like syntax; the
        answer is that ABAP already has it and it is native:
        `define service N { expose E as A; }` in a SRVD, with a SRVB
        saying V2 or V4. CAP is a Node/Java runtime with its own
        persistence and handlers - reimplementing it would add an
        application model no SAP system runs, against the rule that the
        same ABAP runs in a system's ICF
     └─ the work: parse the SRVD ourselves in a generator (the way
        cds2ddic reads DDLS), emit the YAML model, let stg-compile make
        the classes; read-only over OData V2, which is what our gateway
        serves. Roughly a day, almost all reuse
     └─ two rocks: the transpiler refuses object type SRVD
        (ANOMALY-2026-09-15-srvd-not-allowed, needs an issue) - the
        generator reads src/ itself, so the object only has to be kept
        out of the transpile input; and V4 naming is unmeasured, V4 is a
        track of its own
     └─ not in scope: BDEF, behaviour implementations, drafts, actions,
        EML - the write side of RAP is its own track
     └─ @OData.publish is the older path (the sandbox warns that
        DDIC-based CDS views are obsolete), so this is the one that
        stays

A.11 A service of several CDS views, without a hand-written class [S+A] DONE 2026-09-17
     └─ today: @OData.publish gives one view one service and no
        navigation (publishedYaml() in tools/cds2ddic.mjs never emits an
        association, though the parser reads them); several CDS entities
        with navigation need either a hand-written MPC carrying the
        exposure XML (src/demo_sadl, as ZSTG_SADL_SRV does) or a
        stg.yaml that declares the navigation (as ZOSD_STATUS_SRV does)
     └─ the shape ABAP gives this is a service definition (SRVD): "these
        views, this service"; the transpiler refuses SRVD objects
        (ANOMALY-2026-09-15-srvd-not-allowed), so the near-term move is
        ours: carry the exposed associations from the parser into the
        generated YAML, and let a marker (a second annotation, or an
        SRVD-shaped file we read ourselves) say which views make one
        service
     └─ measured on the sandbox 2026-09-17 (docs/cds-publish.md): the
        annotation there generates IWSV + IWMO + IWVB and still needs the
        hub to publish; ours serves immediately
     └─ DONE 2026-09-17: publishedYaml() walks the exposed associations
        breadth first with a cycle guard and emits one entity per reached
        view plus the associations; names follow the system
        (<VIEW>Type, <VIEW>, to_<alias>, assoc_<32 hex>, the last one a
        sha256 slice rather than a fresh GUID so a build stays
        reproducible). ZC_STG_TRAVEL_CDS now serves ZC_STG_TRAVEL and
        ZC_STG_BOOKING with to_Bookings and to_Travel both ways
     └─ **and the specification is now measured, not guessed**: one
        published view pulls every view its exposed associations reach
        into the same service. Entity set = the view's name as it is
        (no Set suffix), entity type <VIEW>Type, container
        <SERVICE>_Entities, navigation `_Items` -> `to_Items`,
        association `assoc_<32 hex>` with FromRole_/ToRole_, read-only
        flags on the set, labels from the data elements. $expand and the
        navigation URL both work. So no SRVD is needed for this case:
        the work is to carry the parser's exposed associations into
        publishedYaml() and add the reached views as entities of the
        same service. Note it changes existing services (ZC_STG_TRAVEL_CDS
        would gain the booking entity and to_Bookings), so it is a
        decision, not only a patch

B.16 The demo DPC ignores $orderby                          [S]  DONE 09-17
     └─ found 2026-09-17 writing the conformance suite: a hand-written
        `_DPC_EXT` gets the ordering in `io_tech_request_context` and
        `zcl_zstg_demo_dpc_ext` never applies it, so
        `TravelSet?$orderby=TravelId desc` comes back ascending. The
        SADL and CDS paths do order. Either the demo DPC applies it or
        the dispatcher sorts what a DPC hands back when the DPC says it
        did not - a system does the former. The conformance cases for
        $orderby ride on the SADL service meanwhile


B.18 The release bundle runs 3.5x slower than the same build         [S]
     `ANOMALY-2026-09-17-release-bundle-slower-than-source`, found while
     re-measuring something else. One generation, one machine, one scene:
     100 ms a frame from a checkout, 363 ms from the release bundle. Node
     is not the cause. **This is what the i7 and every release run**, so
     the deployed demo is several times slower than the same demo from a
     checkout, and the work-process pool numbers (B.12) were taken on the
     source host.
     └─ it is not uniform, and that is the clue: with the transpiler's
        typed-arithmetic flag off the bundle costs 3.6x, with it on 2.0x,
        so the penalty falls on the `@abaplint/runtime` operator protocol
        rather than on everything equally
     └─ suspects, none confirmed: Terser's mangling of the runtime's hot
        classes, the single-chunk module wrapper defeating inlining, or
        the generated code reaching the runtime through the bundle
        plugin's `build.module` copy instead of a normal import
     └─ how to isolate it cheaply: build the bundle with Terser off, then
        with the chunk split, then with the runtime external, and profile
        the same generation each time. One scene and 60 frames answers it
     └─ until it is understood, **no performance number may be taken
        through a release**: a bundle that taxes the operator protocol
        flatters any change that removes protocol work, which is how a
        41 % improvement read as 63 % for a day

B.17 The arithmetic protocol: 30 ns an operation, and who fixes it   [S/T]
     Measured 2026-09-17, docs/demo-profile.md and docs/abap-hot-code.md.
     Every ABAP arithmetic operation costs about 30 ns here and about 1 ns
     in plain JavaScript; one frame of sdf_blobs is 1.97 million of them.
     The cost is the protocol around the operation - dispatch on the
     operand types, parse each operand, allocate the result - and not the
     arithmetic. Ranked by measured gain against risk, and the order is
     not the intuitive one:
     └─ a constant Character should remember the number it parses to
        (runtime, operators/_parse.ts with the character factory). Five
        lines, no compiler change, measured 22 % of an sdf_blobs frame,
        because '0.5' is how ABAP spells a float constant. Safe only for
        a literal with a decimal point: an integer-valued one takes the
        Integer branch and folding it would change an inferred type
     └─ a Float/Float branch in add/minus/multiply/divide (runtime). Two
        lines each, measured 9-17 % a frame. Integer addition is 17 ns
        and float addition 33 because the chain tests Integer first;
        divide is cheaper than multiply because its chain is two tests
        and multiply's is eight
     └─ raw JavaScript arithmetic when the operand types are proven
        (transpiler codegen, expressions/arith_operator.ts and source.ts).
        110-200 ns to about 1. The largest item by a wide margin and a
        project rather than a patch: the operator is chosen today by a
        string switch with no type information, source.ts already carries
        a context type it ignores, and abaplint core exports no
        getTypeOfSource(node), so a bottom-up type for a Source subtree
        has to be written. The admission rule is not "both operands f"
        but "no operand is character-like, packed, decfloat34, int8, hex,
        date or time, and at least one is f", which is what makes the
        calculation type fall away; division keeps its zero guard
     └─ a synchronous LOOP AT when the body contains no await (runtime
        plus codegen). LOOP AT is an async generator and costs 172 to 349
        ns a row before the body runs, against 74 for DO with READ TABLE
        INDEX. 2.3x on every table loop in every program, but "no await"
        means "no method call at all", so it reaches leaf arithmetic
        loops and little else
     └─ method inlining. 123 ns to 67, and 206 to 67 when the method
        returns a structure. High gain, high risk (aliasing, sy-subrc,
        exceptions, recursion, everything generated is async), and it is
        the precondition for anything across a call boundary
     └─ loop-invariant code motion: nearly nothing here on its own,
        because the one enormous invariant in the demo (cos of a rotation
        recomputed 128 000 times a frame) is behind a method call and
        invisible without inlining. Not worth starting before it
     └─ **not** a lookup table for a function over a proven range, and
        this was measured rather than argued: sin( ) is 19 ns and a
        READ TABLE INDEX lookup is 71, so the table is four times slower
        than the thing it replaces, and no table equals Math.sin at the
        sampled points, which breaks the frame comparison. The builtins
        are cheaper than the operators here (sqrt 10 ns, less than one
        multiply), so hand-expanding ** into multiplications is also a
        pessimisation
     └─ the demo's own ABAP is the ceiling measurement, not the fix:
        rewriting three scenes by these rules took sdf_blobs -37 %,
        torus_3d -38 %, quat_julia -28 % with every frame identical, so
        at least that much is on the table for a compiler that did it by
        itself. The patch is under .local/hotabap/ and belongs to
        vivid-vibes, not here

B.15 Does our CDS pipeline read a view entity?       [S]  DONE 2026-09-19
     ├─ **yes, and nothing had to be fixed** — which is worth as much as a
     │  fix, because it was a guess before. `parseDDLS` falls back to the
     │  view's own name when there is no sqlViewName, and that turns out to
     │  carry the whole path: generated, registered, listed in the data
     │  browser, read through a generated source class, a cast inside it
     │  behaving exactly as in a DDIC-based view
     ├─ `src/cds/zc_osd_port_ve.ddls.asddls` is the one view entity in the
     │  tree and is there on purpose, so that every build exercises the
     │  shape. It duplicates ZC_OSD_PORT, and that is the price: an
     │  unexercised code path is the more expensive of the two
     └─ pinned in two halves, because one test could not reach both:
        `test/cds-cast.mjs` reads one element without a build,
        `test/se16.mjs` asserts the rest of the path through the browser

B.14 A cast in a CDS view drops the field            [S]  DONE 2026-09-19
     ├─ found 2026-09-17 building the status service:
     │  `cast(pid as abap.char(10)) as Pid` in a view is parsed, but the
     │  field is missing from the row the generated source class returns
     │  and an entity keyed on it answers `PortSet()` with no key
     ├─ **the cause**: the generator handled a cast only when the element
     │  carried `@ObjectModel.virtualElement`. Without it the element has no
     │  direct `CDSName` child at all — the source column sits *inside* the
     │  cast — so the field was skipped by a `continue` meant for elements
     │  with no source. Reproduced before fixing: a three-element view
     │  generated **two** fields
     ├─ a cast over a real column is a column now: the name is the alias, the
     │  type is the cast's, and the column underneath is still named so the
     │  view reads it. A cast the generator cannot read — a constant with no
     │  virtualElement annotation — is **named as a skip** rather than
     │  dropped, because silence was the defect
     └─ `test/cds-cast.mjs`. The first attempt at finding the source column
        scanned the cast for a `CDSName` and picked `char` out of
        `cast( '' as abap.char(12) )` — a field pointing at a column that
        does not exist, which is a disappearance with a name on it. Its own
        test caught that. `parseDDLS` is exported for this; the tool only
        runs `main()` when it is the program.

U.2  The status app on the browser deployment                            [S]
     ├─ DONE 2026-09-17: the worker takes the snapshot itself and posts it
     │  to ZCL_OSD_STATUS=>REFRESH at boot and on every read of the
     │  service (web/preview-backend.mjs); host "browser", one process
     │  with no pid and no port, one port row saying there is none and
     │  why, the services of generated/services.mjs plus the SEGW
     │  registrations, the packs with their object counts from the build
     │  (web/generated/status.mjs). docs/status-service.md "On the
     │  browser deployment"; test/e2e/preview.spec.mjs
     └─ Alice, 2026-09-17: the launchpad on GitHub Pages has the tile and
        the app, but nothing fills the five tables there — no façade, no
        pool, no listeners. What the worker does know and could write at
        boot: host kind (a service worker), one "process" (itself), the
        generation (build.json), every service and channel (the generated
        services.mjs), the packs (packs.json), the objects per pack;
        ports would be honestly empty with a note. web/preview-backend.mjs
        is the place, ZCL_OSD_STATUS=>REFRESH the door, and the JSON
        contract already exists (tools/osd-status.mjs)

E.9  A pack has a page of its own                                        [S]
     └─ Alice, 2026-09-17: a pack tile should open something even when
        the pack brought no webapp — a generated Fiori page (or a
        deep-linked one) with the pack's description, its objects, its
        services, channels and tiles, read from osd-pack.json and the
        object store. Today a tile without a url points at /app/<name>/,
        which is 404 for a pack with ABAP only.

E.8  A DIAG stream as a demo                                      [S+A] milestone 1 DONE 2026-09-17
     └─ Alice, 2026-09-17: record the whole DIAG stream of a SAP GUI
        session (the LSD demo), push it over an APC channel the way ZO4D
        pushes frames, and paint it on the page with a SAP TUI written
        in JS, in the same console as the demos, with music. The DIAG
        reader exists in the sibling project (docs/layers-we-own.md);
        the missing piece is the screen-side renderer and the recording
        format.
     └─ milestone 1 DONE 2026-09-17 (docs/lsd-pack.md): sap-tui --record
        writes the composed screens as styled runs (141 KB gzipped for
        the whole show), packs/lsd carries the recording as an SMW0
        object, ZCL_LSD_APC_HANDLER hands it out by line, the page paints
        it on a canvas with the xterm palette; tile on the launchpad,
        preview test on the channel. Left: the music file (S: is not
        mounted here), icon glyphs, a compressed object once the browser
        side inflates it
     └─ milestone 2, if wanted: a DIAG decoder in JavaScript, so the page
        follows a live dispatcher

E.6  A pack cut out of a system                                        [S+A]
     └─ Alice, 2026-09-17: for vsp, or anything that speaks ADT and the
        abapGit API — prepare a self-contained pack from a system, with
        stubs and shims on the perimeter: the objects asked for, their
        closure inside the package, and a stub for every class, function
        and table the closure reaches outside it (npm run probe knows the
        closure; the stub is the ASSERT 1 = 'todo' shape open-abap-core
        uses, so a missing piece fails loudly and by name). The output is
        a directory with an osd-pack.json in it, so E.2 needs nothing new.
     └─ the perimeter is the hard part, not the export: a DPC_EXT's
        closure is the finding of Sprint 0, and the stubs are what make a
        pack run before the closure is transpiled
```

---

## Track G — the classic screens, and the GUI substitutes under them

*A system has an entry screen, and things you reach by typing their name. The
substrate for drawing them is `open-abap-gui`, wired in as a library at
`ed96e89` (`docs/webgui.md`).*

```
G.1  SAP Easy Access, served by ABAP                     [S] DONE 2026-09-18
     ├─ /sap/bc/gui/sap/its/webgui/, the path the real ITS webgui answers
     │  on, which is the nod and not an accident
     ├─ ZCL_OSD_WEBGUI (src/webgui/) behind a *.sicf.xml, the same ICF
     │  pattern as packs/lsd and src/icf
     ├─ the tree is read out of the five status tables, so a service added
     │  anywhere appears with no change here; ZOSD_SVC gained a TEXT column
     │  and KIND='APP' rows, both derived from sources that already had them
     ├─ a node has a kind: FOLDER / APP / SERVICE / TRANSACTION
     ├─ the command field resolves server-side against the same node list
     └─ open-abap-gui in as a lib: +301 objects, /src plus three scaffold
        files /src names; escaping on the page is cl_gui_control=>escape_html

G.1b The drop, drawn, and a menu bar that works           [S] DONE 2026-09-18
     Alice, 2026-09-18: "каноническую каплю саповскую нарисуем (но другую -
     диагональную) и меню там тоже реализуй".
     ├─ the drop is drawn in the page as SVG, on a diagonal
        (rotate(38 60 60)) on the panel's own deep blue field: a glossy bead,
        tip and bulb, a nod rather than a copy. Not a bitmap, no second
        request, and in an SVG of its own rather than in the stretched
        background, which would squash it when the splitter moves. Its class
        is `bead` because `.drop` is the menu's fold-out, display:none, and
        the filled path was invisible for one build while the outline beside
        it was not - it read as a gradient that had not applied
     ├─ the menu bar works, as anchors, still no JavaScript on the page:
        System > Status and System > Log off are the URLs of the tree's own
        SM50 and FLP nodes, read through ZCL_OSD_WEBGUI=>TARGET rather than
        typed a second time (the test asserts menu href == tree href),
        Favorites lists the Favorites folder, Help > About is a page of the
        same class at .../webgui/about with the identity, the generation and
        the build. Everything else is greyed, aria-disabled and titled "not
        wired to anything", top-level entries included
     ├─ the splitter is CSS: resize:horizontal on the tree pane (flex:0 0
        auto so the dragged width wins), the image takes what is left. The
        handle is the browser's own corner grip; no drawn bar, because a bar
        that looked draggable and was not is the same lie the menu just
        stopped telling. The browser test drags it
     └─ **the status bar tells the truth** (Alice: "надо правду показывать").
        One source, tools/osd-identity.mjs: the boot sets sy-sysid, sy-mandt
        and sy-uname from it (test/setup.mjs, which every host boots through;
        the browser has no environment, so the build writes the id into the
        bundle and web/preview-backend.mjs hands it over), the status
        snapshot takes ZOSD_SYS-SID from it, and the ADT facade takes its
        identity from it. The bar reads sy and prints
        "OSG (436726) 123 DEVELOPER · node · open-steamgate" - and the tests
        assert it against SystemSet through the status service rather than
        against a string.
        ├─ two names on purpose: OSD_SID is runtime-facing (sy-sysid, the
           status table, default OSG) and STG_ADT_SID is ADT-facing (default
           OS2), because a project stores the id it was created against and
           refuses a logon to a system reporting another one - the trap
           tools/adt-facade.mjs already documents. The facade's client 001
           is pinned for the same reason while the runtime's is 123, which
           is the client data/ is seeded in. STG_ADT_SID still renames both
        └─ the session number is a work process: ZOSD_SYS gained PID, the
           process the tables were written in (inline the facade, otherwise
           the child the snapshot is posted to, by the port it posts to).
           The browser deployment has none and prints no parentheses rather
           than a zero that looks like a session
     └─ SE80 - editing a class from this screen - is later (Alice), and it
        is the ADT facade's editor behind a transaction node, not a new one

G.2  Prove a sapevent click comes back                     [S] DONE 2026-09-18
     ├─ the gap was as measured: nothing in open-abap-gui raised sapevent
     │  on the HTML viewer. The raise is in our fork now, branch
     │  html-viewer-sapevent at 0324e1c (two commits, 496 tests and the
     │  zcl_gg_ex_151 browser spec green there): cl_gui_html_viewer=>
     │  dispatch_sapevent takes the POST, finds the viewer by the hidden
     │  gg_control field every rewritten form carries, strips the
     │  transport's fields, raises with action / getdata / postdata /
     │  query_table on the CNHT types; the rewrite now also covers a
     │  document's own <form action="sapevent:X"> and formaction, which is
     │  how abapGit's forms are written. No PR upstream yet: docs/upstream.md,
     │  "Beside the transpiler", says what it would say
     ├─ the contract was measured against the consumer, not the frontend:
     │  zcl_abapgit_gui_event (256-char lines joined RESPECTING BLANKS,
     │  only %3A %3F %3D %2F %23 %25 %26 undone), so lines fill to 256 and
     │  text stays as typed with % & = escaped. The width SAP GUI fills is
     │  the one unmeasured number; one constant, c_post_data_chunk
     ├─ PROVEN against abapGit's own markup: zcl_abapgit_html (real) writes
     │  the anchors, zcl_abapgit_html_viewer_gui (real) wraps the viewer as
     │  abapGit does, zcl_abapgit_gui_event (real) reads the event, and the
     │  handler repeats the CREATE OBJECT zcl_abapgit_gui=>handle_action
     │  starts with. src/webgui/zcl_osd_sapevent at
     │  /sap/bc/gui/sap/its/webgui/sapevent/; test/sapevent.mjs (browser by
     │  hand, 6) and test/e2e/sapevent.spec.mjs (Chromium clicking inside
     │  the sandboxed frame, 3): anchor -> action select, getdata key=...,
     │  query {KEY}; the New Online Repository form -> action
     │  add-repo-online, postdata = the document's fields only, form_data( )
     │  = the typed values; a side action's formaction is its own event; a
     │  700-char value fills 256-char lines and abapGit joins them back
     ├─ NOT proven, and said so in the class header and docs/webgui.md: the
     │  form itself is a copy of what zcl_abapgit_html_form writes, because
     │  that class reaches zcl_abapgit_ui_factory and with it 371 of
     │  abapGit's 592 objects by name, as does zcl_abapgit_gui and every
     │  page class; zcl_abapgit_gui=>on_event itself is absent for the same
     │  reason. abapGit's own CI transpiles the whole tree with
     │  open-abap-gui + open-abap-seo + abapGit-web-classic under
     │  unknownTypes: runtimeError, so the closure is a build decision
     │  (compileError, the pack/delta half only), not a GUI gap: G.4's lift
     ├─ found on the way and fixed in the fork: show_url of what load_data
     │  assigned showed the url's text, so abapGit's own page flow drew
     │  "abapgit.html" (ANOMALY-2026-09-18-html-viewer-show-url)
     └─ state between GET and POST is class data of the harness, one
        document per process: enough for a proof, and exactly G.3's step 3

G.3  A transaction node that actually runs                 [S] DONE 2026-09-18
     ├─ the registry is derived, like every other one here:
     │  tools/osd-tran-registry.mjs reads *.tran.xml out of the input
     │  layers the way osd-icf.mjs reads *.sicf.xml, and writes
     │  gen/tran/zcl_osd_tran_registry -- the list, and a generated CASE
     │  doing a static CREATE OBJECT per runnable code, for the reason
     │  zcl_osd_fm_call is generated
     ├─ **the rule for runnable**: TSTCP-PARAM names \CLASS=..\METHOD=..,
     │  which is SE93's own "transaction with class method" form and what
     │  zcl_abapgit_object_tran serialises, the class is in the tree, and
     │  it implements ZIF_OSD_TRANSACTION. A report is refused with
     │  "SUBMIT is not implemented by the transpiler" -- measured, not
     │  assumed: statements/submit.ts is one throw and call_transaction.ts
     │  is a no-op -- and a dynpro with "there is no dynpro processor
     │  here". ZABAPGIT stays typed out and now says what it is missing
     │  (no zabapgit.tran.xml in this tree), which is G.4's lift
     ├─ page( iv_body ): the left pane was hard-wired to branch( ), so a
     │  transaction had nowhere to draw. The tree is the default body and
     │  the screen keeps its title bar, menu, command field and status bar
     │  around whatever is running
     ├─ **the state between two requests is a row, not a pinned process**
     │  (ZOSD_TSES, keyed by a uuid, holding what ROLL_OUT wrote). Weighed
     │  against the pin on four things that happen here: the browser
     │  preview has no pool to pin to, a recycle mid-conversation takes
     │  class data with it, two browsers are two rows and cannot collide,
     │  and a process cannot expire anything while a TOUCHED column can
     │  (30 minutes idle, swept on every start). ZOSD_SYS-PID goes into the
     │  row so a session that moved between processes is readable, and
     │  nothing routes by it. Given up: no live object graph across a step
     │  -- the state must survive /ui2/cl_json -- and no affinity
     ├─ one step is the dynpro cycle: roll in, PBO, dispatch_sapevent into
     │  the viewer PBO just rebuilt, PBO again, render_html, roll out. The
     │  session id rides in cl_gui_control=>ty_sapevent-fields, so the
     │  rewrite writes it as a hidden field and dispatch strips it back out
     ├─ the demonstration is ZOSD_NOTE, the session notepad (a field, Add,
     │  the list) -- the smallest thing that proves the loop, not abapGit
     └─ tests: test/transaction.mjs (11, browser by hand),
        test/e2e/transaction.spec.mjs (4, Chromium, two contexts for two
        sessions), ltcl_session in
        src/webgui/zcl_osd_tran_session.clas.testclasses.abap (6) -- expiry
        is there because only ABAP inside the system can age a row without
        waiting half an hour

G.4  abapGit through the substitutes                                   [S+A]
     └─ G.3 built the seat: a *.tran.xml naming a class that implements
        ZIF_OSD_TRANSACTION is entered and drawn, so what abapGit needs
        from this side is that tran object, a class whose PBO builds
        zcl_abapgit_gui's viewer, and ROLL_IN/ROLL_OUT over its page
        stack. What it needs from the other side is the closure.
     └─ blocked on G.2 by choice. It should arrive as a transaction rather
        than as a page with a URL of its own, because that is how a system
        works; and what stops it is not the GUI layer (31 todo stubs in
        open-abap-gui/src, 20 of them in cl_salv_form_*, none in the
        container/viewer/frontend-services path) but the SAP APIs abapGit
        wants underneath. That is a closure audit, not a screen.
```

---

## Track O — the oracles: proving we answer the way a system answers

*Proposed 2026-09-18 by the workstation session, which owns the formulation.
These two lived nowhere: they were proposed in conversation, nobody answered,
and so they were not written down. The instrument has outgrown a single
track — today it compares frames, tomorrow SQL, the day after steps.*

O.0  A frame as the oracle — **exists already**                          [S]
     `tools/o4d-record.mjs --scene <name> --ticks n` on both sides plus
     `--compare` names the ABAP that computed a difference. Eight anomalies
     in two days, 2026-09-16/17, each then measured on A4H with a throwaway
     ABAP Unit probe before anything was changed. It is listed here so the
     next two are written as its siblings and not from scratch.

O.1  An SQL trace taken on both sides, compared              [S]  high, first
     ├─ take an SQL trace of one service call on A4H (ST05, or the trace
     │  from ADT — both reachable through vsp), take ours, bring both to a
     │  canonical form (statement text with the literals masked, order
     │  preserved) and compare
     ├─ **our side is nearly free, and that is the argument for doing it
     │  first**: all transpiled ABAP talks to exactly one object,
     │  `abap.context.databaseConnections["DEFAULT"]` with its eleven
     │  methods (docs/db-backends.md), so there is one interception point
     │  and no new protocol on either side
     ├─ what it catches that the OData surface cannot show at all: a
     │  missing MANDT, a different ORDER BY, an N+1 where the system issues
     │  one statement, a different FOR ALL ENTRIES chunking
     └─ the deeper reason for the priority: the database seam is the one
        place where being wrong is **invisible from outside**, because the
        answer can come out right by accident

O.2  A step trace through the debugger endpoints             [S]  after O.1
     ├─ drive a DPC step by step through the debugger endpoints on A4H,
     │  recording (statement, variable snapshot) pairs; run the same here
     │  through a runtime hook; compare and name the first step that
     │  diverges
     ├─ an order of magnitude more expensive than O.1, because it needs the
     │  live debugger protocol
     └─ **its message schemas are the same as A.6's** and the two are
        written together — A.6 answers those endpoints, O.2 calls them. See
        the note on A.6

---

# The standing list

## 0. Decisions waiting on Alice

Nothing below them starts until the answer.

```
0.1  Bun "local ABAP AS" packaging: yes / no                          [A]
     └─ unlocks 1.1, 1.2, 1.3
     └─ feasibility settled 2026-09-13: bun 1.4.2 runs the whole thing,
        107 ABAP Unit tests and the gateway over HTTP, docs/bun-spike.md
     └─ packaging settled 2026-09-14: the %23 defect does NOT block a
        compiled binary. Bun.build({compile, plugins}) with a five-line
        onResolve builds one that runs; only `bun <script>` and the
        plugin-less CLI `bun build --compile` fail. #1841 is no longer a
        gate here (docs/bun-spike.md part two)
     └─ external: open-abap-apc (T's, local only, no remote) for the APC layer
     └─ settled already: it lives in this repository, not a third one

0.2  ADT façade: ANSWERED YES by Alice 2026-09-13, building              [A]
     └─ the contract for waves 0 and 1 is written: docs/adt-facade.md
     └─ unlocks 2.1 .. 2.4
     └─ external: open-abap-adt (interfaces only, LICENSE empty -> spec, not base)
     └─ external: vsp as the oracle and the test client
     └─ external: sanitized ADT fixtures from V; this repository is public,
        so raw captures never come here, V scrubs before handing over

0.3  A4H: what goes up, and when                                      [A]
     ├─ level 1  the SEGW project as an abapGit repository (13 files)
     ├─ level 2  + DDIC, seed data, search help, the hand-written _EXT
     ├─ level 3  + the Travels app as a BSP (three changes, AGENDA)
     └─ needs: package name, transport, the word
     └─ external: A4H sandbox, abapGit installed on it

0.4  draft oracle: build the sample objects on A4H?                   [A]
     └─ plan: docs/oracle-draft.md
     └─ external: A4H; a browser to capture $metadata (MCP cannot)
     └─ risk named there: the writable draft service may not be a SEGW artifact

0.5  RAP oracle: build the sample objects on A4H?                     [A]
     └─ plan: docs/oracle-rap.md
     └─ external: SAP-samples/abap-platform-refscen-flight (Apache-2.0) is
        most of the oracle already; A4H only adds the 1909 BDEF dialect
     └─ external: A4H 1909 is unmanaged-only, no managed, no draft

0.6  Is depending on ZADT_VSP being installed on the target ok?       [A]
     └─ decides V's deploy route (2. vs 3. on the ladder in 4.2)

0.7  What S does while the above is open                              [A]
     └─ proposal: the analytics chain, 3.1
```

---

## 1. The Bun binary (gated on 0.1)

```
1.1  bun:sqlite backend for the DatabaseClient seam                   [S]
     └─ eleven methods + the seven rewrites (docs/db-backends.md)
     └─ must keep the seed path alive: test/seed.mjs over data/*.tabu.json,
        T's SEGW tables ride on it
1.2  Bun.serve adapter, replacing express-icf-shim                    [S]
     └─ the ABAP side (zcl_stg_http_handler) does not change
1.3  build and stitch: bun build --compile, one exe per platform      [S]
     └─ external: CI runners per platform
     └─ NOT gated on #1841 any more, measured 2026-09-14: the bundler's
        onResolve closes %23 and %25 together, ten lines, and the compiled
        binary runs. #1841 stays worth having (it would delete the plugin
        and fix `bun <script>`) but nothing waits on Lars for it
     └─ known: mainstream platforms only, ~60-100 MB per exe
1.4  APC over Bun websockets                                          [T]
     └─ open-abap-apc as an outside library, cloned into .local/lars
     └─ not gated on Lars: the library ships its own copy of the SAP-named
        part today and works; the PR (9.4) only makes it prettier
1.5  layers: the binary takes an ordered list of abapGit src paths   [S+A]  (E.1 done 2026-09-16: the list is abap_transpile.json, later wins; the binary's argument is E.2)
     └─ Alice's formulation, 2026-09-14: later layers win on a name
        collision, and data layers (data/*.tabu.json) apply the same way
     └─ the argument is not theoretical: local/o4d/ and local/vivid-vibes/
        both carry ZCL_O4D_HTTP_HANDLER, and on 2026-09-14 whichever the
        directory walk reached first won, silently. Explicit order plus a
        report of what was overridden is the whole feature
     └─ the unifying bit: hash(ordered layers) is the transpile cache key
        AND the ADT version-id Alice proposed earlier. One number, three
        uses, and it is what makes "spin a runtime from sources" fast —
        first run transpiles 1065 objects, later runs do not
     └─ open, needs Alice: does a layer override the OBJECT (all its
        files) or single FILES? Overriding .clas.abap without .clas.xml
        is the case that decides it                                   [A]
     └─ zip as a layer: an abapGit export unpacked into the cache
1.6  the runtime half of packaging, in order                          [S]
     └─ measured first, built second: `bun tools/osd-serve.mjs`
        interpreted is the next cheap check, and it is where the %23
        defect still bites (1.3 is unaffected)
     └─ then the supervisor: ServingRuntime spawns a SCRIPT PATH today;
        a binary must spawn `process.execPath serve --port ...`, so the
        entry needs subcommands before --compile is useful
```

## 1a. Shipping shapes that are not the binary

Three exist or could: the browser bundle (done), the binary (section 1),
and one local HTML file. They answer different questions, and the third is
the only one still undecided.

```
1a.1 the browser bundle                                          [S] DONE
     └─ service worker + sql.js, every ICF service, APC channels, and
        since 2026-09-14 the SMW0 media. Read-only showroom: no ADT, no
        activation, no writes that outlive the tab
     └─ needs https off localhost, which is the friction the binary removes
1a.2 one local HTML file, opened from disk                        [S+A]
     └─ FACT, not an opinion: a service worker cannot be registered from
        file://. So this is not "bundle harder", it is a different seam —
        run the runtime IN THE PAGE and shim fetch + XMLHttpRequest
     └─ already half-built without meaning to: preview-socket.mjs shims
        WebSocket the same way, and handleRequest({method, path, search,
        headers, body}) knows nothing about transport. Tens of lines
     └─ cost: ~45-50 MB (33 MB JS + 11 MB media as base64), re-parsed on
        every open, UI5 still from the CDN
     └─ needs webpack, not Bun: file:// refuses <script type="module">,
        so the build must be a classic script with TLA lowered
     └─ worth it only for "send someone a file they double-click". Where
        an executable may be run, the binary wins                     [A]
1a.3 UI5 is NOT embedded in any of them — decided 2026-09-14         [S]
     └─ Fiori Elements (sap.fe, sap.ui.generic.app) is SAPUI5 and is not
        in OpenUI5, so embedding OpenUI5 buys freestyle apps and not the
        thing the project is for. Licence aside, it would not work
     └─ instead: CDN by default, `osd ui5 fetch` caching a dist under
        ~/.osd/ui5/<version>/ for offline, --ui5 <dir> to point at one
```

## 2. The ADT façade (gated on 0.2)

Not "flip a URL and 96 tools work". It is "flip a URL and iterate one
subset at a time against vsp", whose client is strict on purpose. Order
below is V's, and it is the order that matters: the session comes before
the objects.

```
2.1  session and CSRF emulation                                  [S] DONE
     ├─ the token dance: HEAD/GET fetch, x-csrf-token on writes
     ├─ X-sap-adt-sessiontype stateful / stateless, sap-contextid, cookies
     ├─ an affine session for lock -> write -> activate
     └─ expiry by shape: a 200 without a token reads to vsp as logged out
     └─ V's warning: this breaks first, so it is built first
2.2  discovery as the gatekeeper                                 [S] DONE
     ├─ /sap/bc/adt/discovery advertises only what is implemented
     └─ so vsp never calls an endpoint that 404s, and "which tools work"
        has one honest answer
2.3  thin vertical slice, one day                                [S] DONE
     ├─ discovery + the session dance
     ├─ GetSource for a class, from the files in src/ and gen/
     └─ GetTableContents, from the database we already have
     └─ exit test: vsp pointed at localhost, its own tools answer
2.4  reads: programs, classes, interfaces, tables, packages, search
                                                                 [S] DONE
     └─ and the cross-reference tables over freestyle SQL: free on the
        protocol side, filled from the parse by the store layer        [T]
2.5  writes: source in, abaplint as the syntax check, transpile as
     activation, ABAP Unit as the test run; synthetic locks, no
     transports                                                       [S]
     └─ the store side is in: check with source in the request, and the
        test run as program/testClasses/testMethods/alerts, both
        tools/osd-*.mjs, both with the shape vsp unmarshals           [T]
     └─ and the fetch: a clone happens inside OSD now, git's smart HTTP
        in ABAP over abapGit's transpiled pack code, no git binary    [T]
2.6  runtime errors as ST22-shaped dump documents                     [S]
     └─ V's freebie: `vsp dumps --explain` then works with no system
2.7  honest scope: the development loop, some thirty to fifty of the
     ninety-six tools. Transport organiser, job and spool, identity,
     debugger over ADT and real cluster dumps stay out and stay
     undiscovered.                                                    [S]
     └─ external: sanitized ADT document shapes from V (see below)
2.8  create: a client POSTs ADT create XML and the object is persisted [S]
     └─ the store writes the files; the metadata beside the source is
        what we would otherwise be inventing                          [T]
     └─ 2.8a AFF (SAP/abap-file-formats) as the source for that metadata,
        ~90 JSON schemas, Apache-2.0                            [T] ~2h
        ├─ agreed 2026-09-13 by all three sessions: it waits until create
        │  arrives, nothing on vsp's Tier 1 path needs it. V's words:
        │  vsp talks to OSD over ADT and never reads OSD's on-disk
        │  metadata, so XML-vs-AFF is our internal choice
        ├─ catch: abaplint reads object metadata from .xml only, its
        │  aff_and_xml rule merely flags having both. So AFF has to be
        │  converted to XML on import, or the syntax check answers
        │  confidently about objects it cannot see
        └─ later, not now: if OSD ever emits AFF archives, V's deploy
           path reads standard abapGit XML and would need AFF then
2.9  activated code reaches the running gateway                    [T+S]
     └─ measured 2026-09-13 while answering Alice's "can we develop and
        deploy today": it does not. Node pins the whole transpiled
        module graph at boot (test/start.mjs imports output/ statically),
        so an activation changes src/ and output/ and leaves the serving
        process on the code it started with. Not a metadata cache: the
        entire OData runtime is frozen the same way
     └─ the sharp edge: ABAP Unit over ADT does see the new code,
        because the runner imports the testclasses module in a child
        process. So a green unit verdict and a Fiori client reading the
        old model happen in the same minute
     └─ a restart fixes it and costs the database, which is in memory.
        So the fix is two decisions, not one: how the process picks up
        new modules (recycle a worker, or the whole process) and where
        the rows live so a recycle does not eat them      [A decides]
     └─ smaller, same family: activation answers before the transpile
        finishes and nothing says when it landed                       [S]
     └─ the store half is in: serving runtime in a process of its own
        (tools/osd-serve.mjs), a supervisor that replaces it
        (tools/osd-runtime.mjs), STG_DB_PATH for SQLite so a recycle
        does not eat a client's rows, and store.publish() which
        transpiles and then recycles, resolving when the new process
        answers. Asserted: changed modules are live after a recycle and
        not before it                                                  [T]
     └─ what is left is the listener's half: proxy the OData path to the
        current runtime, await whenReady() so a request mid-recycle
        waits rather than fails, and let activation answer out of
        publish() instead of firing the transpile and forgetting    [S]
2.10 what a client can do to an object, and what it cannot            [S]
     └─ no DELETE anywhere in the façade: create and change, never remove
     └─ a Fiori application is files on disk, not an object of the
        store, so "deploy an app into OSD" has nowhere to land. Needs a
        UI5 or BSP type in the store before the façade can carry it [T]
```

## 2a. OSD: the tiers, and who owns which layer

The local system, working name OSD, the off-stack doppelganger. The tiers
say **when**, the layers say **who**; they are the same picture from two
angles and both were agreed across the three sessions on 2026-09-13.

```
Tier 1  OSD speaks ADT well enough for vsp
        waves 0-4 above, plus abapGit in a box as the way content gets in
        gate: vsp's wave 0-4 tools green against localhost, AND
              open-steamgate's own suites unchanged with the facade in
Tier 2  OSD speaks ADT well enough for an IDE. Not one thing: two, with
        very different costs, and the split was measured on 2026-09-13
Tier 2a VS Code, through murbani.vscode-abap-remote-fs on abap-adt-api.
        That client logs on with plain basic auth, no ticket and no RFC,
        and its login calls exactly one resource,
        /sap/bc/adt/compatibility/graph. We were 404ing it; one route was
        the whole distance. Served and tested now (03fa379), with an
        empty graph on purpose: a compatibility graph is a system saying
        which resources a client may use at which versions, and we have
        measured none of those facts
        honest scope: one route served and tested, NOT a connected client
        browsing a tree. What the extension asks for and we lack will
        name itself in /osd/not-served, which is the instrument
Tier 2b Eclipse. RE-COSTED 2026-09-14, because the premise was wrong:
        ADT is NOT only HTTP over the ICM. SADT_REST_RFC_ENDPOINT (function
        group SADT_REST) carries a whole HTTP exchange in one RFC call --
        REQUEST_LINE, HEADER_FIELDS, MESSAGE_BODY in, STATUS_LINE, headers,
        body out. Measured: GET /sap/bc/adt/discovery over RFC answered 200
        with the atomsvc document. Alice had sniffed this; the session had
        asserted the opposite without data. So the on-prem route is not
        "replay an unreplayable logon and then still need HTTP", it is "be
        an RFC server answering one function module", and the payload is
        already the shape the facade speaks. See docs/adt-facade.md.
        The old note below is kept for the reasoning it records.
        Eclipse, still on the logon, not on the ADT surface. Two forks:
        the on-prem project wants an RFC logon on 3399, costed at three
        to eight weeks with a real chance of never converging, because
        the logon-accept is a function of the client's init and cannot be
        replayed; the ABAP Cloud project wants the browser reentrance
        ticket, which is hours, because the ticket is opaque to Eclipse
        and only the accepting system validates it, and that is us
        cheapest next measurement: Alice pastes the string behind
        "Copy Logon URL to Clipboard", which names the loopback port,
        the path and whether a nonce is echoed                        [A]
        rule: an Eclipse capture stays in .local/, never in this repository
Tier 3  OSD speaks the rest: RFC and DIAG fronts, a screen that answers
        "not implemented" instead of nothing
        not ours to build: odgp already draws screens from Go with no
        system behind it, and the DIAG sibling carries the LZH writer
        (docs/layers-we-own.md). The spike is "can odgp answer a screen
        routed from OSD", and it is odgp's question
```

```
Layer                      Owner  What
protocol surface           S      the ADT facade: session, discovery, the
                                  resource tree, content handlers, ETags,
                                  locks; and the packaging that ships it
the object service seam    S      drafted as part of the facade contract:
                                  read, write, activate, delete, list,
                                  search, and the shape activation returns
                                  for an error. The facade never touches
                                  storage, the store never parses HTTP
what is behind it          T      the object store, the activation path
                                  (file, abaplint, transpile), abapGit in
                                  a box, APC and daemons
the client and yardstick   V      the calls a real development loop makes,
                                  the sanitized fixtures, the round trip
```

## 2b. Questions parked next to the façade

```
ANSWERED  does Eclipse need the dispatcher port at all? No. Tested by
      taking the dispatcher forwarder down on 2026-09-14 and connecting
      again: the project was created and everything worked — until a program
      was run, when Eclipse's embedded GUI opened and could show nothing.
      So ADT is entirely the gateway, 33NN, and 32NN is only ever DIAG.
      Two consequences, and they split the work cleanly. To make Eclipse
      connect and develop, OSD needs an RFC server on ONE port answering ONE
      function module. To make programs run inside it, OSD needs a DIAG
      front on 32NN, which is open-diag-go's territory and not the façade's.
      What is lost without DIAG is dialog programs and transactions, and
      only those: ABAP Unit runs over ADT (abapunit/metadata is in the
      capture, Ctrl+Shift+F10 goes through the façade), so edit, check,
      activate and test all work with no DIAG frame at all. Alice's
      correction, and it matters — "cannot execute" undersold it badly.
open  SOAP: vsp's ADT is pure REST, no SOAP in it. The only SOAP it touches
      is SOAP-RFC (/sap/bc/soap/rfc), a fallback transport for classic RFC
      when the gateway is closed, stateless, and it belongs to open-rfc-go.
      A local system would need it only if a non-ADT, RFC-speaking client
      had to attach. Question, not an item.
open  Eclipse ADT against the façade: free if vsp accepts it, untested.
open  revisions: reading them out of git instead of a system.
```

## 3. Analytics and CDS (no gate, S can start)

```
3.1  star schema                                                      [S]
     ├─ @Analytics.dataCategory: #DIMENSION / #TEXT
     ├─ @ObjectModel.text.element, foreign-key associations
     └─ so the analytical list page shows names, not codes
3.2  view parameters                                                  [S]
     └─ parameterised entity sets in OData v2
3.3  delta extraction (the BI piece)                                  [S]
     ├─ @Analytics.dataExtraction.enabled, delta by a timestamp element
     ├─ !deltatoken on the service, __delta in the answer
     └─ a change-log table our own writes fill, so deletions are in the delta
3.4  calculated measures over the virtual-element exit                [S]
     └─ free now, docs/virtual-elements.md
```

## 4. The road to a system

```
4.1  capture IN: DDIC + table contents from a system into our files   [V]
     └─ this is the thing we lack: our DDIC and seed rows are hand-made
     └─ external: rfc export (abapGit ZIP) + Data Config, both exist in vsp
4.2  deploy OUT, as a ladder                                          [V]
     ├─ rung 0  abapGit on the box pulls the repository itself   (nothing to build)
     ├─ rung 1  vsp deploys CLAS + DDIC; IWMO/IWSV registered by hand once
     ├─ rung 2  vsp triggers abapGit deserialize        (gated on 0.6)
     └─ rung 3  vsp learns IWSV/IWMO/IWPR natively      (only if install-free
                deploy becomes a promise)
4.3  two bundles, never conflated                                     [S+V]
     ├─ out: classes, DDIC, registration objects
     └─ in: DDIC + table contents; data/*.tabu.json does not go back
```

## 5. SEGW, the application (T's, with my editor on top)

```
5.1  the wizards SEGW has                                             [S]
     ├─ import from a DDIC structure
     ├─ map to a data source
     └─ referential constraints, complex types, data sources by hand
5.2  node order, drag and drop (STG_SEQ)                              [S]
5.3  a text row created when there is none                            [S]
5.4  Generate into src/ and a registration without a restart          [S+T]
5.5  the informational Cloud abaplint pass, numbers per release       [T]
```

## 6. Gateway leftovers (S)

```
6.1  media: CREATE_STREAM with a slug, deleting a media resource,
     ETags, streaming instead of one xstring
6.2  deep insert through a projection (a composition)
6.3  ETags on a CDS projection
6.4  @ObjectModel.readOnly per element
```

## 7. stg-compile leftovers (S), blocked on an oracle

```
7.1  Include: a model that merges another service's model
7.2  a function import mapped to a function module
     └─ neither has a corpus example; both need a small sample project
        built on A4H (0.3 / 0.4 territory)
```

## 8. Housekeeping (S)

```
8.1  e2e data isolation, so the suite can run in parallel again
     └─ today: workers: 1, deterministic, 44 seconds
8.2  the flaky value-help spec, seen once, not reproduced
8.3  keep the preview build green (it broke twice on bundling)
8.4  verification discipline, after three false greens in one day     [S]
     └─ 2026-09-14, all three the same shape: a test that passed while
        the path it claimed to cover was broken (it called install()
        itself), a suite that passed against a stale build/sw.js, and a
        fix "verified" by grepping for a comment webpack strips
     └─ rules that follow: assert on CODE in a built artefact, never on
        a comment; a test must exercise the injected path, not simulate
        it; and a deployed bundle is verified by content, not by the
        deploy command exiting 0
     └─ DONE, the mechanism rather than the rule: the bundle carries a
        digest of itself, serves it at <mount>__preview/build, and the
        first test of the preview suite compares it with build/build.json.
        A registration that outlived a rebuild now says so instead of
        answering quietly. scripts/build-preview.mjs writes the stamp
     └─ a FOURTH one the same day, after the rule was written: a fix
        reported as shipped that had gone into a folder which is not an
        input (9.7, 9.8). The stamp would not have caught that one; the
        input report does
     └─ a FIFTH, 2026-09-19, and it says what the rule was still missing:
        **the rule names how to verify an artefact and nowhere names what
        the artefacts are.** The editor wave went out with abaplint, ABAP
        Unit and 943 wire tests green, and took the public preview down
        for three commits -- none of those four suites builds webpack, and
        the preview build was simply never run. The defect under it was
        that `await import()` does **not** keep a module out of a bundle:
        the store was imported lazily *so that* abaplint would stay out of
        the service worker, webpack followed the dynamic import as readily
        as a static one, and the one-chunk limit inlined it. A comment
        stating the intention sat right above it, which is the pair this
        file already names -- a comment describing behaviour is
        indistinguishable from one describing intent, and the second is
        commoner
     └─ so the list, since the rule needs one: touching `test/setup.mjs`,
        `web/`, `webpack.config.cjs` or anything they import means
        `npm run web:preview` **locally before the push**, and reading the
        bundle rather than the exit code. The IgnorePlugin entry is the
        fix, next to the AMDP one and for the same reason
     └─ still open: this is the argument for one e2e suite running against
        every packaging target, or the binary becomes a second runtime
        with no second check
8.7  a leak detector on the way out, not a rule in a document   [СДЕЛАНО]
     └─ 2026-09-14: a wire capture was about to go into open-rfc-go, a
        public repository, as a test fixture. It contained two LAN
        addresses, a host name, an Eclipse project name, a machine id and
        Alice's surname. I caught it by reading the bytes before committing,
        which is exactly the kind of catch that works until the once it
        does not
     └─ CLAUDE.md has said "no live identifiers in any tracked file" since
        the first week. The rule did not stop it; noticing did. That is the
        day's theme in a new place, and the answer is the same: a mechanism
        that cannot be walked past
     └─ what it should be: a check on `git commit` and again before a
        publish — addresses in the private ranges, host names of the
        machines in play, the user names, anything matching a GUID shape,
        and a *.jsonl or *.pcap staged at all. Hex-encoded too, since a
        capture hides its identifiers inside hex strings where grep for
        "192.168" finds nothing
     └─ scope: this repository and the sibling Go ones, since they take the
        same captures. A pre-commit hook is not enough on its own — hooks
        are per-clone and silently absent on a fresh one — so the same check
        belongs in CI where it cannot be skipped
     └─ Alice's call, 2026-09-14, and the right one
     └─ built 2026-09-14, `tools/osd-leak-scan.mjs`, `npm run leak`, hook in
        `.githooks/pre-commit`, CI in `.github/workflows/leak-scan.yml`
     └─ and it caught one the same hour, in the repository it was written
        for. A 746-byte logon template committed to open-rfc-go carried the
        captured system's host name, instance, address, logon string and
        user, all in UTF-16LE — and a hand scan run over that very file had
        reported it clean an hour earlier, because it looked for runs of
        printable ASCII and a NUL after every character is enough to hide a
        host name from a grep. The design lesson is one line: decode first,
        match second, over every encoding a file plausibly has
     └─ a sixth identifier was not text at all. The last six bytes of a
        session GUID are the client's own IPv4 packed into the uuid node
        field, which is how a LAN address travels through a public
        repository without ever spelling itself out. Matched in binary now,
        and only on two-byte prefixes: 10.x is one byte, any random blob
        produces one per 256, and the first run turned up seven of those and
        nothing real. A check that cries wolf is read once
     └─ its first real catch was the comment I wrote explaining the scrub. I
        cleaned the data and spelled both identifiers out in the prose beside
        it. Nothing was pushed, so nothing was public
     └─ what it finds on open-rfc-go's public main is Alice's to decide: two
        of her LAN addresses, her surname, and the stock A4H appliance host
        name, in files that predate this branch

8.6  source maps, so a failure names her ABAP line not our .mjs      [S] DONE
     ├─ done 2026-09-16 — and most of it already was: the transpiler writes
     │  a map beside every module (write_source_map), and osd-where.mjs
     │  resolves a generated position to the ABAP statement; the unit
     │  runner has named ABAP lines in its alerts for a while
     ├─ what was missing was the runtime: a request that died in ABAP was
     │  logged as a JavaScript stack. The child keeps short dumps now —
     │  what, where in ABAP, the frames under it — says the ABAP statement
     │  in its log, puts the position into the OData error's innererror,
     │  and answers them at GET /osd/dumps; ICF services report through
     │  the same door
     └─ the ADT runtime/dumps route reading them in ST22 shape is 2.6,
        ADT work, later
     └─ from T, 2026-09-14, half done already: `write_source_map` is
        ALREADY true in our abap_transpile.json and output/ carries the
        .mjs.map files, so only the consumer side is missing. 341 maps
        on this tree, resolving to the statement rather than the object:
        zcl_o4d_sales_dance.clas.mjs:1346 -> .clas.abap:119, which is the
        line the demo actually died on
     └─ the consumer is here: tools/osd-apc.mjs `describe(error)` already
        names the exception class and the frames from output/. With maps on
        and findSourceMap over the thrown object's stack it can name the
        ABAP statement instead. Costs a flag and some disk

8.5  the preview suite flakes on a worker-served page        [S] FIXED
     └─ seen on 2026-09-14, a different test each run, mostly a page.goto
        timing out or "execution context was destroyed". Diagnosed rather
        than retried, and it was a real race: web/index.html is the
        installer and does location.replace("app/") the moment the worker
        is ready, so every test that waits for the controller on that page
        and then goes somewhere collides with a navigation already in
        flight. The error surfaces on an unrelated line, which is why it
        read as noise
     └─ the fix is in the page, not the tests: index.html?stay leaves the
        visitor where they are instead of redirecting, which is a
        reasonable thing to offer anyway, and the suite uses it. Four
        consecutive clean runs, 6/6
     └─ the lesson is 8.4's: a suite that goes green on a second run
        teaches everyone to run it twice, which is how a real failure gets
        waved through. This one was hiding a defect for a day
```

## 9. Upstream, outside this repository (T's, verbatim from them)

```
9.1  transpiler #1835, @abaplint/database-duckdb                      [T]
     └─ open since 2026-09-12, checks green, no review
     └─ external: Lars merges; PR only, never merge ourselves
     └─ blocks nothing here; the branch feat/database-duckdb lives until then

9.2  transpiler: 2.13.87 is out (2026-09-14)                          [T]
     └─ DONE as far as publishing goes: 2.13.87 carries #1836 (flat concat
        chain) and #1843, so both generators can drop the 200-line SADL
        rule (segw-gen's sadlXml and zcl_stg_segw_gen_dpc). T's files
     └─ it does NOT let us leave the linked local build, which is what it
        looked like it would do. Checked against the open pull requests:
        #1846 (a W3MI object keyed on its name, not its file name) and
        #1845 (a binary file survives the copy to output) are both still
        open, and the whole media path rests on them. Without #1846 the
        registry is written abap.W3MI["zork-mini%2ez3"] while
        WWWDATA_IMPORT asks for "ZORK-MINI.Z3" and finds nothing; without
        #1845 the bytes beside the module are corrupt
     └─ so do NOT record the dependency by bumping package.json to
        ^2.13.87. ^2.13.86 already resolves there, and an npm install would
        replace the link and take the media down without saying so. The
        debt stays named instead: DEBT-2026-09-13-linked-transpiler

9.3  open-abap-core: BAPI_TRANSACTION_COMMIT / ROLLBACK over the LUW   [T]
     └─ written, eb0bedd on branch bapi-transaction in the fork, unpushed
     └─ waits on 9.2, then PR, then the commit_work test in open-abap-odata
     └─ external: Lars merges

9.4  open-abap-core: the APC family a real handler needs               [T]
     └─ core's if_apc_wsp_extension has two methods, a stateful handler
        needs five (on_accept, on_close, on_error) and if_apc_wsp_message
        needs set_text; cl_apc_wsp_ext_stateful_base does not exist
     └─ written and tested in open-abap-apc, not yet a PR
     └─ external: Lars merges; until then open-abap-apc ships its own copy
        and leaves core's src/tcp out of its dependency

9.5  oisee/vivid-vibes: what actually stops the full package       [A/T]
     └─ MEASURED 2026-09-14, and the old entry ("2 of 85 implement them,
        so 75 do not transpile") was wrong. Transpiling local/vivid-vibes
        as the only o4d input fails with 17 errors, and they are not what
        was assumed:
        ├─ ~13 of them are two dev-time report programs, not the demo:
        │  zo4d_render_demo.prog.abap and zo4d_offline_export.prog.abap,
        │  which call cl_gui_frontend_services (SAP GUI, absent in
        │  open-abap) and use X255. They are export tooling and have no
        │  business in a browser build
        ├─ implement_methods on exactly ONE class,
        │  zcl_o4d_mountains_oops_a (get_required_media, is_loopable) —
        │  that is the DEFAULT IGNORE family, abaplint #4291
        └─ two real errors in zcl_o4d_composer ("field frame does not
           exist in structure")
     └─ so the full 85-effect package is two programs and two classes away
        from building, not 75 classes away. The 31 effects absent from the
        current build are absent because nobody copied them into
        local/o4d-apc, not because they fail
     └─ what this makes cheap: excluding the two *.prog.abap files is a
        glob, and then vivid-vibes can BE the input instead of being
        curated into two folders by hand
     └─ DEMONSTRATED, not merely argued: with vivid-vibes as the only o4d
        input and four entries added to exclude_filter — the two .prog
        files, zcl_o4d_mountains_oops_a and zcl_o4d_composer — the tree
        transpiles clean, 1094 objects and **83 effect classes against the
        54 the demo ships today**. Config only; nothing in her repository
        had to change. Reverted afterwards, because what the demo contains
        is Alice's call and two effects are dropped by name to get there
     └─ so the recommendation is not a lean/extended branch split but one
        input and four excludes; local/o4d and local/o4d-apc then go, and
        the hand-kept duplicate goes with them
     └─ external: Alice's repository, a patch there is the fix — the two
        real errors in zcl_o4d_composer, and mountains_oops_a once
        abaplint #4291 lands or its two methods are written

9.5a open-abap-core: GENERAL_GET_RANDOM_INT                            [S]
     └─ found 2026-09-14 by replaying the MiniZork walkthrough through the
        bundle's APC channel: the Z-machine's `random` opcode calls it, it
        does not exist, and CX_SY_DYN_CALL_ILLEGAL_FUNC closes the channel
        on the first dice roll — the troll fight, twenty-five commands in
     └─ small and contributable; a fork, since we have no write access to
        open-abap-core. ANOMALY-2026-09-14-general-get-random-int
     └─ WRITTEN AND PROVEN 2026-09-14, not yet offered: twelve lines on
        core's own cl_abap_random_int, in .local/lars/open-abap-core. With
        it the whole walkthrough plays in the bundle, every assertion,
        start to finish. The test still tolerates the old death because a
        fresh clone of core has no such file
     └─ OPENED: open-abap-core#1221, 2026-09-14, after asking T for
        objections (none: "take it") as Alice instructed. Lint and the full
        core unit suite green on a clean clone of the fork, the four new
        tests confirmed to have run, and checked by negative control — the
        naive 1..RANGE version fails random_int_zero with "Expected '0',
        got '1'"
     └─ the contract was measured on A4H, not inferred, and the inference
        was wrong twice over: it is 0..range inclusive, and a negative
        range is legal. cl_abap_random_int cannot express either, because
        intinrange asserts high > low and low >= 0

9.5b zork-abap: the Z-machine assumes random( ) returns 1..range        [A]
     └─ falls out of the A4H measurement. The Z standard says the `random`
        opcode yields 1..range; GENERAL_GET_RANDOM_INT yields 0..range. So
        zcl_ork_00_zmachine:557 takes the module's answer unmapped and will
        occasionally store 0 where the story expects 1..range — on a real
        system as much as here
     └─ not ours to fix and not the module's job to bend: matching the real
        system is what #1221 is for, and the caller maps

9.6  Bun, measured rather than assumed                                [T]
     └─ done in part 2026-09-13: it runs, and twenty reads took 220 ms
        against Node's 264 ms (docs/bun-spike.md)
     └─ still open: the three request shapes (100/20, 1000/100,
        5000/100 rows) so the brief has Bun beside Node 2 ms and goja
        36 ms on the same axis
     └─ confirmed: Bun is JavaScriptCore, not V8
     └─ part two 2026-09-14: no native dependencies exist at all
        (database-sqlite is sql.js, wasm); the bundler is 166x faster and
        unusable; the compiled binary is not blocked by #1841

9.7  oisee/vivid-vibes: the megademo player asks for ?image=          [A]
     └─ found 2026-09-14 while making SMW0 media work in the bundle.
        get_megademo_html writes `img.src='?image='+n`; the handler's
        route is `?img=`, and the SMW0 objid carries the extension
        (ZO4D_05_COPPER.PNG). So the gallery images of the DEFAULT player
        have never loaded, on Node or in the browser, silently: the
        request falls through to the default branch and returns the page
     └─ CORRECTED 2026-09-14, having been written wrong the same day: the
        first fix went into local/vivid-vibes, which is NOT an input folder,
        so it changed nothing; the second went into local/o4d, which is, but
        after the last build. The bundle was reported fixed while both
        copies still shipped `?image=`. Now built and verified by content:
        two occurrences of `'?img='+n+'.PNG'`, none of `?image=`
     └─ the dev player, line 443, was always right, which is how it hid
     └─ T confirmed 2026-09-14 and corrected their own copy of the claim:
        they had repeated `?image=` out of her page as fact without ever
        requesting it
     └─ external: Alice's repository, a one-line patch there is the fix

9.8  local/vivid-vibes is a shadow copy, not a duplicate input        [A]
     └─ CORRECTED 2026-09-14: the first version of this entry said the
        directory walk picks a winner silently. It does not. Only local/o4d
        is in abap_transpile.json; local/vivid-vibes holds 121 objects, 85
        of which the build also has, and is not an input at all. So it is
        not a race that happens to go the right way — it is a folder that
        looks like source and absorbs edits that reach nothing
     └─ now reported rather than remembered: tools/osd-inputs.mjs runs as
        part of `transpile` and names both shapes, a later input overriding
        an earlier one and a folder beside the inputs that is not one.
        test/osd-inputs.mjs. It prints and never fails the build, because
        either can be deliberate
     └─ what is left for Alice: whether local/vivid-vibes should be the
        input (it is the complete package, 237 files against 60) or should
        go. Today the smaller copy is what runs
```

---

## External dependencies, all of them in one place

```
Lars / abaplint
  ├─ transpiler #1835 (DuckDB driver)          open, see 9.1
  ├─ transpiler #1836 (flat concat chain)      merged 2026-09-13
  ├─ transpiler #1841 (%23 breaks Bun)         open, blocks 1.3
  │   └─ when it reaches npm, SADL_CHUNK can go from both generators
  ├─ open-abap-odata                            license still "todo"
  │   └─ we reimplement, contribute fixes, do not fork
  ├─ open-abap-adt                              license empty, interfaces only
  └─ open-abap-core                             T's APC PR, not written yet

SAP
  ├─ A4H sandbox            only on Alice's word, MCP is read-only
  ├─ abapGit on the box     the blessed last mile
  ├─ SAP-samples/abap-platform-refscen-flight   the RAP oracle, Apache-2.0
  └─ SAPUI5 1.120.50 from the CDN               the apps' runtime

Tooling
  ├─ bun 1.4.2              installed (~/.bun), runs everything
  ├─ Go 1.26                installed (used for the goja spike)
  └─ npm, pinned by the lock file

Known defects we live with
  ├─ no implicit MANDT in the transpiler        ANORMALIES, T0009 kept visible
  ├─ bun does not decode %23 in a specifier     transpiler #1841; blocks
  │     `bun <script>` only — NOT the compiled binary (measured 2026-09-14)
  ├─ bun's bundler emits import.meta + TLA        ANOMALY-2026-09-14; webpack
  │     stays for web:preview, the binary is unaffected
  └─ Bun runs JavaScriptCore, not V8            corrects the vision draft
```

## Effects that render, and render wrong

Noted by Alice watching vivid-vibes run off-stack on 2026-09-14, in the
order the timeline reaches them. All four draw something; none of them
errors. That is what makes them worth writing down rather than fixing by
eye: a frame that arrives, parses and paints is indistinguishable from a
correct one without something to compare against.

- the equaliser's second, coloured part
- `mountains` and the variant after it
- the plasma between copperbars and twistzoomer

The oracle exists: the same scene on a real system, driven to the same
bar. Until somebody runs that comparison these are observations, not
defects, and they are recorded as observations.

One known cause is already upstream and would produce exactly this shape.
`DATA(x) = <arithmetic involving a character literal>` is inferred by
abaplint as a character field whose length comes from the literal, so
`lv_f * '0.25'` lands in a `c(4)` and the value is truncated to a couple of
significant digits. `zcl_o4d_sales_dance` computes its bar heights that
way. The effect runs, the picture is plausible, the numbers are coarse, and
nothing reports it. Whether it explains all four is unknown.

## Two for abaplint/abaplint, both reproduced here

Verified independently on abaplint 2.120.50 with minimal projects, not
relayed: `.local/` scratch, no libraries, no demo. Both have a live
consumer in this repository, which is the part that makes them worth
raising rather than noting.

**Arithmetic against a character literal is inferred as a character
field.** Thirteen lines:

```abap
DATA lv_f TYPE f.
DATA(a) = lv_f * '0.25'.            " -> Character(4)   wrong
DATA(b) = lv_f + '0.25'.            " -> Character(4)   wrong
DATA(c) = lv_f * 2.                 " -> Float          right
DATA(d) = lv_f * CONV f( '0.25' ).  " -> Float          right
```

The literal's length becomes the field's. In ABAP the result of arithmetic
is never character-like; with an `f` operand the calculation type is `f`.
An integer literal does not poison it, a `CONV` does not either — only the
bare character literal. Consumer: `zcl_o4d_sales_dance` computes bar
heights this way, so they are truncated to about two significant digits.
It draws, it looks plausible, and nothing reports the loss.

**`implement_methods` does not honour `DEFAULT IGNORE` / `DEFAULT FAIL`.**
A class may legally omit such a method; the rule demands it anyway.

```abap
INTERFACE zif_t PUBLIC.
  METHODS required.
  METHODS optional DEFAULT IGNORE.
ENDINTERFACE.
```

A class implementing only `required` gets `Implement method "optional"`
[E]. The control matters: removing `DEFAULT IGNORE` produces the identical
message, so the rule is not reading the modifier at all, although the
parser understands it (`method_def`, v740sp08, marked as available in
OpenABAP). Consumer: a class that legitimately omits an optional method
cannot be transpiled, and the error says "implement this" where ABAP says
"you need not". Switching the rule off in the project does not help — the
transpiler runs its own mandatory set.

Raise as pull requests rather than issues where the fix is small, and note
what Lars said on transpiler#1836: a branch inside the repository triggers
the regression and performance suites and a fork's branch triggers neither.
Write access is the deciding factor; `oisee` had none on open-abap-core
(403) and #1218 went as a fork.

## W.1 second sieve — the SQL a system actually ran (2026-09-19)

`STG_SQL_TRACE=<file.ndjson>` records every statement the chosen client is
asked for; `npm run sql:compare -- a.ndjson b.ndjson [--rule literals]`
compares two of them. `tools/osd-sql-trace.mjs`, suite `test/sql-trace.mjs`.

**Why this sieve and not another.** The database seam is the one place where
being wrong is invisible from outside: a missing MANDT, a different ORDER BY,
an N+1 where the system issues one statement, a different FOR ALL ENTRIES
chunking — every one can produce the right answer by accident and none of
them shows in a response body. And our side is nearly free, because all
transpiled ABAP talks to exactly one object with eleven methods, so there is
one interception point and no new protocol.

The tracer is installed in `test/setup.mjs` rather than in a client. Six
paths there choose six different clients, and a tracer written into one of
them is a tracer the other five do not have.

**Calibrated, not asserted.** Two `npm run unit` runs, in two processes,
7075 statements each:

- before any rule but whitespace: **34 of 7075 differ**, first at 5398
- every one of the 34 came from `ZOSD_TSES` — a session id built from the
  clock, its `created`/`touched` stamps, and the 16 reads carrying that id
  in a WHERE
- with one rule for exactly that: **identical, 7075 statements**

The rule is narrow on purpose — a 32-digit run and a date-shaped 14-digit
stamp, never `\d+` — and the suite asserts both halves: that two runs differ
without it, and that a `LIMIT 100`, a row count and an eight-digit key
survive it. The first sieve nearly masked its own row counts with a rule
that wide, and a check that cries wolf gets turned off.

Literals are **not** masked by default. Two systems of ours hold the same
data, so a different value is a difference until somebody says otherwise;
`--rule literals` is for the day the other side is a real system.

**What is left for O.1**: the other half, an ST05 or ADT trace taken on A4H
and brought to the same canonical form. That needs the sandbox and therefore
an ask — the cheap half is done and the ask is now a single one.

## W.1 branch plumbing, and what its first real run found (2026-09-19)

`node tools/osd-branch.mjs add <name> [--from <ref>] [--port N]` plants a
worktree with **its own port and its own database file**, `list`, `remove`.
`tools/osd-branch.mjs`, suite `test/osd-branch.mjs`.

The worktree half already existed — `tools/osd-worktree.mjs` shares
`node_modules`, `.local/lars` and `.local/tls` by symlink — and was nearly
written a second time. This is only what W.1 needs on top.

Three things a fresh worktree does not have, and all three fail quietly:

- **a port.** Asked of the operating system, not picked from a range. The
  first version read `address()` on the line after `listen()` and
  destructured `null`; a guess from a range would have worked most of the
  time, and when it did not, two branches would not error — they would
  answer each other's requests.
- **a build.** An unbuilt tree **listens**. It answers 503 to everything, so
  the first replay against one reported thirteen differences of "200 against
  503", which is a true statement about nothing. `isBuilt()` is checked and
  said out loud.
- **the packs' `upstream/`.** The third thing git does not carry. A fresh
  worktree refuses with `UNFETCHED`, correctly. It is **fetched, not shared**:
  a pack pins its upstream by commit in its own manifest, so a ref that moved
  the pin needs different content and a shared folder would quietly hand it
  the other branch's.

### The finding: a generation name is not a function of the commit

Two worktrees at one commit, built by the same command:

```
w1probe  build 1 -> f3ad1cc3189dd5c7
w1twin   build 1 -> fd5fd5a895011136      same commit, another name
w1twin   build 2 -> c0071cd2fef44a3e
w1probe  build 2 -> c0071cd2fef44a3e      the two converge
either   build 3 -> "already built"       and only now does the cache hit
```

`gen/` is an input to the generation hash **and is written by the build**, so
the hash is self-referential: the first build of a fresh tree names itself
from the pre-generation state, and no later build of that commit will ever
name that generation again. Consequences, in the order they cost something:

- "the build is cached by input hash, so the second branch is often free" is
  **false for the first build** of a fresh tree, always
- a generation reported by a freshly built system is not comparable with one
  reported by a settled system, at the same commit
- which is the mechanism behind the deploy rule already in force — compare
  the **commit**, never the generation hash

Not fixed here: `gen/` is an input on purpose (CLAUDE.md records why), so
taking it out is a decision about what a generation *is*, not a repair. What
is fixed is that it is now measured rather than surprising.

### G.10 wave 1 — the analysis, before the screen (2026-09-19)

`npm run sql:summary -- <trace.ndjson>` reads a trace the second sieve wrote
and answers the two questions a trace is opened for: **where the request
went** (per table: count, milliseconds, rows) and **what it did twice**.

Written before the page deliberately. The backlog's own warning about G.10 is
that a screen built first is "a handsome page with no consumer and no
normaliser behind it"; the normaliser is `tools/osd-sql-trace.mjs` and the
analysis is now beside it, so the screen is a rendering job rather than the
work.

The tracer gained what a screen needs and a log alone does not: a **duration**
timed around the call, the **table** taken from the seam's own options where
it gives one (a regular expression over SQL is a guess; `insert({table})` is
not), and the **row count**. A statement that RAISED is recorded too — it is
exactly the one somebody opens a trace for.

`repeated` is the entry the response sieve cannot produce at all: the same
statement with only its values differing, run n times. The answer is right
and the system did the work n times, so nothing shows in a response body. It
is found by counting canonical statements with the literals masked, which is
the one place masking literals is the point rather than a concession.

**First run, on `npm run unit` (6793 statements, 1563 ms):**

```
2263x  217 ms  INSERT INTO "wbcrossgt" (...)
1537x  175 ms  INSERT INTO "tadir" (...)
 906x  161 ms  INSERT INTO reposrc (...)
```

4706 of 6793 statements and 553 of 1563 ms are three tables seeded one row at
a time. Whether that is worth batching is a separate question — a count is
not a defect, and a seed writing one row per object is not surprising — but
it is now a number instead of a feeling, and it is where a third of the
database time of every unit run goes.

### G.10 wave 2 — the buffer, and where a trace may not live (2026-09-19)

`tools/osd-sql-trace-buffer.mjs`: a bounded ring in the host, and a
destination an ABAP screen calls the way the AMDP tile calls HANA —
`CALL FUNCTION 'ZOSD_SQL_TRACE' DESTINATION 'SQLTRACE'` with
`START / STOP / CLEAR / LIST / SUMMARY`. Registered in `test/setup.mjs`, on
the server path and in the browser preview both. Suite
`test/sql-trace-buffer.mjs`.

**Why the buffer is not a DDIC table**, which was the obvious design and
would have made the screen ordinary ABAP with an ordinary SELECT:

- the tracer sits on the one connection every statement goes through, so a
  trace row would trace itself
- a trace row written inside an open LUW is **lost when that LUW rolls back**
  and **changes the commit shape when it does not** — which is the exact
  thing the trace is measuring

A measurement that takes part in what it measures is not one. So the ring is
in the host, bounded, and it counts what it dropped: a screen that shows
three of five statements without saying so is lying quietly.

**Installed always, free while off.** The screen turns tracing on at runtime,
so the wrapper has to be in place at all times; `enabled` is checked first
and the call goes straight through. Measured over 200 000 calls:

```
no wrapper      0.06 us/call
wrapper, off    0.08 us/call     +0.02
wrapper, on     0.38 us/call     +0.31
```

0.02 µs a call is 0.14 ms over the 6793 statements of a whole unit run.

**What is left, and the reason it is a separate wave.** The screen itself.
ABAP has no JSON reader here — `zcl_stg_json` writes, it does not parse — so
the rows reach ABAP one of two ways, and the choice is not free:

1. a **DDIC structure** for a trace row and a `TABLES` parameter, which is
   the honest signature and costs a DDIC object plus a function-group XML
2. the **`zcl_osd_webgui` precedent**: the host writes rows into a table and
   ABAP reads them with Open SQL — but the write must be flushed at
   screen-read time with the ring paused, or it lands in the trace it is
   writing

**Counted, because "cheaper" was an opinion** (osg-osd-i7 asked for the price
in objects, which is the right question):

| route | files | repository objects |
| --- | --- | --- |
| structure + `TABLES` | 7 | 2 — one INTTAB structure, one function group |
| scalar strings (the AMDP precedent) | 6 | 1 — one function group |
| a table ABAP reads with Open SQL | 1 + flush plumbing + a ring-pause | 1 transparent table |

The details that settle it, all read off the tree rather than assumed:

- a `TABLES` parameter names the structure **directly** (`<DBSTRUCT>`), so no
  table type object is needed
- a structure whose fields use built-in types (`INTTYPE`/`DATATYPE`) needs
  **no data elements** — `ZOSD_TEST_ITEM_S` mixes both and proves it
- a function group is **six files** whichever route is taken: the `.fugr.xml`,
  the TOP include pair, the main program pair, and one `.abap` per module
- a destination may answer a `TABLES` parameter: the direction comes from the
  caller's signature at call time (`tools/rfc-replay.mjs`), which is the same
  mechanism the AMDP tile already uses

So the typed route costs **one file and one object more** than the cheapest
honest alternative. And the third route's cheapness was never real: a
persisted DDIC table, flush plumbing, a ring-pause, and a trace that lives
where it can take part in the run — more than the other two, not less.

**Decided: the structure and `TABLES`.** One extra object buys a signature
that says what a trace row is, and the alternative to it was a saving of one
file.

### G.10 wave 3 — the screen, at /sap/bc/osd/st05/ (2026-09-19)

`ZCL_OSD_ST05` over `ZOSD_SQL_TRACE DESTINATION 'SQLTRACE'`, rows typed by
`ZOSD_SQLTRACE_S`. Start, use the system, read what it ran. Measured live:
7 statements after one OData read and one SE16 page, and the summary naming
ZSTG_DEMO 2 statements / 8 rows, ZSTG_STATUS 1 / 3.

Cost, against the estimate: **7 files, 2 objects**, exactly as counted.

Three defects on the way, and all three were of one kind -- **a contract I
had invented rather than read**:

- the destination returned `{EXPORTING: {...}}`. A destination does not
  return an answer; it **fills the caller's typed values**, the directions
  are ABAP's in lower case, and the ABAP `EXPORTING` is the module's INPUT
  (`tools/rfc-replay.mjs` is the reference). My unit tests passed because
  they asked the invention what the invention did.
- the parameter name was matched **with** case. `IV_COMMAND` was never
  found, every command fell back to the default, and so the screen rendered,
  said "off", showed no error, and every button did the same thing. **A
  lookup that misses returns a default, and a default is indistinguishable
  from an answer.**
- the table fixture in the test had `append` making its own row, so
  `fromJson` never touched it. The second fixture was written from the
  reference implementation instead of from memory.

The fourth was somebody else's contract read correctly and mine written
loosely: `esc( )` typed `string` refuses a DDIC `CHAR`, which the syntax
check said before anything ran -- which is the whole reason the row is typed.

And one defect in the generator, found because a structure was added:
`tools/cds2ddic.mjs` wrote a table-access class for **every** TABL, INTTAB
included. A structure is not a table, and for a **keyless** one it wrote a
`DELETE` with no WHERE, which does not parse and stopped the build. The
class it had written for `ZOSD_TEST_ITEM_S` had been there all along, with
nothing referencing it: an object generated from a thing it should not have
been generated from, waiting for the first structure without a key.

### The rest of the one-row inserts, and what the seed fix did not reach (2026-09-19)

`tools/osd-batch-inserts.mjs`, called once in `test/setup.mjs`. Suite
`test/batch-inserts.mjs`.

The seed fix (e088c4d) was measured against an empty database — statement
count, not end-to-end. Measured end to end, on a real `npm run unit`, with
the SQL sieve:

```
6793 statements, 1563 ms    before either
4315 statements,  976 ms    after the seed was batched
1711 statements,  441 ms    after this
```

`WBCROSSGT` left the table entirely after the seed fix — it came from the
seed. `TADIR` (1542) and `REPOSRC` (907) did not, because they come from a
**different writer**: the statements the transpiler hands `setup()`. Not
ours, and one row each.

Two things decided the design, and the second is the one worth keeping:

**The values are never parsed.** A statement is split at `VALUES ` and
everything after is carried verbatim, so a comma or a bracket inside a
quoted string cannot be misread — which is the defect the seed's own test
had, where splitting a five-column row on commas found seven parts. The
answer here is to need no parser at all.

**Merging only consecutive runs caught barely a third**, because the rows
arrive interleaved — a directory entry, then its source, then the next
object's. Merging across other INSERTs is what got TADIR from 1542 to zero,
and it is safe for a reason that can be stated: **an INSERT reads nothing**,
so two inserts into different tables commute, and the rows that end up in
the database do not depend on which went first. Order *within* a shape is
kept. Anything that is not an INSERT is a **barrier** — a CREATE, a DELETE
or a statement the batcher cannot read may depend on what came before it,
and a statement it cannot read keeps its place untouched. A batcher that
dropped what it could not read would be silent data loss, which is worse
than the cost it saves.

The test that matters runs both versions on a real DuckDB and compares the
tables: the claim is not "the text is equivalent", it is "the rows are the
same". `npm run unit`, `unit:file` and `unit:duckdb` are green.

### What a planted branch does not isolate (2026-09-19)

`osd-branch` isolates a branch's **sources, port, database and build**. It
does not isolate its **libraries**, and that is not a detail:

```
.local/worktrees/<any>/.local/lars  ->  /home/alice/.../open-steamgate/.local/lars
```

Every worktree's `.local/lars` resolves to **one directory**. There is no
private checkout of `open-abap-core` — there is one checkout, and whoever
moves it moves it for every branch at once, in the middle of whatever
another session is measuring.

It surfaced as a disagreement about a count: 1140 objects against 1134, with
the repository's own objects matching **exactly** at 420, so all six of the
difference came from libraries the two sessions each believed they had.

So the earlier clean-tree numbers (2 failures, then 0; then 0 / 0 / 0) are
clean of **repository content and `$HOME`**, and not of libraries. The tests
in question do not depend on that part of `open-abap-core`, so the numbers
stand — but the boundary was stated more widely than it was measured, which
is the thing this tree keeps paying for, and naming it is the repair.
`tools/osd-branch.mjs` prints the list, with a reason per entry, on every
`add`.

### `npm run branch -- state`: a count that cannot travel alone (2026-09-19)

Two sessions read the object store 55 seconds apart and got **1140 and
1134**. Both readings were correct, and they were of different systems: the
library clones are ONE checkout shared by every worktree, and one session
had moved `open-abap-core` onto a PR branch twenty upstream commits away —
carrying exactly the six objects of the difference (`char5`, `char64`,
`char100`, `char200`, `cx_osql_failure`, `if_ixml_text`: four DTEL, one
CLAS, one INTF, matching the type deltas to the unit).

Nothing said so. `git status` in the repository does not see it, the input
list does not see it, and the number left without the state it was taken in.

`node tools/osd-branch.mjs state` prints the count, the types **and** the
HEAD, branch and dirty count of every library the build reads — together, so
one cannot be quoted without the others.

**And the first version of it lied within a minute.** `git -C` in a
directory that is not a repository answers about the **enclosing** one,
silently: `.local/lars/open-abap-apc` is a plain folder, and the tool
reported open-steamgate's own HEAD as that library's state. A number
travelling with somebody else's state is worse than one travelling with
none. It checks `--show-toplevel` against the folder now and says "not a
clone" rather than borrowing a hash — with a test that asserts no library
ever reports this repository's HEAD.

### `npm run unit` can say it ran nothing (2026-09-19)

**The provenance, honestly, because the report this came from was wrong.**
osg-osd-i7 reported eight tests that printed `OK` and never ran. They had
run all along: the first reading was `npm run unit 2>&1 | tail -15` over a
seventeen-line file, and the lines were in the middle of it. **A log
truncated by the command that produced it is indistinguishable from a log of
something that never happened** — `tail -15` and "it did not run" look the
same on a screen. (The same knife twice in one day: the morning's
`coverage.mjs` header went the same way through `tail -25`.)

So there was no green-without-a-run. The check stayed for two reasons that
do not depend on the report:

1. **its first run found a real one** — `ZCL_EDITOR`, a test class that
   genuinely never executes — and named why. That is the check's finding,
   not anybody's report.
2. `OK` meant "nothing failed" and never "something passed", and the two
   were printed with one word. "Nothing ran" is the third value of a test
   run's verdict, the way "not measured" is the third value everywhere else
   here, and a verdict that cannot print its third value eventually prints
   the nearest of the other two.

`tools/osd-unit-run.mjs` runs the transpiled suite and then compares what
the **tree** holds against what the **runtime reported**. A test class in
the tree that never appears is named and the run fails. Nothing here checks
whether a test passed — the runtime already does that, loudly.

The classes are counted from the files (`*.clas.testclasses.abap` under an
input folder), not from a generated index, so a test written and not yet
transpiled is a finding rather than an absence. A test include with **no
class beside it** is named as such, because an include without its class is
not an object at all.

**And it uses the build's own `exclude_filter` rather than a second list.**
Its first run named `ZCL_EDITOR` — a fixture under `test/fixtures/`, with
its own `abaplint.jsonc` and an empty test class that exists so the ADT
editor tests have something to read. It never runs because the build skips
that folder. A check that did not know would have cried wolf on its first
run, and a check that cries wolf stops being read.

Note what this does **not** claim: the rule "a test class without its own
`.clas.xml` does not run" is **false in this tree** — five such classes run
every build (`zcl_osd_rfc_test`, `zcl_stg_gateway_test`,
`zcl_stg_phase0_test`, `zcl_stg_segw_test`, `zcl_stg_shlp_test`). And the
cause is now known rather than merely excluded: **nothing was silenced.**
The class ran with the file and without it — eight methods both times — and
what differed between the two readings was not the file but **how the log
was read**. Two things changed between the runs and only one was noticed,
which is the control an experiment needs and did not have.
