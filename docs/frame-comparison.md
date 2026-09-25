# Frame comparison: the demo as an oracle for the runtime

*2026-09-16 to 2026-09-17. The method that found eight runtime and
compiler anomalies in two days, and what it says about each scene of the
demo today.*

## The idea

ZO4D (the Vivid Vibes demo, `packs/o4d`) draws itself in ABAP. A page opens
a push channel, asks for a frame by tick number, and the APC handler
answers with a small JSON object: the scene, the time, the beat, and every
rectangle, line, text and circle the page should paint. Nothing in that
object depends on the wall clock or on the machine: it is a pure function
of the tick, the ABAP and the arithmetic underneath the ABAP.

So the same demo on a real system and on open-steamgate must produce the
same stream, and every place where it does not is a place where the
transpiled ABAP computed something differently from the kernel. A recording
from a system is an oracle; a diff against it is the whole test, and it is
a test with sixty thousand assertions per scene that nobody had to write.

It is a stronger probe than ABAP Unit for this purpose because the demo
was not written to test anything. It uses `frac`, `MOD`, integer division,
character literals in arithmetic, sine tables, inline declarations,
comparisons with literals, the way application code does, in combinations
nobody would think to test, and it prints the result as numbers.

## The tools

- `tools/o4d-record.mjs` records: it opens the channel, loads the demo,
  and asks for ticks `--from` (or from the first tick of `--scene <name>`,
  looked up in the scenario the demo announces) for `--ticks` frames, and
  writes one JSON frame per line. Against a system it logs on with
  `OSD_SAP_USER`, `OSD_SAP_PASSWORD`, `OSD_SAP_CLIENT` from the
  environment, never from the command line. `--compare a b` prints how
  many frames differ, which paths through the frame differ how often
  (`r.*.f` is the fill colour of rectangles, `l.*.c` the colour of lines,
  `p` the beat pulse), and the first differing frame in full. `--against`
  compares a fresh recording with a stored one. Numbers are equal within
  a relative 1e-9, because the two sides print floats with 17 and 15
  digits and that is not a difference in what was drawn.
- Recordings live under `.local/` and are never committed (CLAUDE.md): a
  recording from a system carries a logon in its URL history and the
  system's version of every number.
- When a difference is found, the frame names the ABAP that computed it
  (`r.256.f` at frame 10 of plasma is one row of one scene), the runtime
  is asked directly for the same arithmetic in Node, and a probe class
  with an ABAP Unit test that fails on purpose is created on A4H so the
  assertion message shows the system's values, then deleted. The
  measured pair goes into `ANORMALIES.md` before anything is changed.

```
node tools/o4d-record.mjs http://127.0.0.1:3030 --scene plasma --ticks 256 --out .local/o4d-lab-plasma.jsonl
OSD_SAP_USER=… OSD_SAP_PASSWORD=… node tools/o4d-record.mjs https://<system>:<port> --scene plasma --ticks 256 --out .local/o4d-a4h-plasma.jsonl
node tools/o4d-record.mjs --compare .local/o4d-lab-plasma.jsonl .local/o4d-a4h-plasma.jsonl
```

A second machine (the i7, eight workers) records the open-steamgate side
faster than the workstation; the system side is the slow one, minutes per
scene, so a sweep runs in ten-minute chunks and resumes.

## What it found, in order

Every one of these is an `ANORMALIES.md` entry with the measurement; the
issue and PR numbers are there too.

