# Backlog

Everything open, as a tree, with who owns it and what it waits on.
Written 2026-09-13. `AGENDA.md` stays the narrative record of what was
decided and why; this is the list.

Owners: **S** open-steamgate (including the built-in MIT JavaScript DIAG/RFC
runtime), **T** the transpiler session (`src/segw/**`, the ABAP generators,
connectivity, APC), **V** vsp and **R** open-rfc-go as historical or external
oracle/probe repositories, **A** Alice — a decision nobody else can take.

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
├─ A.12 SRVD + a minimal SRVB: the service definition as an input   next-ish
├─ A.13 abap-fs over RFC: a client that needs no ADT on HTTPS        new 09-19
└─ A.14 coverage by driving a real client, with A4H as the oracle    new 09-19

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
     ├─ **colouring is a word list, not the grammar -- decided 2026-09-25**
     │  (host-tools review S1, Alice accepted it). The display used to ask
     │  the host (`STORE TOKENS`): swap the box's text into abaplint's
     │  registry, parse, call a leaf a keyword when the grammar matched it
     │  as one. Exact, but a cold parse of ~7 s on the first display, a
     │  parse on every display after it, and nothing at all on a host
     │  without the parser (OSGo showed plain text). Now
     │  `src/webgui/zcl_osd_abap_tokens` scans the text in ABAP with no
     │  regex (the Go backend refuses `FIND ... RESULTS`): `*` in column 1
     │  and `"` are comments, `'...'`, `` `...` `` and `|...|` are strings
     │  (a template's `{ }` is code again), `##x` is a pragma, and a word is
     │  a keyword when it is in abapGit's list (MIT, credited in the class).
     │  **What that gives up, on purpose**: a word in the list is a keyword
     │  wherever it stands, so `VALUE` in a method called `value` is
     │  coloured as a keyword; the grammar knew better. What it gains: the
     │  same colours on every host and on a system, and TOKENS is gone from
     │  the Node store (the Go store's refusal of it is a follow-up on
     │  `spike/go-backend`)
     ├─ **the buttons are the host's answer -- 2026-09-25** (host-tools
     │  review D2). `STORE CAPABILITIES` names the commands a host does
     │  (`EV_NOTE`, blank-separated); `ZCL_OSD_EDIT` draws Check, Save and
     │  Activate only for those. Node answers all five; OSGo answers
     │  `LIST READ WRITE`, since it carries no compiler and is a built
     │  generation, so its screen offers Save and says the rest waits for a
     │  build. A host from before the question ("unknown store command")
     │  gets the five it always offered. CHECK and ACTIVATE themselves are
     │  deferred to the incremental rebuild, and the parity rule
     │  `compiler-deferred` keeps the one CHECK test out of the headline
     │  ├─ **and a system with no STORE destination gets a sentence, not a
     │  │  dump.** The call now has `EXCEPTIONS system_failure /
     │  │  communication_failure ... MESSAGE`, which is how a remote call to
     │  │  a destination that is not there comes back on a system; before,
     │  │  that was a short dump. What a system raises for a missing SM59
     │  │  entry is **not measured yet**; the test fakes COMMUNICATION_FAILURE
     │  └─ on this runtime a destination missing from
     │     `abap.context.RFCDestinations` is a plain JavaScript `Error`, not
     │     an ABAP exception, so no ABAP can catch it; every OSD host installs
     │     STORE, so that path is not reached here
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
│    Portable AMDP now executes an unchanged `FOR HDB LANGUAGE SQLSCRIPT`
│    body through typed IR on native DuckDB and DuckDB-Wasm; no `FOR DUCKDB`
│    source variant is needed. The preview bundles pinned single-thread Wasm
│    locally, and ABAP SQL, OData and nested AMDP share its one database/LUW.
│    The Pages publishing pipeline first proves the legacy sql.js preview,
│    then rebuilds for DuckDB-Wasm and publishes only after a browser test
│    selects AMDP and matches the independent ANYDB top-7 on one query.
│    The remaining W.3 expansion is persistence: in-memory Wasm is volatile;
│    OPFS needs restart, checkpoint, single-owner and schema-version tests
│    before it can be promised. The showcase is SQLScript on a public URL,
│    with no HANA anywhere.
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
  compared automatically". **Done 2026-09-20, and it found a sixth on its
  first run.** `tools/sqlscript/grammar-cover.mjs`: every grammar class must
  be bound, refused by name, or listed in `NOT_NAMED` with a reason, and it
  complains in both directions. The sixth was `TableFunctionCall` -- a name
  the binder mentioned nowhere, so `FROM my_func(:p)` fell through the
  wrapper-unwrapping fallback and lowered to `FROM "MY_FUNC"`: the call read
  as a table, the argument gone, no refusal. Reading found it; one
  `compile()` call confirmed it, which reading alone could not, because
  `FROM "MY_FUNC"` looks like working output. Two of the five allowances
  claim a refusal that happens through a `default` branch and names nothing
  in the source, so `test/sqlscript-cover.mjs` runs a DECLARE and an IF and
  reads what comes back.

  The same comparison one storey down — the IR's node names against the
  lowering's dispatch — was run and finds **nothing**: 12 expression nodes,
  10 relations, every one dispatched on, and no branch for a name the IR
  cannot build. No instrument was built for it, and the measurement is
  recorded so that nobody spends an hour discovering the same zero. The
  asymmetry has a reason: the IR is a closed set of constructors in one
  file, the grammar is 32 classes matched by a fallback that unwraps what it
  does not know.

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

