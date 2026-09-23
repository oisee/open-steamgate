# gogen: a Go backend for transpiled ABAP (spike)

A measurement, not a product. The question was whether a second backend for
the abaplint transpiler, one that emits Go instead of JavaScript, is worth
building. The rationale is the research page "Куда транспилировать ABAP".
This folder answers it on a small, controlled subset.

```
node tools/gogen/run.mjs            # ABAP -> IR -> Go, and the same ABAP through the JS transpiler
```

Needs Node (`node_modules` of the checkout, for `@abaplint/core` and
`@abaplint/transpiler`) and Go >= 1.26. Nothing is written outside this
folder: `.out/` and `go/cmd/bench/zz_generated.go` are generated and ignored.

## Shape

```
samples/*.clas.abap
  -> @abaplint/core (parse, syntax, scopes)          reused, not rewritten
  -> transpiler's Rearranger (operator precedence)   reused, not rewritten
  -> frontend.mjs: IR                                typed, calculation type decided, conversions explicit
  -> emit-go.mjs: Go                                 spells the IR, decides nothing
  -> go/abap: runtime                                ABAP semantics where Go's differ
```

The IR is the part that matters for the real thing. The calculation type of
every arithmetic expression is fixed in the front end, and it **includes the
target**. That is the rule ANORMALIES measured on A4H: `lv_f = lv_i / 2` is
1.5 and the `i` version is 2. So a backend never tests a type at run time.
Values are plain Go values: `int32` for `i`, `float64` for `f`, a slice for a
standard table. A method is a function taking the `Session` first. The
Session is the roll area and carries `sy`, so any goroutine can run any
session.

Subset, grown until two demo scenes compile unchanged: `i`, `f`, `int8`,
`string`, `c`, `x`; structures and standard tables of anything in the
subset; instance and static classes, attributes, constructors with DEFAULT
parameters, interface methods and constants; `DATA( )` inline, `CONV`,
`VALUE` (nested `VALUE #( )` too), string templates and `&&`; `IF`, `CASE`,
`DO`, `WHILE`, `LOOP AT ... INTO`, `APPEND`, `READ TABLE ... INDEX`,
`TRANSLATE`, `EXIT`, `CONTINUE`, `RETURN`, `CLEAR`; method calls with
positional, named and EXPORTING/IMPORTING parameters; `sin cos tan sqrt exp
log abs sign floor ceil trunc frac nmax nmin lines strlen`;
`sy-index sy-tabix sy-subrc`. Anything else is `Unsupported` with its name,
and a method that calls a refused one is refused in turn. Refused on
purpose until measured: `i` -> `string` (the sign goes to the end there),
and arithmetic whose calculation type would be `p`.

## Measured, 2026-09-23

16-core x86-64 workstation (WSL2), Node 26.9, Go 1.26.0,
`@abaplint/transpiler` 2.13.89 from npm (without the plain-arithmetic flag of
the `transpiler-codegen` fork).

| work (median) | Go | JS | JS / Go | same answer |
| --- | ---: | ---: | ---: | --- |
| plasma frame, 320×200, sin/cos/sqrt per pixel | 1.66 ms | 23–25 ms | 14–15× | yes |
| fib(25), recursive static calls | 0.24 ms | 22–25 ms | 95–105× | yes |
| primes to 50 000, nested WHILE with MOD | 1.6 ms | 91 ms | 55× | yes |
| 1 000 000-row table: APPEND, LOOP, READ INDEX | 8.6–10.7 ms | 330–370 ms | 35× | yes |

Plasma frames per second, one Session per goroutine, nothing shared:

| JS, one thread | Go ×1 | ×2 | ×4 | ×8 | ×16 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 40 | 588 | 1027 | 1661 | 2350 | 2798 |

Build and size: front end + emit 150–190 ms, `go build` 0.16–0.74 s (warm
or cold cache), binary 2.0 MB stripped, of which almost all is the Go
runtime. The generated Go is 4.9 KB; the transpiled JS is 14.2 KB.

Where the time goes, in order of the ratios. A call is the costliest thing
in the JS output: every method is `async`, and every call is an `await` with
boxed arguments (fib, 95–105×). A table row is an object (35×). Arithmetic
through the operator protocol costs 15–55×. Plasma is the smallest gap
because `Math.sin` is the same cost in both.

## Language or model? The same IR emitted as JS

`emit-js.mjs` writes JavaScript from the same IR, with the same value model
as the Go backend: numbers instead of boxed ABAP values, synchronous calls
instead of an `await` on every one, the calculation type decided at compile
time, structures as objects copied on a move. The runtime (`js/abap.mjs`)
follows `go/abap` line for line. It answers the same as Go on all 21
semantic cases and on every frame of both scenes.

