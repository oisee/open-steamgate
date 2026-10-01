REPORT zpickrange.

DATA gv_file TYPE string.
SELECT-OPTIONS s_file FOR gv_file.

AT SELECTION-SCREEN ON VALUE-REQUEST FOR s_file-low.
  s_file-low = 'low.txt'.

AT SELECTION-SCREEN ON VALUE-REQUEST FOR s_file-high.
  s_file-high = 'high.txt'.

START-OF-SELECTION.
  WRITE 'done'.