**A sixth, 2026-09-20, and this one was found by a tool rather than by hand**
— `FROM my_func(:p)` lowering to `FROM "MY_FUNC"`. That is what the
grammar-against-binder comparison was for, and the first thing it printed.

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

> **The plan, 2026-09-20 — the detailed one is
> [`icf-registry-plan.md`](icf-registry-plan.md), written to be picked up
> after a context compaction without re-deriving anything. The summary
> below is kept in step with it.**
>
> **Order changed once more (correction 3, Alice): B before A.** What is
> served by the host may stay served by the host — it only has to be
> *declared*. That turns "12 rivals to migrate" into "0 rivals, 12
> declared nodes of known types" without moving a file, and what gets
> deleted is the hardcoded route list rather than the serving.
>
> ### Where this is, measured
>
> The A4H loop is closed end to end: one YAML becomes a SEGW project, a
> DDIC, seed rows, an activated service and a Fiori application that a real
> system serves (`docs/a4h-deploy.md`). On this side, `test/segw-tree.mjs`
> is 20 of 20, **CI reads the suites for the first time** (`tests.yml`;
> before it, nothing did), destinations are one registry, `POST /osd/status`
> is an ICF node and its express route is **deleted**, and `ZCL_OSD_BSP`
> serves five Fiori applications and a pack page out of the tree. An
> adversarial review found six defects in that work and all six are fixed,
> including two instruments that lied about themselves.
>
> ### What changed in the design, and both corrections are Alice's
>
> **1. ICF is the only *registry*, not the only *router*.** `ICFHANDLER` is
> a table keyed by `(node, parent, order, TYPE)` whose payload is a handler
> *name*; the tree does not care what is behind it. So the value is a single
> inspectable truth about what the system is made of -- not one execution
> model. The JS parts of OSD (the ADT facade above all) are **not** going to
> A4H and were never meant to; A4H has ADT, the facade imitates it. Under
> the corrected model the facade is *one node of type HOST*, not thirteen
> rivals to migrate.
>
> **2. Do not imitate the storage, imitate the interface.** Pages went into
> a generated ABAP class as base64 -- 137.9 KB -- because a system keeps
> them in `O2PAGELINE`. That was imitating the wrong layer. The pages are
> already files in a directory, and they can stay there.
>
> ### The plan, in dependency order
>
> **A. Pages out of the generated class.** The registry becomes a *list* --
> application, page, MIME, file -- and the bytes come from disk through the
> mechanism this tree already uses for 33 media objects and 16 MB: a
> `@KERNEL` read with a host hook for the browser, disk as the normal path
> rather than the only one. *Done when*: the generated class is a few KB
> instead of 138, changing an image is not a rebuild, and every page still
> answers 200.
>
> **A and B are done (2026-09-20, `ef8101a`).** B first, on correction 3:
> `ICFTYP` is read, the host-served paths are declared in
> `src/icf/nodes.json`, both hosts mount from the registry, and
> `reserved = ["/sap/opu/odata", "/sap/bc/adt"]` is gone from both. A
> followed: the registry class is 8.8 KB and each page is a Web Repository
> object, not base64 in generated source. Scoreboard: 30 nodes, 0
> registrations nobody declared, 0 declared nodes nothing serves.
> `docs/icf-registry-plan.md` carries what each cost. B is closed; the line
> that said the OData front still needed its own `*.sicf.xml` was **wrong**
> -- `/sap/opu/odata/sap/` is delivered by a system and an object of ours
> there would replace `/IWFND/CL_SODATA_HTTP_HANDLER` on import. Looking for
> it found three objects that already have that problem
> (`/sap/bc/gui/sap/its/webgui`, `.../sapevent`, `/sap/bc/ui5_ui5/sap`); they
> answer on the real paths on purpose and now do not travel, by the path
> rather than by memory. The originals are kept below because the reasoning is the record.
>
> **B. A handler row carries a type.** ABAP / HOST / PROXY / CONTENT, each
> saying **where it works** rather than whether it is allowed: ABAP
> everywhere, HOST needs Node (so not the browser preview), PROXY needs a
> socket (not the preview, ever), CONTENT everywhere. Descriptive, not
> normative. *Done when*: `osd-routes` shows the ADT facade as one HOST node
> rather than thirteen rivals, and the scoreboard answers "what does this
> system expose, and what implements it" instead of "what is left to
> migrate".
>
> **The rule C was blocked on is written**: `docs/registry-drift.md`
> (2026-09-20), before the table rather than after it. The table is the truth
> at runtime, an object is a transport applied when it arrives, the tables to
> implement are `ICFSERVICE` and `ICFHANDLER` rather than a `ZOSD_` invention,
> and a row somebody edited that an object contradicts is replaced, kept aside
> and reported.
>
> **C. The registry becomes readable and writable from ABAP.** Seeded from
> `*.sicf.xml`, the way `data/*.tabu.json` seeds tables from abapGit
> objects. This *is* G.5 -- a screen over files would be a picture of a
> registry rather than one. It needs the thing this tree has for the
> database and not yet for this: **a written rule for what happens when the
> table and the objects disagree.** *Done when*: changing a node from a
> screen changes what answers, and a disagreement is reported rather than
> silently resolved.
>
> ### Deliberately not in it
>
> - porting the JS parts to a real system -- the facade is meant to be JS;
> - the launchpad shell behind a node: about forty references in a dozen
>   files, including two e2e suites and the preview. A decision for daylight,
>   not for 5am;
> - `/app` going away: that follows from B and C, not before them;
> - the Fiori scaffolding writers (`@sap-ux/*-writer`), parked with the tile
>   they would serve -- worth one run as an **oracle**, never as a
>   dependency;
> - CDS-BOPF and RAP, still behind the HANA path being released.
>
> **Upstream is merged and unshipped** and nothing here waits on it:
> transpiler #1874 and #1877 merged, `@abaplint/database-hdb` still 404 on
> npm, the transpiler still 2.13.89 with `hdb: ["todo"]`; transpiler #1878
> still open with no replies. **abaplint #4311 and #4312 were merged by
> larshp on 2026-09-20** (08:24 and 08:38) -- both unreleased, so both
> workarounds stay: `withoutBangValue()` in `tools/amdp-extract.mjs` and the
> colon handling in the SQLScript parser. Their expiry tests fire on the
> release, not on the merge, which is the honest trigger: merged is not
> shipped. Not ours to push.

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

# The standing list
