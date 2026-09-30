* The Open SQL corpus of the native build: one form per block, each block
* compiled as its own report by tools/gogen/osabap-sql-corpus.mjs (the Go
* generator gives up a whole method at its first form it cannot compile,
* so a single report would show one gap at a time). The table is ZNOTES
* from apps/notes. The WRITE at the end is not a case.
REPORT zsqlcorpus.

PARAMETERS p_id TYPE i.
SELECT-OPTIONS s_id FOR p_id.

TYPES: BEGIN OF ty_pair, id TYPE i, text TYPE c LENGTH 80, END OF ty_pair.
DATA gt_notes TYPE STANDARD TABLE OF znotes WITH DEFAULT KEY.
DATA gt_sorted TYPE SORTED TABLE OF znotes WITH UNIQUE KEY id.
DATA gt_pairs TYPE STANDARD TABLE OF ty_pair WITH DEFAULT KEY.
DATA gs_note TYPE znotes.
DATA gs_pair TYPE ty_pair.
DATA gv_count TYPE i.
DATA gv_max TYPE i.
DATA gv_text TYPE string.
DATA gv_where TYPE string.

START-OF-SELECTION.
* 01 aggregate into a scalar
  SELECT MAX( id ) FROM znotes INTO gv_max.
* 02 COUNT(*)
  SELECT COUNT(*) FROM znotes INTO gv_count.
* 03 SELECT SINGLE by key
  SELECT SINGLE * FROM znotes INTO gs_note WHERE id = p_id.
* 04 SELECT SINGLE one field
  SELECT SINGLE text FROM znotes INTO gv_text WHERE id = p_id.
* 05 INTO TABLE, ORDER BY, UP TO
  SELECT * FROM znotes INTO TABLE gt_notes UP TO 10 ROWS ORDER BY id.
* 06 field list INTO CORRESPONDING
  SELECT id text FROM znotes INTO CORRESPONDING FIELDS OF TABLE gt_pairs WHERE id IN s_id.
* 07 SELECT loop
  SELECT * FROM znotes INTO gs_note WHERE text LIKE 'a%'.
    gv_count = gv_count + 1.
  ENDSELECT.
* 08 APPENDING TABLE
  SELECT * FROM znotes APPENDING TABLE gt_notes WHERE id > 5.
* 09 into a sorted table
  SELECT * FROM znotes INTO TABLE gt_sorted.
* 10 FOR ALL ENTRIES
  IF gt_pairs IS NOT INITIAL.
    SELECT * FROM znotes INTO TABLE gt_notes FOR ALL ENTRIES IN gt_pairs WHERE id = gt_pairs-id.
  ENDIF.
* 11 GROUP BY
  SELECT text COUNT(*) FROM znotes INTO (gv_text, gv_count) GROUP BY text.
  ENDSELECT.
* 12 dynamic WHERE
  gv_where = `id > 3`.
  SELECT * FROM znotes INTO TABLE gt_notes WHERE (gv_where).
* 13 new syntax
  SELECT id, text FROM znotes WHERE id >= @p_id INTO TABLE @DATA(lt_new).
* 14 INSERT one row / table
  INSERT znotes FROM gs_note.
  INSERT znotes FROM TABLE gt_notes ACCEPTING DUPLICATE KEYS.
* 15 UPDATE row / SET
  UPDATE znotes FROM gs_note.
  UPDATE znotes SET text = 'x' WHERE id = p_id.
* 16 MODIFY
  MODIFY znotes FROM gs_note.
  MODIFY znotes FROM TABLE gt_notes.
* 17 DELETE
  DELETE znotes FROM gs_note.
  DELETE FROM znotes WHERE id IN s_id.
* 18 LUW
  COMMIT WORK.
  ROLLBACK WORK.
  WRITE: / gv_count, gv_max, lines( lt_new ).