| found by | anomaly | where | state |
| --- | --- | --- | --- |
| Sales Dance, 59 of 60 frames, a label drawn from frame 2 | a float compared with a character literal read with `parseInt` | runtime `compare/gt.ts` | fixed, PR #1862 |
| the 3 frames left, the pulse | `frac`, `abs`, `floor`, `ceil`, `trunc`, `sign` declared to return `i` | abaplint core | test written, #4302 open |
| probing around it | `MOD` with a float operand returns an integer | runtime `operators/mod.ts` | fixed, PR #1863 |
| probing around it | −0.5 to `i` is 0, `Math.round` | runtime `types/integer.ts` | fixed, PR #1864 |
| plasma, 256 of 256, one colour per frame | `APPEND sin( x )` rounds the value to an integer before the row sees it | runtime `types/table.ts` | fixed, PR #1867 |
| plasma, the 7 frames left, one row each | in calculation type `i` a division is rounded before the next operation | transpiler, needs the statement's type | question, #1866 |
| mountains, 511 of 512, exactly 159 pixels | an inline `DATA` from `lc_h * ( '0.4' + … )` typed `Character(4)` | abaplint core | fixed upstream in 2.120.52 (#4293), pin moved |
| Pages, "Disconnected" at start | `WRITE` in a service worker wrote to a `process.stdout` that is not there | preview backend | fixed, console with a tail |

The transpiler and runtime this tree serves with carry all the runtime
fixes on `local/osd-build` (pinned by commit in the preview workflow), and
core 2.120.54.

## Every scene of the main demo, two bars each, i7 against A4H

Recorded 2026-09-17 with all of the above in place. "pulse" means the
frames on a beat where `p` is 1 here and 0.25 there, plus what that
brightness or flash drives, which is #4302 and nothing else.

| scene | differing frames | cause |
| --- | --- | --- |
| Sales Dance (60 frames) | 3 of 60 | pulse |
| plasma (256) | 19 of 256 | pulse (12), and 7 frames of one row each where the sine index is a division inside `MOD` (#1866) |
| mountains_oops (512) | 268 of 512 | pulse and flash; the sharp mountains of bars 28 to 31: `DATA(lv_tri1) = abs( … )` declared `i` (#4302) |
| voxel_landscape (256) | 13 of 256 | pulse |
| ignition, ignite_emit | 128 of 128 | the particle seed chain `frac( sin( seed * 12345 ) * 43758 )` amplifies a last-digit difference into a different particle field; measured: the first link of the chain is equal on both sides to 17 digits, the divergence is downstream and not traced further. **Open** |
| copperbars | 15 of 128 | pulse (frames 32–35, 96–99); one line on six frames not traced. **Open, small** |
| twistzoomer, rotozoom, rotozoom_plasma, neon_city | 6 of 128 | pulse |
| cell24, cell16, cell120, sierpinski_tet, quat_julia, sdf_blobs, torus_3d | 6 of 128 | pulse and its flash |
| joydivision | 6 of 128 | pulse frames only (line heights follow it) |
| tesseract | 127 of 128 | `CONV i( lv_bright / 255 * 60 + 20 )` with `lv_bright TYPE i`: a system rounds `200 / 255` to 1 and every line is 20% or 80% light; here 39% to 70% (#1866, measured `l=80` on A4H) |
| amiga_ball | 128 of 128 | `DATA(lv_bounce) = abs( sin( lv_t * 3 ) ) * 100` declared `i` (#4302), so the ball's height is rounded here; on top of it `SORT lt_tris BY z` orders equal `z` differently (below) |
| amiga_ball_2 | 128 of 128 | 101 frames are the same triangles in a different order, `SORT lt_tris BY z ASCENDING` with equal keys; 27 frames differ in values too, not traced. **Open** |
| glitch | 67 of 128 | 108 frames same triangles in a different order (no SORT in the scene: the order the table is filled differs, not traced); 20 differ in values. **Open** |
| sierpinski | 128 of 128 | `SORT lt_proj BY z DESCENDING` with equal keys, and values not traced. **Open** |
| julia_morph | 128 of 128 | the hue lands in the JSON as `335.5263157894733013` here and `336` there, the lightness as `26.25%` and `26%`: an expression of integers that a system evaluates in calculation type `i` keeps its fraction here (#1866 family, the same rule) |
| constellation | 128 of 128 | `DATA(lv_i) = floor( lv_hh )` declared `i` (#4302) drives the line colours and heights |

**Triangle order.** Three scenes sort triangles by depth with `SORT … BY z`
and no `STABLE`, and the front-to-back order of equal keys is whatever
the sort implementation leaves, on each side. The same set in another
order paints a different picture where triangles overlap, so the frames
are not sorted before comparing to make them equal; the honest statement
is that ABAP does not promise the order of equal keys, the kernel and the
runtime pick differently, and a scene that wants a defined picture needs
a second key (Astra, 2026-09-17). That is a change to the demo, not to
the runtime. **Done 2026-09-23** (vivid-vibes#5, pinned in `packs/o4d`):
every depth sort of the six effects that have one (amigaball, amigaball2,
sierpinski, sierpinski_tet, glenz, lowpoly) carries its append position as
a second key, `SORT … BY z seq`. The same edit was activated in `$ZO4D` on
A4H and amiga_ball, amiga_ball_2, sierpinski, sierpinski_tet and glitch
were re-recorded there. A stable sort now gives the kernel's order, and a
Go build of the demo matches all five frame for frame.

Three conclusions the table supports. The pulse anomaly (#4302) is in
every scene, so a fix in core moves every row at once; it also owns
amiga_ball, constellation and the sharp mountains outright. #1866 is not
a corner: it decides whether the tesseract has depth shading at all and
what colour every pixel of julia_morph is. And what is left open after
those two is small and named: the ignition seed chain, one line of
copperbars, the values behind three sorted-triangle scenes.

**Milestone, 2026-09-17.** All 22 scenes of the main demo recorded on
both sides (two bars each; plasma, mountains and voxel for four to eight
bars), every difference attributed to a measured cause or marked open
above. The sweep stops here; the next moves are upstream (#4302, #1866)
and in the demo (a second sort key), not in the oracle.

## What it does not catch

Anything the page computes (WebGL, audio timing), anything a system does
with the wall clock, and randomness from `cl_abap_random`, which the demo
does not use. The ignition seed chain is deterministic on each side and
different between them, which is the limit of comparing two floating-point
implementations rather than a defect.
