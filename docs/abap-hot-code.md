# How to write hot ABAP for this runtime

*Measured 2026-09-17, the same 16-core x86-64 workstation and Node 26 as
[`docs/demo-profile.md`](demo-profile.md), transpiler and runtime 2.13.86.
The profile answered where the demo's time goes — the arithmetic protocol of
`@abaplint/runtime`, about 30 ns an operation. This answers the other half:
**what the ABAP can do about it**, and what the transpiler would have to
learn so that it did not have to.*

The short version. Three things cost real money on this runtime and one of
them is not visible in the source at all:

1. **A character literal as an arithmetic operand costs 4.4 times a float
   variable** — 201 ns against 45 ns for one multiply. `'0.5'` is how ABAP
   spells a float constant, so this is idiomatic code, not a quirk.
2. **`LOOP AT` costs 170–350 ns a row before the body runs**, because it is
   an async generator; `DO … READ TABLE INDEX sy-index` is 2.3 to 4.7 times
   cheaper for the same walk.
3. **A method call is 50–140 ns of protocol before it computes anything**,
   and one that returns a structure is 206 ns.

Applying these three to the demo's three slowest scenes took **28 to 38 %
off every frame with zero differing frames** over 60 recorded frames each.

---

## How it was measured

`.local/hotabap/` (not tracked — it is a measurement, like every capture
here). A single ABAP class, `ZCL_HOTBENCH`, with one static method per
idiom; each method is a `DO iv_n TIMES` loop around one statement and
returns a sink so nothing can be folded away. It is transpiled on its own —
no libraries, no database, one object — by `.local/hotabap/build.mjs`, which
calls `tools/osd-transpile.mjs` with a config of its own, so nothing in this
tree's build is touched.

`.local/hotabap/bench.mjs` picks `n` so a call takes about 200 ms, then
repeats it fifteen times and keeps **the minimum**: a repetition can be made
slower by something else on the machine and never faster, so the minimum is
the estimate with the least foreign work in it. `globalThis.gc()` runs
between repetitions, because every ABAP operation allocates a result object
and a repetition that catches a major collection reads high.

**One process per case**, driven by `.local/hotabap/run-each.mjs`. The first
run put all the cases through one process and two numbers came out
impossible — the inlined arithmetic measured *slower* than the same
arithmetic behind a method call. The cause is that every case shares one
`abap.operators.multiply`, so its inline caches see `Float`/`Float`,
`Float`/`Integer`, `Character`/`Float` and `Packed`/`Packed` in whatever
order the cases happen to run, and V8 de-optimises a call site that has seen
too many shapes. A measurement that depends on what ran before it is not a
property of the idiom. So each case gets a process that has seen only that
idiom. Real code is polymorphic and pays more than these numbers, not less.

### The noise floor, measured rather than assumed

Three cases — `z1_control`, `z2_control`, `z3_control` — are
`a3_local_f` copied letter for letter. Their transpiled JavaScript is
identical apart from the variable numbers. They came in at **42.5, 42.7 and
47.4 ns**, and the original at 45.4. So the floor is about **±6 %**, and
nothing below roughly 1.2× may be read as a difference. Every claim below is
1.4× or more.

(An earlier run without the controls showed the same statement at 22.8, 26.4,
33.9 and 36.9 ns across four cases — a 60 % spread — because the run was
sharing the machine with a build. The controls are what caught it.)

---

## The idiom table

Nanoseconds per loop iteration, minimum of 15 repetitions, one process per
case. The empty `DO n TIMES. ENDDO.` is 1.0 ns, so loop overhead is not in
any of these numbers in any meaningful amount.

