REPORT zselcheck.
* Selection-screen checks in the terminal (cmd/osabap/selcheck_test.go):
* an error after AT SELECTION-SCREEN ON a field, a warning after AT
* SELECTION-SCREEN, and an obligatory field.

PARAMETERS: p_a TYPE c LENGTH 10 OBLIGATORY,
            p_b TYPE c LENGTH 10.

AT SELECTION-SCREEN ON p_b.
  IF p_b = 'BAD'.
    MESSAGE 'B is wrong' TYPE 'E'.
  ENDIF.

AT SELECTION-SCREEN.
  IF p_a = 'WARN'.
    MESSAGE 'Are you sure' TYPE 'W'.
  ENDIF.

START-OF-SELECTION.
  WRITE: / 'ran', p_a, p_b.
