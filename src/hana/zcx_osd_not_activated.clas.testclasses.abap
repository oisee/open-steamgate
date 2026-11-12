CLASS ltcl_lazy DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
* The stub raise the island's unresolvable methods carry: the text must
* name what is missing, and the RAISE statement must travel as cx_no_check
* -- no RAISING clause anywhere, the way the stub is written into a body
* whose signature came from the dump.
  PRIVATE SECTION.
    METHODS text_names_the_missing FOR TESTING RAISING cx_static_check.
    METHODS raise_carries_missing FOR TESTING RAISING cx_static_check.
ENDCLASS.

CLASS ltcl_lazy IMPLEMENTATION.

  METHOD text_names_the_missing.
    DATA lo_cut TYPE REF TO zcx_osd_not_activated.
    CREATE OBJECT lo_cut EXPORTING missing = 'ZOSD_H5C_HEAD, ZOSD_H5C_ROLE'.
    cl_abap_unit_assert=>assert_equals(
      act = lo_cut->get_text( )
      exp = |not activated here: needs ZOSD_H5C_HEAD, ZOSD_H5C_ROLE| ).
  ENDMETHOD.

  METHOD raise_carries_missing.
    DATA lo_cut TYPE REF TO zcx_osd_not_activated.
    DATA lv_text TYPE string.
    TRY.
        RAISE EXCEPTION TYPE zcx_osd_not_activated EXPORTING missing = 'ZOSD_H5C_W'.
        cl_abap_unit_assert=>fail( msg = 'the stub raise did not raise' ).
      CATCH zcx_osd_not_activated INTO lo_cut.
        lv_text = lo_cut->get_text( ).
    ENDTRY.
    cl_abap_unit_assert=>assert_equals( act = lv_text exp = |not activated here: needs ZOSD_H5C_W| ).
  ENDMETHOD.

ENDCLASS.
