REPORT zhello.

PARAMETERS p_name TYPE c LENGTH 30 DEFAULT 'world' LOWER CASE.
PARAMETERS p_loud AS CHECKBOX.
SELECT-OPTIONS s_tag FOR p_name.

START-OF-SELECTION.
  IF p_loud = abap_true.
    TRANSLATE p_name TO UPPER CASE.
  ENDIF.
  WRITE: / 'Hello', p_name.
  WRITE: / 'Tags', lines( s_tag ).
