REPORT zosd_test_demo_plain.

* A program with nothing in it but its text: no local class, no event
* block, no subroutine. It exists so that a structure document over the
* plainest program a system can hold has a subject **inside the system**.
*
* The façade test used to read `ZDEMO_EDITOR` for this, which lives under
* `test/fixtures/` -- a folder the build excludes and the object store
* indexed, so the system contained an object the build had never seen, and
* a check of it complained truthfully about the object and falsely about
* the system (fable-osd found the second half, 2026-09-19, running her
* view check over the whole tree rather than over its fixture).

WRITE 'Plain'.