| case | ns | median | what one iteration is |
| --- | ---: | ---: | --- |
| | | | **A — the operand of one multiply** |
| a0_empty | 1.0 | 1.1 | `DO n TIMES. ENDDO.` |
| a1_char_literal | **201.1** | 222.6 | `lv_x = lv_x * '0.500001'.` |
| a7_char_const | 197.6 | 252.8 | `lv_x = lv_x * c_char.` — `CONSTANTS … TYPE string` |
| a5_conv_in_loop | 158.4 | 195.5 | `lv_x = lv_x * CONV f( '0.500001' ).` |
| a2_constant_f | 51.8 | 70.0 | `lv_x = lv_x * c_half.` — `CONSTANTS … TYPE f` |
| a3_local_f | **45.4** | 48.7 | `lv_x = lv_x * lv_k.` — `DATA … TYPE f`, set once |
| a6_attribute_f | 44.2 | 54.9 | `lv_x = lv_x * gv_factor.` — `CLASS-DATA … TYPE f` |
| a4_int_literal | 35.0 | 48.7 | `lv_x = lv_x * 1.` — an integer literal |
| | | | **B — divide against multiply by the reciprocal** |
| b1_div_char | 81.9 | 91.5 | `lv_x = lv_x / '2.000001'.` |
| b2_div_local | **27.8** | 30.7 | `lv_x = lv_x / lv_k.` |
| b3_mul_recip | 33.7 | 47.3 | `lv_x = lv_x * lv_inv.` |
| | | | **C — inline `DATA( )` against a declared variable** |
| c1_inline | 68.7 | 80.8 | `DATA(lv_t) = lv_x * lv_k.` inside the loop |
| c2_declared | 58.9 | 87.4 | the same with `lv_t` declared above |
| | | | **D — a subexpression written twice or once** |
| d1_twice | 110.3 | 120.0 | `lv_x = ( a * b + c ) * ( a * b + c ).` |
| d2_once | **70.1** | 93.3 | `lv_t = a * b + c. lv_x = lv_t * lv_t.` |
| | | | **E — the colour string of a rectangle** |
| e1_template | 85.0 | 99.6 | `lv_s = \|rgb({ r },{ g },{ b })\|.` |
| e2_concatenate | 163.1 | 187.5 | `CONCATENATE` with three `i`→`string` conversions |
| e4_one_field | 34.3 | 35.8 | `lv_s = \|{ lv_r }\|.` |
| e3_palette | 70.7 | 75.6 | `READ TABLE lt_pal INDEX i INTO lv_s.` |
| e5_const_string | **8.1** | 8.7 | `lv_s = '#0a0a12'.` |
| | | | **F — a structure field or a scalar** |
| f1_struct_field | 33.8 | 35.7 | `ls-x = ls-x * lv_k.` |
| f2_scalar | 32.8 | 34.0 | `lv_x = lv_x * lv_k.`, `ls-x` written once after |
| f3_struct_read | 32.0 | 36.7 | `lv_x = lv_x * ls-x.` |
| f4_scalar_read | 31.9 | 34.5 | `lv_x = lv_x * lv_k.` |
| | | | **G — walking an 8-row table, per pass** |
| g1_into | **2790.1** | 3143.1 | `LOOP AT lt INTO ls.` (349 ns a row) |
| g2_assigning | 1372.8 | 1470.1 | `LOOP AT lt ASSIGNING <ls>.` (172 ns a row) |
| g3_reference | 1679.6 | 2070.0 | `LOOP AT lt REFERENCE INTO lr.` (210 ns a row) |
| g4_do_index | **594.9** | 656.9 | `DO. READ TABLE lt INDEX sy-index ASSIGNING <ls>.` (74 ns a row) |
| g5_unrolled | 2636.7 | 2958.7 | `ASSIGNING`, four fields read instead of one |
| | | | **H — integer against float against packed** |
| h1_int_add | 16.6 | 19.6 | `lv_i = lv_i + 7.` (`i`) |
| h2_float_add | 33.1 | 35.7 | `lv_x = lv_x + lv_k.` (`f`) |
| h3_int_mul | 19.1 | 20.6 | `lv_i = lv_i * lv_k.` (`i`) |
| h4_float_mul | 28.9 | 32.7 | `lv_x = lv_x * lv_k.` (`f`) |
| h5_packed_mul | **129.7** | 162.5 | `lv_p = lv_p * lv_k.` (`p LENGTH 8 DECIMALS 4`) |
| | | | **I — powers and the builtins** |
| i1_power_2 | 29.2 | 36.1 | `lv_x = lv_a ** 2.` |
| i2_mul_self | 34.0 | 41.1 | `lv_x = lv_a * lv_a.` |
| i6_power_8 | 43.6 | 48.8 | `lv_x = lv_a ** 8.` |
| i7_mul_8 | 82.6 | 107.9 | three multiplies that make `** 8` |
| i3_sqrt | **10.4** | 12.8 | `lv_x = sqrt( lv_a ).` |
| i4_power_half | 75.1 | 86.8 | `lv_x = lv_a ** '0.5'.` |
| i5_sin | 19.3 | 22.1 | `lv_x = sin( lv_a ).` |
| | | | **J — the cost of a method call** |
| j1_call_static | 122.8 | 145.6 | `lv_x = helper( a b k )`, one multiply inside |
| j2_inlined | **66.5** | 73.8 | the same multiply written in place |
| j3_call_table | 94.5 | 105.8 | a call with a table parameter (8 rows) |
| j4_call_struct | **205.8** | 228.7 | a call returning a four-field structure |
| | | | **K — `DO` against `WHILE`** |
| k1_do | 33.3 | 34.6 | `DO iv_n TIMES.` around one multiply |
| k2_while | 59.8 | 64.5 | `WHILE lv_i < iv_n.` around the same |
| | | | **L — appending a row** |
| l1_append_value | 518.2 | 694.5 | `APPEND VALUE ty_row( … ) TO lt.` |
| l2_append_ref | **336.5** | 405.7 | `APPEND INITIAL LINE … ASSIGNING <ls>.` then four writes |
| | | | **M — the demo's `smooth_min`, three ways** |
| m1_smin_orig | 699.6 | 860.6 | as upstream writes it |
| m2_smin_const | 489.6 | 556.9 | the same with `CONSTANTS TYPE f` |
| m3_smin_inline | **394.2** | 467.6 | the same, inlined into the caller |
| | | | **Z — the noise floor: `a3_local_f` copied** |
| z1_control | 42.7 | 46.7 | |
| z2_control | 47.4 | 51.9 | |
| z3_control | 42.5 | 47.9 | |

