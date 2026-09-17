# The conformance suite: the questions, over HTTP, against a base URL

*2026-09-17, backlog N5 of the no-regret set
(`docs/shift-right-and-quick-wins.md`). The wire tests start the application
in this process and ask it questions, which proves that our code answers.
This suite asks the same questions of a **base URL**, which is the only test
that can be pointed at a second implementation — the Bun binary, a Go
rewrite, a browser deployment, or, with the read-only tags, a system that is
not ours.*

## The shape

| file | what it is |
| --- | --- |
| `test/conformance/suite.mjs` | the questions as **data**: an array of cases, each a request and what the answer must look like. It imports nothing at all. |
| `test/conformance/run.mjs` | the runner: performs each case over plain HTTP, compares, prints a table, exits non-zero on a failure. Node builtins only. |
| `test/conformance.mjs` | a mocha wrapper, one `it` per case, run by `npm test` against the tree's own server on `STG_PORT`. Read-only cases only. |

A case:

```js
{
  id: "top-skip-inlinecount",
  name: "$top / $skip / $inlinecount page the set and count it",
  request: {method: "GET", path: "/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet?$top=2&$skip=1&$inlinecount=allpages"},
  expect: {status: 200, jsonPath: [
    {path: "d.results[*].TravelId", deepEquals: ["T0002", "T0003"]},
    {path: "d.__count", equals: "2"},
  ]},
  tags: ["read", "query"],
}
```

`expect` takes `status` (a number or a list), `contentType` (a substring),
`headers` (a value, or `{matches}`), `jsonPath`, `contains` (substrings of the
body), `xpathish` and `bytes`. `jsonPath` paths are `d.results[0].TravelId`,
with `[*]` mapping over an array so a whole column can be compared in one
line, and a rule is `equals` / `deepEquals` / `matches` / `number` / `type` /
`length` / `minLength` / `contains`. `xpathish` is
`{element, attrs}` — *an element with these attributes exists* — which is
enough of XPath for a `$metadata` assertion without a parser and without
depending on the order the attributes are written in. `{base}` in a path or
in an expected value is the base URL of the host under test, so the
`__metadata.uri` of a row can be checked anywhere. `csrf: true` on a request
asks the host for a token the way a client asks, rather than assuming ours.

## Running it

```
npm run conformance -- --base http://localhost:3030
node test/conformance/run.mjs --base https://osd.example:44330 --tags read,adt
node test/conformance/run.mjs --base http://localhost:3030 --include-mutating --json out.json
node test/conformance/run.mjs --list
```

Output is a line per case, the failures carrying the difference:

```
ok   cds-navigation                   to_Bookings below the parent carries the rows the ON condition selects
FAIL status-system                    SystemSet has exactly one row: the system answering
                                       -> d.results[0].Sid: undefined does not match /^\S+/

56/57 passed, 1 failed
```

Exit 0 only if every selected case passed. `--json` writes the same results
as a file, which is how two hosts are compared.

## The tags

`read` and `mutating` say whether a case changes anything; every case carries
one of the two. The rest name the surface: `odata`, `metadata`, `query`,
`nav`, `media`, `valuehelp`, `function`, `sadl`, `cds`, `analytics`,
`status`, `app`, `icf`, `adt`, `error`, `batch`. `--tags a,b` keeps the cases
carrying any of them.

**`mutating` is off unless `--include-mutating` is given, and it is never
aimed at a system that is not ours.** Those cases create, change and delete
rows in `ZSTG_DEMO`; they are ordered, they run as a set, and the last of
each group puts the tree back as it was. On a foreign host the read tags are
the whole suite.

## Pointing it at another host

- **the tree's own server** — `npm start`, then `--base http://localhost:3030`.
  All 57 pass, writes included.
- **another machine** (the i7, a container, the Bun binary) — the same,
  with that host's address; `https://` works, and a self-signed certificate
  needs `NODE_TLS_REJECT_UNAUTHORIZED=0` or the certificate in the store.
- **a system that is not ours** — read tags only, and `--logon env`:
  the runner takes `OSD_SAP_USER` / `OSD_SAP_PASSWORD` out of the
  environment as basic auth and `OSD_SAP_CLIENT` as `sap-client`.
  **Credentials never go on the command line and never into a file**, so
  nothing is written down and nothing appears in a process list. The demo
  services do not exist on such a system: point it at the tags whose cases
  a real service answers, or add cases of that system's own.
- **the browser preview** — `node scripts/serve-build.mjs` on 3031 serves
  `build/preview`, and an HTTP client gets **only the static files** from it:
  measured 2026-09-17, 3 of 45 read cases pass (`launchpad-page`,
  `launchpad-packs`, `unknown-service-is-404`) and 41 are 404. That is not a
  defect: in the preview the gateway *is* a service worker inside the page,
  so nothing intercepts a request that no page made. Conformance against the
  preview needs a browser, i.e. the suite evaluated from inside the page —
  worth doing, not done here.

## What it does not cover

The suite is the black-box part of `test/mocha.mjs` and `test/analytics.mjs`.
What stays in those files is what a black box cannot see: that a `$filter`
arrives at the DPC *as select-options* rather than merely selecting the right
rows, that a source file on disk matches what is served, that the annotation
compiler emitted a term. A case here can only assert the answer.
