REPORT zl3_fleet2_doc.
* Dispatcher step: a daemon callback cannot execute SUBMIT on a system.
START-OF-SELECTION.
  DATA lt_report TYPE zcl_l3_fleet2=>tt_doctor.
  lt_report = zcl_l3_fleet2=>doctor( ).
* then the release: the claims are committed before their events are raised
  DATA lt_released TYPE zcl_l3_fleet2=>tt_pile.
  COMMIT WORK.
  lt_released = zcl_l3_fleet2=>release_claim( ).
  COMMIT WORK.
  zcl_l3_fleet2=>release_raise( lt_released ).
  COMMIT WORK.