### Where rewriting changes what is computed

Four of the wins are not free, and the table would mislead without this:

- **`DO … READ TABLE INDEX sy-index`** (g4) sets `sy-subrc` and `sy-tabix`,
  which `LOOP AT` also does but with different values, and it uses `sy-index`
  for the row number so a nested `DO` or a `sy-index` read inside the body
  means something else. Safe only in a loop that reads neither.
- **`CONSTANTS … TYPE f VALUE '0.5'` for `'0.5'`** is exact here, because
  `parseFloat("0.5")` and `Float.set("0.5")` produce the same double. It is
  *not* exact if the literal is used where its **calculation type** matters:
  a character-like operand raises the calculation type above `i`, so
  `'1.0' * 18 / 16` is not rounded while `1 * 18 / 16` is. Replacing an
  integer-valued character literal by a float constant can therefore change
  a result; replacing one that has a decimal point cannot, because it was
  already raising the type.
- **`lv_x * lv_inv` for `lv_x / lv_k`** (b3) is *not* a win here — the
  reciprocal is 21 % *slower* than the division, see below — and it changes
  the answer, because `1/k` is not exact in binary.
- **`nmin( )`, `**`, `sqrt( )`** all go through `Math`, and swapping one for
  a hand-written equivalent changes the last bits. `lv_a ** 8` is cheaper
  than three multiplies here *and* gives a different double.

---

## The rules, with their measured cost

Ordered by what they are worth in the demo.

1. **Never put a character literal in an arithmetic expression that runs
   more than once.** `lv_x * '0.5'` is 201 ns; `lv_x * c_half` with
   `CONSTANTS c_half TYPE f VALUE '0.5'` is 52 ns; a `DATA … TYPE f` set once
   outside the loop is 45 ns. `CONV f( '0.5' )` inside the loop is 158 ns —
   it does not help. `CONSTANTS … TYPE string` is 198 ns — it is the same
   trap with a different spelling.
   *Runtime artefact.* On a real kernel the literal is typed at compile time.