| work | transpiler JS | JS from the IR | Go | transpiler / IR | IR / Go |
| --- | ---: | ---: | ---: | ---: | ---: |
| plasma kernel (sample) | 25.5 ms | 3.6 ms | 2.1 ms | ×7 | ×1.7 |
| fib(25) | 24.0 ms | 0.96 ms | 0.24 ms | ×25 | ×4.1 |
| primes to 50 000 | 93 ms | 3.4 ms | 1.6 ms | ×27 | ×2.1 |
| table of 10⁶ rows | 311 ms | 11.3 ms | 8.7 ms | ×28 | ×1.3 |
| scene glitch, a frame | 205 µs | 16.4 µs | 14.2 µs | ×12.5 | ×1.15 |
| scene plasma, a frame | 2527 µs | 218 µs | 117 µs | ×11.6 | ×1.9 |

So most of the gap is the model, not the language: the same IR in JS is
7-28 times faster than today's transpiler output, in the browser too. Go
adds 1.2-4 times on top, most on calls (fib), and every core of the
machine on one session's work.

## Demo scenes against A4H

`node tools/gogen/scenes.mjs <scene>` compiles one scene of ZO4D straight out
of `packs/o4d/upstream` (the interface and the class, nothing rewritten),
gives its `render_frame` the context of every frame of the A4H recording
(`t`, `gt`, and `pos_16` computed like `ZCL_O4D_APC_HANDLER=>CALC_BEAT_INFO`),
and compares lines, rects and texts number by number with the recording.

| scene | frames equal to A4H, Go | frames equal to A4H, JS (npm 2.13.89) | Go a frame | JS a frame | JS / Go |
| --- | ---: | ---: | ---: | ---: | ---: |
| glitch | 64 of 64 | spot-checked equal | 14 µs | 205 µs | ×14.5 |
| plasma | **256 of 256** | 249 of 256 | 140 µs | 2527 µs | ×18 |

The seven plasma frames the JS runtime gets wrong (10, 41, 161, 177, 192,
208, 223) are exactly ANOMALY-2026-09-17-integer-division-not-rounded: a
`/` inside an integer expression keeps its fraction there. The Go backend
rounds it, because the IR computes the calculation type of the whole
expression, target included, which is what A4H does.

The f format of a string template was measured on A4H before it was
written (fifteen values, `go/abap/fmtf_test.go`): seventeen significant
digits, always positional, trailing zeros dropped.

## Semantics: what the two backends answer

Every row below was measured on A4H with ABAP Unit (2026-09-23).
| case | ABAP rule | Go | JS |
| --- | --- | --- | --- |
| `7 / 2`, `-7 / 2`, `5 / 3`, `-5 / 3` (i) | 4, −4, 2, −2 | same | same |
| `0 / 0`, `1 / 0` | 0, CX_SY_ZERODIVIDE | same | same |
| `7 DIV -2`, `7 MOD -3` | −3, 1 | same | **−4, 2** |
| `-7 DIV -2` | 4 | 4 | **3** |
| `MOD` with negative operands | never negative | same | same |
| f 2.5 / −2.5 / 1.4999 → i | 3 / −3 / 1 | same | same |
| f 3e9 → i | CX_SY_CONVERSION_OVERFLOW | same | **3000000000** |
| i 3 / i 2 into f | 1.5 | 1.5 | 1.5 |

The JS disagreements are recorded in ANORMALIES. DIV and MOD with a
negative divisor are fixed upstream in abaplint/transpiler#1885; f -> i
without an overflow is a question for Lars, not a patch.

## What this does not show

- Two scenes out of about forty, each read in isolation: the handler, the
  demo director and the scene switching are not compiled, the context is
  built by the harness.
- No database, no `p`, no exceptions beyond arithmetic and conversion, no
  dynamic calls, no references to interfaces (the harness calls the class).
  Those are the expensive parts of a real runtime port (`@abaplint/runtime`
  is 11.2k lines of TS).
- JS runs one thread here. The pool of backlog B.12 takes the JS side to
  several processes, 474 -> 1646 frames/s on the demo. The Go numbers show
  the same thing inside one process, with no socket pinned to a process.
- Tables are Go slices: assigning one table to another would share it,
  where ABAP copies. The front end refuses table assignment until
  copy-on-write exists.

## Next, if this is pursued

1. The rest of the recorded scenes (copperbars, joydivision, cell16/24,
   ignite_emit, ...) and then the demo's director, so the harness no longer
   builds the context.
2. Zork: one closed interpreter of 3k lines, strings, `xstring` and a deep
   call graph, compared by transcript.
3. Only then the IR inside the transpiler, gradually: an IR node may be an
   opaque JS chunk, the Go backend refuses those.
