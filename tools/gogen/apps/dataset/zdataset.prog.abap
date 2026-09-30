REPORT zdataset.

PARAMETERS p_input TYPE string LOWER CASE.
PARAMETERS p_output TYPE string LOWER CASE.

DATA gv_line TYPE string.
DATA gv_count TYPE i.
DATA gv_len TYPE i.
DATA gv_pos TYPE i.
DATA gv_msg TYPE string.
DATA gv_x TYPE x LENGTH 3.

START-OF-SELECTION.
  OPEN DATASET p_input FOR INPUT IN TEXT MODE ENCODING UTF-8 MESSAGE gv_msg.
  IF sy-subrc <> 0.
    WRITE: / 'Refused', gv_msg.
    RETURN.
  ENDIF.
  OPEN DATASET p_output FOR OUTPUT IN TEXT MODE ENCODING UTF-8 MESSAGE gv_msg.
  IF sy-subrc <> 0.
    WRITE: / 'Refused', gv_msg.
    CLOSE DATASET p_input.
    RETURN.
  ENDIF.
  DO.
    READ DATASET p_input INTO gv_line ACTUAL LENGTH gv_len.
    IF sy-subrc <> 0.
      EXIT.
    ENDIF.
    gv_count = gv_count + 1.
    TRANSFER gv_line TO p_output.
  ENDDO.
  GET DATASET p_input POSITION gv_pos.
  CLOSE DATASET p_input.
  CLOSE DATASET p_output.
  WRITE: / 'Copied', gv_count, 'lines, at byte', gv_pos.
  OPEN DATASET p_output FOR INPUT IN BINARY MODE.
  READ DATASET p_output INTO gv_x ACTUAL LENGTH gv_len.
  CLOSE DATASET p_output.
  WRITE: / 'Head', gv_x, gv_len.