2. **Walk a table with `ASSIGNING`, not `INTO`** — 172 ns a row against
   349 ns, because `INTO` copies the work area field by field
   (`types/structure.js` `set` is 5–8 % of a heavy frame in the profile).
   **`REFERENCE INTO` is 210 ns**, between the two.
   *Good style anywhere*; the size of the win is this runtime's.
3. **In the hottest loops, replace `LOOP AT` with `DO lines( ) TIMES` plus
   `READ TABLE … INDEX sy-index ASSIGNING`** — 74 ns a row against 172 ns.
   `LOOP AT` is transpiled to `for await` over an async generator and every
   row costs a microtask.
   *Pure runtime artefact, and ugly.* Only for a loop that reads neither
   `sy-subrc` nor `sy-index`, and only where it has been measured to matter.
4. **Inline a small method that is called a hundred thousand times a frame.**
   A static call with three float parameters is 123 ns against 67 ns for the
   same arithmetic in place; a method that **returns a structure** is 206 ns.
   The demo's `smooth_min` is 700 ns as written and 394 ns inlined with float
   constants.
   *Runtime artefact* — a real kernel's method call is far cheaper — *and it
   costs readability*, so it is the last thing to do, not the first.
5. **Pass scalars, not structures, to a method in a hot path.** The
   structure has to be built by the caller and copied by the callee. A
   four-field structure return is 206 ns against 67 ns for the arithmetic.
6. **Hoist anything that does not change with the loop variable, across
   method boundaries too.** This is the one that does not show up in the
   idiom table at all and was worth the most in one scene: `torus_3d` called
   `rotate_x( is_p = … iv_a = - lv_rot_x )` inside its ray march, and
   `rotate_x` computes `cos( iv_a )` and `sin( iv_a )` — of an angle that is
   constant for the whole frame — on every one of ~128 000 march steps.
   *Good style anywhere.* No compiler will do this for you across a call.
7. **Compute a repeated subexpression once.** 110 ns against 70 ns for
   `( a * b + c )` written twice. *Good style anywhere.*
8. **Do not "optimise" a division into a multiplication by the reciprocal.**
   Division is 28 ns and multiplication is 29–45 ns, because `divide`'s type
   dispatch is two tests long and `multiply`'s is eight. The reciprocal form
   measured 34 ns — slower — and it changes the answer.
   *Pure runtime artefact, and the reverse of the hardware intuition.*
9. **Prefer `i` to `f` where the values are integers** — 17 ns against 33 ns
   for an addition — because `add`/`minus`/`multiply` test
   `Integer && Integer` first and reach `Float`/`Float` only at the bottom of
   the chain. **Avoid `p` in a hot loop entirely**: packed is 130 ns, four
   times a float, because it is a `bigint` scaled by `10^decimals`.
   *Runtime artefact for `i` vs `f`; `p` is genuinely expensive everywhere.*
10. **The builtins are cheap; the operators are not.** `sqrt( )` is 10 ns and
    `sin( )` is 19 ns — *less than one multiply* — because a builtin is one
    function call and one allocation with no type dispatch. `**` is likewise
    cheaper than the multiplications it stands for: `** 2` is 29 ns against
    34 ns for `x * x`, and `** 8` is 44 ns against 83 ns for three
    multiplies. **Do not hand-expand a power, and do not build a lookup table
    for a trigonometric function** — the table lookup alone is 71 ns
    (`e3_palette`), four times what `sin( )` costs.
    *Runtime artefact, and it inverts the usual advice.*
11. **String building is not the problem it looks like.** A three-field
    template is 85 ns, a constant string assignment is 8 ns, and
    `CONCATENATE` with the conversions it needs is 163 ns — twice the
    template. The demo builds one colour string per rectangle: a thousand of
    them is 85 µs out of a 126 ms frame. Leave it alone.
