* Leave one row in this disposable table before OPT is added in stage two.
CLASS ltcl_r3_seed DEFINITION FOR TESTING RISK LEVEL DANGEROUS DURATION SHORT FINAL.
  PRIVATE SECTION.
    METHODS seed_old_row FOR TESTING.
ENDCLASS.
CLASS ltcl_r3_seed IMPLEMENTATION.
  METHOD seed_old_row.
    DATA ls TYPE zosd_lift_r3.
    DELETE FROM zosd_lift_r3 WHERE kind = 'R3N'.
    ls-kind = 'R3N'.
    ls-code = 'N'.
    ls-seq = '001'.
    ls-active = space.
    INSERT zosd_lift_r3 FROM ls.
    cl_abap_unit_assert=>assert_equals( exp = 0 act = sy-subrc ).
  ENDMETHOD.
ENDCLASS.
