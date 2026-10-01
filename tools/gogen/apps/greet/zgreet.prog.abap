REPORT zgreet.

* A report with a class of its own beside it: osabap compiles the class
* with the report.

PARAMETERS p_name TYPE string LOWER CASE DEFAULT `world`.

START-OF-SELECTION.
  WRITE / zcl_greet_text=>hello( p_name ).
