CLASS ltcl_install DEFINITION FINAL FOR TESTING RISK LEVEL HARMLESS DURATION SHORT.
  PRIVATE SECTION.
    METHODS run FOR TESTING.
ENDCLASS.

CLASS ltcl_install IMPLEMENTATION.
  METHOD run.
    DATA(lv) = zcl_osd_t_samc=>install( '$ZOSG_TMP_0061' ).
    COMMIT WORK.
    cl_abap_unit_assert=>fail( msg = |INSTALL: { lv }| ).
  ENDMETHOD.
ENDCLASS.