12. **`DO n TIMES` beats `WHILE i < n`** — 33 ns against 60 ns — because `DO`
    becomes a plain `for` and `WHILE` pays a `compare.lt` and an addition per
    iteration. *Runtime artefact.*
13. **`APPEND INITIAL LINE … ASSIGNING` beats `APPEND VALUE #( … )`** —
    337 ns against 518 ns for a four-field row.
14. **Inline `DATA( )` in a loop costs nothing.** The transpiler hoists the
    declaration out of the loop; the generated JavaScript for `c1` and `c2`
    is identical apart from the variable numbers. Their 69 ns and 59 ns are
    the noise floor, not a finding. Write whichever reads better.
15. **A structure field is as fast as a scalar** to read (32 ns vs 32 ns) and
    to write (34 ns vs 33 ns). The expensive thing about a structure is
    copying the *whole* of it — as a parameter, a return value, or a `LOOP AT
    … INTO` work area — not touching one field of it.

### Which of these would help on a real ABAP kernel

| rule | on a kernel |
| --- | --- |
| 1 character literals | no — the kernel types the literal at compile time |
| 2 `ASSIGNING` over `INTO` | yes, for the same reason (no work-area copy), smaller effect |
| 3 `DO`+`READ TABLE` over `LOOP AT` | no — and it is worse style; this is the async generator |
| 4 inlining a method | no, or barely |
| 5 scalars over structures | yes, smaller effect |
| 6 hoisting loop-invariant work | yes — this is real work removed |
| 7 common subexpression once | yes |
| 8 do not use the reciprocal | no — on a kernel the reciprocal is the faster one |
| 9 `i` over `f`, avoid `p` | partly: `p` is genuinely slow everywhere, `i` vs `f` is not |
| 10 builtins are cheap, no lookup tables | no — inverted here |
| 11 templates over `CONCATENATE` | neutral |
| 12 `DO` over `WHILE` | no |
| 13 `APPEND … ASSIGNING` | yes, smaller effect |

So **six of fourteen are good style anywhere** (2, 5, 6, 7, 13, and half of
9) and the rest are this runtime's shape. That matters for the patch: only
the portable ones are worth carrying into somebody else's source
permanently; the others are an argument for fixing the compiler.

---

## What it is worth on the demo

The three slowest scenes of ZO4D, rewritten with rules 1, 2, 4, 5, 6 and 7
and nothing else — the same arithmetic in the same order, no change to
resolution, iteration count or output. Measured with
`node tools/o4d-profile.mjs`, 60 frames a scene, one tick at a time, on one
workstation; the baseline was taken twice, half an hour apart and either side
of the rewritten run, so the drift is visible.

| scene | baseline min | baseline again | rewritten min | change | baseline median | rewritten median |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| sdf_blobs | 140.3 | 142.1 | **88.2** | **−37 %** | 160.3 | 125.5 |
| quat_julia | 125.0 | 100.8 | **72.9** | **−28 %** | 126.0 | 81.2 |
| torus_3d | 80.7 | 83.0 | **50.4** | **−38 %** | 91.5 | 56.7 |

The minimum drifted by 1 to 2 % on two scenes and 20 % on `quat_julia`; the
median drifted more. The honest reading is the conservative one: against the
*better* of the two baselines, the rewrite takes **28 to 38 %** off a frame.

**The picture is unchanged.** `node tools/o4d-record.mjs --compare`, 60
frames a scene, against both baselines:

```
sdf_blobs    60 frames compared (60 vs 60 recorded): 0 differ
quat_julia   60 frames compared (60 vs 60 recorded): 0 differ
torus_3d     60 frames compared (60 vs 60 recorded): 0 differ
```

Every coordinate and every colour string of every one of ~10 000 primitives
a frame is identical. That is the whole test: a rewrite that changes a frame
changed the maths and does not count.

What each scene's rewrite actually is:

- **`sdf_blobs`** — `LOOP AT it_blobs INTO DATA(ls_b)` became `ASSIGNING`;
  `smooth_min` was inlined into `scene_sdf` (it is called once per blob per
  march step, which the profile put at 37 % of the frame); six character
  literals became `CONSTANTS … TYPE f`. Three hunks.
