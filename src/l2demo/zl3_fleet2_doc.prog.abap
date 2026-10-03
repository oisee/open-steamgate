REPORT zl3_fleet2_doc.
* Dispatcher step: a daemon callback cannot execute SUBMIT on a system.
START-OF-SELECTION.
  DATA lt_report TYPE zcl_l3_fleet2=>tt_doctor.
  lt_report = zcl_l3_fleet2=>doctor( ).
