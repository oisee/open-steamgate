* Each assertion reports BEFORE and AFTER counts if they differ on A4H.
* This owns only KIND R3P rows and restores any rows it displaced.
CLASS ltcl_r3 DEFINITION FOR TESTING RISK LEVEL DANGEROUS DURATION SHORT FINAL.
  PRIVATE SECTION.
    DATA mt_saved TYPE STANDARD TABLE OF zosd_lift_r3 WITH DEFAULT KEY.
    METHODS setup.
    METHODS teardown.
    METHODS char_short FOR TESTING.
    METHODS char_long FOR TESTING.
    METHODS numc_literal FOR TESTING.
    METHODS numc_number FOR TESTING.
    METHODS case_pair FOR TESTING.
    METHODS packed_number FOR TESTING.
    METHODS null_initial FOR TESTING.
    METHODS subrc_after FOR TESTING.
ENDCLASS.
CLASS ltcl_r3 IMPLEMENTATION.
  METHOD setup.
    DATA ls TYPE zosd_lift_r3.
    SELECT * FROM zosd_lift_r3 INTO TABLE mt_saved WHERE kind = 'R3P'.
    DELETE FROM zosd_lift_r3 WHERE kind = 'R3P'.
    ls-kind = 'R3P'.
    ls-code = 'A'.
    ls-seq = '012'.
    ls-active = 'X'.
    ls-ltext = 'mixed'.
    ls-amt = '10.50'.
    INSERT zosd_lift_r3 FROM ls.
    ls-code = 'B'.
    ls-seq = '001'.
    ls-active = space.
    ls-ltext = 'MIXED'.
    ls-amt = '10.00'.
    INSERT zosd_lift_r3 FROM ls.
  ENDMETHOD.
  METHOD teardown.
    DELETE FROM zosd_lift_r3 WHERE kind = 'R3P'.
    IF mt_saved IS NOT INITIAL.
      INSERT zosd_lift_r3 FROM TABLE mt_saved.
    ENDIF.
  ENDMETHOD.
  METHOD char_short.
    DATA ls TYPE zosd_lift_r3.
    DATA before_count TYPE i.
    DATA after_count TYPE i.
    SELECT * FROM zosd_lift_r3 INTO ls WHERE kind = 'R3P'.
      CHECK ls-code = 'A'.
      ADD 1 TO before_count.
    ENDSELECT.
    SELECT * FROM zosd_lift_r3 INTO ls WHERE kind = 'R3P' AND code = 'A'.
      ADD 1 TO after_count.
    ENDSELECT.
    cl_abap_unit_assert=>assert_equals( exp = before_count act = after_count ).
  ENDMETHOD.
  METHOD char_long.
    DATA ls TYPE zosd_lift_r3.
    DATA before_count TYPE i.
    DATA after_count TYPE i.
    SELECT * FROM zosd_lift_r3 INTO ls WHERE kind = 'R3P'.
      CHECK ls-active = 'X '.
      ADD 1 TO before_count.
    ENDSELECT.
    SELECT * FROM zosd_lift_r3 INTO ls WHERE kind = 'R3P' AND active = 'X '.
      ADD 1 TO after_count.
    ENDSELECT.
    cl_abap_unit_assert=>assert_equals( exp = before_count act = after_count ).
  ENDMETHOD.
  METHOD numc_literal.
    DATA ls TYPE zosd_lift_r3.
    DATA before_count TYPE i.
    DATA after_count TYPE i.
    SELECT * FROM zosd_lift_r3 INTO ls WHERE kind = 'R3P'.
      CHECK ls-seq = '12'.
      ADD 1 TO before_count.
    ENDSELECT.
    SELECT * FROM zosd_lift_r3 INTO ls WHERE kind = 'R3P' AND seq = '12'.
      ADD 1 TO after_count.
    ENDSELECT.
    cl_abap_unit_assert=>assert_equals( exp = before_count act = after_count ).
  ENDMETHOD.
  METHOD numc_number.
    DATA ls TYPE zosd_lift_r3.
    DATA before_count TYPE i.
    DATA after_count TYPE i.
    SELECT * FROM zosd_lift_r3 INTO ls WHERE kind = 'R3P'.
      CHECK ls-seq = 12.
      ADD 1 TO before_count.
    ENDSELECT.
    SELECT * FROM zosd_lift_r3 INTO ls WHERE kind = 'R3P' AND seq = 12.
      ADD 1 TO after_count.
    ENDSELECT.
    cl_abap_unit_assert=>assert_equals( exp = before_count act = after_count ).
  ENDMETHOD.
  METHOD case_pair.
    DATA ls TYPE zosd_lift_r3.
    DATA before_count TYPE i.
    DATA after_count TYPE i.
    SELECT * FROM zosd_lift_r3 INTO ls WHERE kind = 'R3P'.
      CHECK ls-ltext = 'MIXED'.
      ADD 1 TO before_count.
    ENDSELECT.
    SELECT * FROM zosd_lift_r3 INTO ls WHERE kind = 'R3P' AND ltext = 'MIXED'.
      ADD 1 TO after_count.
    ENDSELECT.
    cl_abap_unit_assert=>assert_equals( exp = before_count act = after_count ).
  ENDMETHOD.
  METHOD packed_number.
    DATA ls TYPE zosd_lift_r3.
    DATA before_count TYPE i.
    DATA after_count TYPE i.
    SELECT * FROM zosd_lift_r3 INTO ls WHERE kind = 'R3P'.
      CHECK ls-amt = 10.
      ADD 1 TO before_count.
    ENDSELECT.
    SELECT * FROM zosd_lift_r3 INTO ls WHERE kind = 'R3P' AND amt = 10.
      ADD 1 TO after_count.
    ENDSELECT.
    cl_abap_unit_assert=>assert_equals( exp = before_count act = after_count ).
  ENDMETHOD.
  METHOD null_initial.
    DATA ls TYPE zosd_lift_r3.
    DATA before_count TYPE i.
    DATA after_count TYPE i.
    SELECT * FROM zosd_lift_r3 INTO ls WHERE kind = 'R3N'.
      CHECK ls-opt = space.
      ADD 1 TO before_count.
    ENDSELECT.
    SELECT * FROM zosd_lift_r3 INTO ls WHERE kind = 'R3N' AND opt = space.
      ADD 1 TO after_count.
    ENDSELECT.
    cl_abap_unit_assert=>assert_equals( exp = before_count act = after_count ).
  ENDMETHOD.
  METHOD subrc_after.
    DATA ls TYPE zosd_lift_r3.
    DATA old_subrc TYPE i.
    DATA new_subrc TYPE i.
    SELECT * FROM zosd_lift_r3 INTO ls WHERE kind = 'R3P'.
      CHECK ls-active = 'Z'.
      CONTINUE.
    ENDSELECT.
    old_subrc = sy-subrc.
    SELECT * FROM zosd_lift_r3 INTO ls WHERE kind = 'R3P' AND active = 'Z'.
      CONTINUE.
    ENDSELECT.
    new_subrc = sy-subrc.
    " measured on A4H 2026-10-01: rows fetched, none passes the CHECK ->
    " the old loop leaves 0, the rewritten SELECT matches nothing -> 4.
    " This is why R3 refuses a read of sy-subrc after the loop.
    cl_abap_unit_assert=>assert_equals( exp = 0 act = old_subrc ).
    cl_abap_unit_assert=>assert_equals( exp = 4 act = new_subrc ).
  ENDMETHOD.
ENDCLASS.