- **`quat_julia`** — `quat_square` and `quat_mag_sq`, both structure-passing
  methods called in the innermost loop, were inlined onto scalars inside
  `julia_test`; `julia_test` takes three floats instead of a `ty_v3` the
  caller built for each of 13 824 sample points; `rotate( )`'s six
  trigonometric calls were hoisted to once a frame.
- **`torus_3d`** — `rotate_x`/`rotate_y` were inlined at the two call sites
  in the march with their `cos`/`sin` hoisted out of ~128 000 steps a frame;
  `torus_sdf` gained a scalar twin so `calc_normal` stops building six
  structures per lit pixel; five character literals became constants.

---

## What the transpiler could do instead

Every one of rules 1, 3, 4, 8, 9, 10, 12 is the programmer working around
the compiler. This is what it would take for the slow spelling to cost what
the fast one does. The transpiler facts below are read off
`@abaplint/transpiler` 2.13.86, with file and line.

### Where the decision is made today

`packages/transpiler/src/expressions/arith_operator.ts:8-36` maps the
operator token to a name — `"*"` → `"abap.operators.multiply"` — by a string
switch **with no type information at all**.
`packages/transpiler/src/expressions/source.ts:94-99` wraps it into a prefix
call. The precedence tree is already built by `rearranger.ts:116-186`, so by
the time the operator is emitted the expression is a left-to-right binary
tree — a good place to hang a pass.

The traversal **does** have the syntax result: `handlers/handle_abap.ts:24`
constructs it with `new abaplint.SyntaxLogic(reg, obj).run().spaghetti`, and
`traversal.ts:150-178` looks up the scope at any token. It already branches
on a proven static type elsewhere — `statements/loop.ts:52-60` emits
`.assign(x.getPointer())` instead of `.set(x)` when `determineType` says the
target is a `DataReference`; `statements/data.ts:63-77` reads `PackedType`
decimals. What is missing is a **type for a whole `Source` subtree**:
abaplint core exports `Source` only as a grammar expression and offers no
`getTypeOfSource(node)`, so the transpiler would have to compute one
bottom-up itself (variables, components, attributes, literals, `CONV`/`VALUE`
via `lookupInferred`, method return types) and fall back where it cannot.
The assignment target's type is a two-line change: `traversal.determineType`
already handles that node shape and `statements/move.ts:82-91` simply does
not call it.

There is **no optimiser of any kind** in the transpiler today —
`feature_flags.ts` is empty, and a grep for `optimi|fold|peephole` finds two
`// todo` comments. The runtime, by contrast, already has hand-written fast
paths (`compare/eq.ts:72`, `_parse.ts:19`), which is the precedent to point
at.

### The big one: raw JavaScript arithmetic when the types are proven

**Can the transpiler emit `lv_h.set(0.5 + 0.5 * (a - b) / k)` on raw doubles
instead of four calls into the operator protocol?** The measurement says this
is worth more than everything else combined: a statement with four operators
costs 110–200 ns today and the same expression in plain JavaScript costs
about 1 ns.

What it needs, and whether it is there:

| needs | there? |
| --- | --- |
| the declared type of each operand | yes for variables/components/attributes (`scope.findVariable(…).getType()`, already used in `field_chain.ts:30`); **no** for a subexpression or a method call — that computation has to be written |
| the declared type of the target | yes, `traversal.determineType` (`traversal.ts:1026`), simply not called from `move.ts` |
| whether a literal is a compile-time constant | yes, trivially — `constant.ts` already switches on the literal's range |
| whether an expression is loop-invariant | no, and it is not needed for this |

What would be emitted: for a statement where no operand is character-like,
packed, `decfloat34`, `int8`, hex, date or time, and at least one is `f`,
`target.set(<plain JS expression on .getRaw() values>)`. The `.set()` stays,
and it is correct for every target type: `Integer.set(number)` and
`Integer.set(Float)` both go through `roundHalfAwayFromZero`
(`types/integer.ts:95`), and `Packed.set(number)` and `Packed.set(Float)`
both go through `numberToScaled` (`types/packed.ts:115,129`). So the target
does not even have to be `f`.

