# X2 ABAP Unit conformance data

SYNTHETIC XML, recreated from measured result shape on 2026-10-07. These are
not captures. All class identities are the disposable fixture's identities.
Class pools pad the fixture name to 30 characters; the method selector pads
LTCL_ADD with 22 encoded spaces. Counts are derived from elements, since the
measured response has no summary element.

The main source is red. The suite publishes it unchanged, then publishes the
same source with only `rv_ = a - b.` changed to `rv_ = a + b.`. The test include
is identical in both states; its failing assertion is line 7, counted from 1.
This directory is excluded from the normal system, packs and shipped seeds.
