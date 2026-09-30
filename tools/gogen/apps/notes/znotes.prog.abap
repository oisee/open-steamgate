REPORT znotes.

* A report with a table of its own: osabap builds it as a native command
* that keeps its rows in the SQLite file -db names.

PARAMETERS p_add TYPE string LOWER CASE.

DATA gt_notes TYPE STANDARD TABLE OF znotes WITH DEFAULT KEY.
DATA gs_note TYPE znotes.
DATA gv_max TYPE i.

START-OF-SELECTION.
  IF p_add IS NOT INITIAL.
    SELECT COUNT(*) FROM znotes INTO gv_max.
    gs_note-id = gv_max + 1.
    gs_note-text = p_add.
    INSERT znotes FROM gs_note.
    COMMIT WORK.
  ENDIF.
  SELECT * FROM znotes INTO TABLE gt_notes ORDER BY id.
  LOOP AT gt_notes INTO gs_note.
    WRITE: / gs_note-id, gs_note-text.
  ENDLOOP.
  WRITE: / sy-dbcnt, 'notes'.