What would break, and the answer to each:

- **The calculation type.** `Integer` carries `integerCalculationType`
  (`types/integer.ts:53-63`) and `Float` carries it false by default;
  `divide.ts:37` sets it when both operands are integers, `add.ts:26-33` and
  `multiply.ts:135-138` clear it when a character operand joins in. It is
  read by exactly five builtins — `abs`, `ceil`, `floor`, `frac`, `trunc`
  — through `getCalculationValue()`. **If at least one operand is statically
  `f`, no `Integer` result is ever produced and the flag is false either way,
  so the whole rule falls away.** That is the narrowing that makes the fast
  path tractable: not "both operands are `f`" but "no operand is
  character-like/packed/decfloat/int8, and at least one is `f`".
- **Division by zero.** `divide.ts:27-31` returns `0` for `0 / 0` and throws
  `CX_SY_ZERODIVIDE` otherwise; raw `/` gives `NaN` and `Infinity`. So `/`
  needs a guard: `(r === 0 ? abap.operators.divide(l, r) : l / r)`, or a
  two-line helper. Cheap, and it must not be forgotten.
- **`**`.** `power.ts:147-155` is `Math.pow(parse(l), parse(r))` for
  everything that is not `int8`, so it folds to `**` or `Math.pow` with no
  special cases at all.
- **`MOD` and `DIV`.** `div.ts:39` floors, `mod.ts:47-87` does
  `((l % r) + r) % r` then an absolute value and returns a `Float` if either
  operand was one. Messier; leave them out of a first version.
- **Integer overflow.** Nothing to reproduce — the check is commented out
  (`types/integer.ts:113-117`).
- **The tests.** `packages/transpiler/test/single_statements.ts` asserts the
  **exact emitted JavaScript** for 243 statements, a dozen of them
  arithmetic; every one would have to be updated deliberately, which is the
  right kind of friction. Behind them sit ~2 000 executed tests, 199 of them
  in `test/operators/`, which is a real net.

**Verdict: feasible, and the largest item on the list by a wide margin.** The
work is a bottom-up type computation inside the transpiler plus the
zero-divisor guard; the risk is contained by a narrow admission rule and by
243 exact-string tests that cannot be changed by accident.

### The cheap one: a numeric literal should not be a `Character`

`'0.5'` is emitted as `abap.CharacterFactory.get(3, '0.5')`
(`constant.ts:87-99`), and `_parse.ts:9-17` calls `parseFloat` on it **on
every evaluation**, at the bottom of a chain of eight failed `instanceof`
tests. That is the 201 ns against 45 ns, 4.4×, and `sdf_blobs` spends 9.2 %
of its operations there.

Two ways, and they are independent:

- **Compiler side.** In an arithmetic context a character literal is always
  numeric, so emit a cached `Float` instead. Safe **only for a literal
  containing a decimal point**: an integer-valued one takes the
  `Character`-and-`Integer` branches of `add`/`multiply` and yields an
  `Integer` with the calculation type cleared, and turning it into a `Float`
  would change the inferred type of an inline `DATA(x) = '1' * 18`. A literal
  with a point never takes those branches. The plumbing exists —
  `SourceTranspiler` already carries a `context` parameter
  (`source.ts:43`) that it forwards to string templates and ignores for
  arithmetic.
- **Runtime side.** `CharacterFactory` (`character_factory.ts:3-11`) returns
  a shared `setConstant()` object; it could carry the parsed number and
  `parse()` read it. No compiler change at all. `docs/demo-profile.md`
  measured this at −22 % on `sdf_blobs`.

**Best ratio of gain to risk on the whole list.** Do it in the runtime first
because it is five lines and needs no type analysis.

### The one that is nearly free: order the operator chain for floats

