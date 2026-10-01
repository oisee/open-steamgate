REPORT zmessage.
PARAMETERS p_mode(1) DEFAULT 'E'.

START-OF-SELECTION.
  WRITE: / |mode { p_mode }, then|, 'before'.
  PERFORM fail.
  WRITE / 'after'.

FORM fail.
  CASE p_mode.
    WHEN 'E'.
      MESSAGE |bad input| TYPE 'E'.
    WHEN 'A'.
      MESSAGE |abort| TYPE 'A'.
    WHEN 'W'.
      MESSAGE |warning| TYPE 'W'.
    WHEN 'X'.
      MESSAGE |dump| TYPE 'X'.
    WHEN 'S'.
      MESSAGE |status| TYPE 'S'.
    WHEN 'I'.
      MESSAGE |info| TYPE 'I'.
    WHEN 'D'.
      MESSAGE |looks bad| TYPE 'S' DISPLAY LIKE 'E'.
  ENDCASE.
ENDFORM.
