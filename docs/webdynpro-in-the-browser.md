# Track W (Web Dynpro): the handlers run where the person is

*Written 2026-09-19 from Alice's proposal. A track proposal, not a plan with
dates: the first wave is designed to answer whether the rest is worth doing.*

## The idea, and why it is not a rewrite

Web Dynpro ABAP is slow for a structural reason rather than a sloppy one:
**the state lives on the server**, so every action is a round trip, and the
round trip is the cost. The proposal is to run the component **and its own
ABAP handlers** in the browser, and to reach the application server only when
the ABAP actually goes outside — to the database, to RFC, to a lock.

Nothing in the customer's code changes. That is the whole pitch, and it is
the same sentence as the one at the top of the README, applied to latency
instead of to installation: **the system runs where the person is.**

## What this repository already owns that makes it plausible

- The transpiler already executes arbitrary ABAP **in a browser**. The public
  preview is a whole application server in a service worker.
- **The data boundary already exists and is one object.** Every statement in
  the system goes through `abap.context.databaseConnections["DEFAULT"]` and
  its eleven methods. "Go to the server only for data" is therefore not a new
  architecture — it is a second implementation of a seam we already have.
- That seam is **already asynchronous**: the transpiled ABAP awaits every
  database call, so there is a suspension point at exactly the place where a
  remote call would have to happen. Nothing needs to be re-shaped to allow it.
- abapGit serialises the component metadata, so the input is a repository
  rather than a system.

## Seven waves, and the real work is in three of them

**1. Metadata, and the corpus count.** Read a component out of abapGit —
views, controllers, context, plugs, bindings — and print its structure.
Mechanical. Its real purpose is the **measurement**: how many components
exist, which UI elements they actually use, and how many of them stand on
Floorplan Manager. That number can open the track or close it in a day, which
is why it is first. Same discipline as the SQLScript work: enumerate from the
reference, rank from the corpus, and never the other way round.

**2. The context.** Hierarchical nodes and elements, lead selection,
cardinality, singleton and non-singleton nodes, supply functions. This is
where the whole semantics of Web Dynpro lives and it is the largest single
piece of work in the track. Nothing above it means anything until it is right.

**3. The phase model.** `wddoinit`, `wddobeforeaction`, the action handler,
`wddomodifyview`, exit — and the order they fire in. The methods themselves
already run, because they are ordinary transpiled ABAP; the work is giving
them the environment they expect (`wd_context`, `wd_this`,
`wd_comp_controller`, the view API). By kind this is the same job as the
`/IWBEP/` interfaces: reimplement the contract, bundle none of SAP's code.

**4. Rendering — our own HTML, not an imitation of Unified Rendering.**
Copying somebody else's DOM is a race that cannot be won and does not need to
be run: the view metadata says what the screen is, and we can draw it. Rank
the UI elements by the corpus and cover the head of that list; refuse the tail
**loudly** rather than rendering it approximately.

**5. The boundary.** A remote database client against the same eleven-method
seam, and RFC through the same door. For read-mostly screens a subset of the
data can be shipped to the page instead, and then even the data call is local.

**6. Transactions, locks and authorisations — the one place this can become a
hole.** A handler run in the browser is a **prediction, not a decision**. The
browser cannot be trusted: an `AUTHORITY-CHECK` evaluated in a page is not a
check, and a write the client considers valid is a security boundary handed to
whoever opens dev tools. So the rule is absolute and comes before any of the
speed: **anything that changes data is re-executed or re-validated on the
server.** The client owns the response time; the server owns the truth. This
is the same pair as the transactional buffer and the draft, one storey up.

**7. A compatibility report.** Point it at a component and get back what will
run, what will not, and why. Roadmap and honest answer in one artefact.

## The beachhead

**One simple real component, without Floorplan Manager and without ALV, taken
all the way through**: metadata, context, three phases, five UI elements, a
remote database client. One component that *flies* answers the question the
whole track hangs on, and the corpus count taken alongside it says how many
components in the world look like that one.

## What can kill it, stated in advance

- **The surface.** Web Dynpro is a large framework and FPM is another large
  framework on top of it. If the corpus turns out to be mostly FPM, the track
  as described is much longer than it looks.
- **The promise.** "Your Web Dynpro just works" is the failure mode: the first
  person with a real application will be right to be disappointed. The
  defensible claim is a measured coverage curve over a named class of
  components, exactly as with SQLScript — coverage counted **per component**,
  not per feature, because a component needs everything it uses.
- **Fidelity of the phase model.** The order in which the phases fire, and
  what is legal in each, is the kind of contract that is easy to get almost
  right and hard to notice being wrong. It wants an oracle: the same component
  on a real system and here, compared — which is what track W.1 builds anyway.
