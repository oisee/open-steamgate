REPORT zosd_sub_ctx.

PARAMETERS p_value TYPE c LENGTH 8 DEFAULT 'DEFAULT'.

START-OF-SELECTION.
  IF sy-batch = abap_true.
    WRITE 'BATCH'.
  ELSE.
    WRITE 'DIALOG'.
  ENDIF.
  WRITE sy-repid.
  WRITE p_value.
