REPORT zosd_voyage.

PARAMETERS p_run TYPE c LENGTH 32 OBLIGATORY.
PARAMETERS p_fail TYPE c LENGTH 1 DEFAULT space.

START-OF-SELECTION.
  IF p_fail = 'X'.
    MESSAGE 'Forced voyage failure' TYPE 'E'.
  ENDIF.
  WRITE: / 'Voyage', p_run.