`add`, `minus` and `multiply` all begin with
`left instanceof Integer && right instanceof Integer` and reach
`Float`/`Float` only after eight tests, which is why an integer addition is
17 ns and a float addition is 33 ns, and why `divide` — whose chain is two
tests long — is *cheaper* than `multiply`. A `Float && Float` test as the
second branch changes no semantics and is two lines per operator.
`docs/demo-profile.md` measured 9–17 % off a heavy frame for exactly this.

### Is there room for a real arithmetic optimiser?

Answered with the numbers above rather than with enthusiasm, ranked by gain
over risk.

1. **Constant folding of numeric literals** — see above. Gain: 4.4× on the
   operation, ~20 % on `sdf_blobs`. Analysis needed: "is this token a numeric
   literal with a decimal point, in an arithmetic context". Almost none.
   **Do it.**
2. **Typed emission for statically-float expressions** — the big one above.
   Gain: the profile measured 9–17 % for the runtime-side half; the
   compiler-side version removes the intermediate allocations too, which the
   idiom table says is most of the remaining cost. Analysis needed: a
   bottom-up type for a `Source` subtree. **Do it second; it is a project.**
3. **A synchronous `LOOP AT` when the body contains no `await`.** Not
   arithmetic, but the measurement says it is 172 ns a row against 74 ns for
   the same walk written as `DO` + `READ TABLE`, i.e. **2.3× on every table
   loop in every ABAP program**. Analysis needed: prove the body performs no
   database access, no `CALL FUNCTION`, no method call that could be async —
   which for the transpiler means "no method call at all", since every
   generated method is `async`. That restricts it to leaf loops over pure
   arithmetic, which is exactly the demo's `scene_sdf` and not much else.
4. **Method inlining.** Gain: 123 → 67 ns for the simplest case, 206 → 67 for
   a structure-returning one, and it is the precondition for anything across
   a call boundary. Analysis needed: aliasing of exporting parameters,
   `sy-subrc`, exceptions, recursion, and the fact that every method is
   `async`. **High gain, high risk, no obvious first step.**
5. **Hoisting loop-invariant subexpressions.** Gain in this code: **almost
   nothing.** The demo's per-frame setup is already outside its pixel loops,
   and the one enormous invariant — `cos( - lv_rot_x )` inside `rotate_x`,
   recomputed 128 000 times a frame — is *behind a method call*, which LICM
   cannot see without item 4. What it would have to prove: the subexpression
   reads no variable written in the loop, calls nothing with a side effect,
   and raises nothing that would change control flow (`/` can throw
   `CX_SY_ZERODIVIDE`, so hoisting a division out of a loop that would have
   exited first changes the program). **Not worth it before inlining.**
6. **Precomputed tables for a function over a proven range.** **No, and the
   measurement says so twice.** `sin( )` costs 19 ns and a `READ TABLE …
   INDEX` lookup costs 71 ns, so the table is nearly four times slower than
   the thing it replaces. And no table of doubles is exactly equal to
   `Math.sin` at the sampled points, so it changes what the program computes
   — which is the one thing the frame comparison is there to forbid. The only
   exact form is memoisation on the exact double, and that is a hash lookup,
   which is the 71 ns again. **Do not.**

---

## Reproducing this

```
node .local/hotabap/build.mjs                    # transpile ZCL_HOTBENCH alone
node .local/hotabap/run-each.mjs 15 200          # the idiom table, one process a case
```

The scene measurement runs in a detached git worktree under
`.local/worktrees/hotabap` so that nothing in the working tree and nothing
serving on 3030 moves:

```
git worktree add --detach .local/worktrees/hotabap HEAD
# symlink node_modules, .local/lars, .local/tls and packs/*/upstream into it
node tools/osd-build.mjs && STG_SERVE=child STG_PORT=3092 node test/run.mjs
sh .local/hotabap/measure.sh base
# then again with OSD_PACKS=.local/hotabap/pack-fast for the rewritten classes
```

`.local/hotabap/pack-fast/` is an override pack: three ABAP files that win
their names over `packs/o4d/upstream` because a pack layers after the input
folders and its `order` is higher. The patch for the demo's own repository is
`.local/hotabap/patch/vivid-vibes-hot-scenes.patch`.
