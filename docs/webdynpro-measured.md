# Web Dynpro, measured: what the reimplementation surface actually is

*The three queries the critic asked for, run on the A4H sandbox 2026-09-19.
They were asked because `docs/webdynpro-in-the-browser.md` proposed a track
without computing the closure first, which is the one thing `CLAUDE.md`'s
"First move (Sprint 0)" says to do before any architectural commitment.*

The critic expected a long tail and said the track closes for the price of an
afternoon if it appeared. **It did not appear.** The numbers below are the
reason to keep the track alive -- in the reformulated shape, not the original
one, whose load-bearing argument the same critic destroyed and the author
withdrew.

## 1. The population: 2710 components, none of them a customer's

| | |
| --- | --- |
| active Web Dynpro components | **2710** (all `VERSION = 'A'`, no inactive twins) |
| authored by SAP | **2710** |
| authored by anyone else | **0** |

**This is the first caveat and it is not small.** A4H is a vanilla NetWeaver
sandbox: what is measured here is how **SAP** writes Web Dynpro, not how a
customer does. Every number below inherits that. It is the same shape of
error the AMDP corpus taught us this week -- a corpus answers the question it
is a corpus of -- so it is stated first rather than in a footnote.

## 2. Component usage: a quarter of components pull in a framework component

| | |
| --- | --- |
| components using at least one other component | 1198 of 2710 (44%) |
| of those, using `SALV_WD_*`, `WDR_*` or `FPM_*` | **690 (58%)** |
| as a share of all components | 25% |

The most used components, by number of users: `SALV_WD_TABLE` **394**,
`WDR_OVS` **297**, `WDR_SELECT_OPTIONS` **110**, `WD_SELECT_OPTIONS_20` 38,
`IWD_PERSONALIZATION` 32, `FPM_HCT_FEEDER_GUIBB` 18.

This confirms the critic's point that "a component without ALV and without
select-options" is not a representative beachhead: those two *are* the screen
furniture of real Web Dynpro, they arrive as **component usage**, and a
component usage across a page/server boundary would need the same object
instance on both sides, which is not achievable.

## 3. The decisive one: the framework surface a component actually touches

Method bodies live in `WDY_CTLR_COMPO.CODE_BODY`. There are **151,000** of
them (93,659 methods, 33,952 event handlers, 22,502 actions, 1,604 supply
functions). 22,326 contain `wd_context->`; **6,000 of those were pulled and
analysed** (27% of that population, 15.9 MB of ABAP).

Against the methods declared by the **161 `IF_WD_*` interfaces (1,464
methods)** and **395 `CL_WD_*` classes (8,110 methods)** -- 4,735 distinct
method names in all:

| | |
| --- | --- |
| framework methods **called at all** in the sample | **661** of 4,735 declared |
| share of all method calls that are framework calls | **78%** |
| methods covering **80%** of framework calls | **25** |
| methods covering **90%** of framework calls | **62** |

The head, with call counts: `get_child_node` 10,393 · `set_attribute` 7,133 ·
`get_element` 4,590 · `get_attribute` 2,825 · `get_static_attributes` 1,796 ·
`wd_get_api` 1,550 · `bind_table` 1,336 · `set_static_attributes` 992 ·
`path_get_node` 871 · `get_static_attributes_table` 749 · `get_node_info` 707
· `invalidate` 565 · `set_attribute_value_set` 545 · `set_visible` 532 ·
`set_lead_selection_index` 448 · `get_text` 386 · `get_message_manager` 350 ·
`bind_structure` 349.

The types, by how many bodies name them: `IF_WD_CONTEXT_NODE` 7,249 ·
`IF_WD_CONTEXT_ELEMENT` 4,049 · `IF_WD_COMPONENT_ASSISTANCE` 3,037 ·
`CL_WD_UIELEMENT` 965 · `IF_WD_WINDOW` 782 · `CL_WD_UTILITIES` 607 ·
`IF_WD_CONTEXT_NODE_INFO` 542.

**So the answer to "how big is the thing we would have to write" is 25
methods for four calls in five, and 62 for nine in ten** -- and they are
overwhelmingly the context API, which is the part the proposal already
identified as the largest piece. That is a fortnight of work, not a research
programme. The 4,074 declared-but-never-called methods are the reason the
question had to be asked as a **frequency** rather than a count: the surface
of Web Dynpro is enormous and the surface it is used through is not.

### What this number is not

- **Name-matched, not resolved.** A call counts as framework if its method
  name is declared by any `IF_WD_*`/`CL_WD_*`. Names like `init`,
  `get_parameter` and `set_name` are also perfectly ordinary application
  method names, so the 78% and the 661 are **upper bounds**.
- **Biased on purpose.** The sample is bodies containing `wd_context->`, so
  it over-represents context work -- which is right for sizing the context
  API and wrong for anything else.
- **The head is not the whole job.** 62 methods covers 90% of *calls*, not
  90% of *components*: a component that needs one method outside the 62 is a
  component that does not run. The honest reading is "the interpreter becomes
  useful early", not "nine components in ten work".

## 4. FPM, which the critic said flips the beachhead

| interface | implementing classes |
| --- | --- |
| `IF_FPM_GUIBB` | **687** |
| `IF_FPM_GUIBB_LIST` | 357 |
| `IF_FPM_GUIBB_FORM` | 313 |
| `IF_FPM_GUIBB_SEARCH` | 129 |
| `IF_FPM_GUIBB_TREE` | 77 |

687 feeder classes against 2710 components. A feeder is an **ordinary ABAP
class** with a data-in/data-out interface: it transpiles today, it has no
generated controller, it touches no context API, and its screen is a
configuration file. As a first target it is both larger as a population and
smaller as a framework than a hand-written component.

## What this changes

1. **The closure is not fatal.** 25 methods for 80%, 62 for 90%. The track
   does not close on the ground the critic expected it to.
2. **The beachhead moves to an FPM feeder**, on the critic's reasoning and
   these counts, not a plain component.
3. **The original claim stays dead.** None of this rescues "run the handlers
   in the browser and go to the server only for data" -- that argument died
   on the seam being in the wrong place, on statement-level remoting turning
   one round trip into N, and on sound re-validation reconstructing the round
   trip it removed. What survives is the other product: **Web Dynpro running
   with no system behind it at all**, in the preview where the ABAP and the
   database are already in the page. There the remote call does not exist,
   so none of those three objections applies -- and the price is exactly the
   62 methods above plus the controller generator.
4. **A customer corpus would answer a different question** and nobody here
   has one. Until then every number on this page is about SAP's own code.
