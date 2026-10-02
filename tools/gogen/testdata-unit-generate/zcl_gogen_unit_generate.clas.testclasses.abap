* GENERATE SUBROUTINE POOL is refused without an exception: sy-subrc 8,
* NAME initial, MESSAGE the fixed text, LINE 0, WORD initial. The method
* that holds the statement compiles and runs (it used to be NOT_COMPILED).
CLASS ltcl_generate DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS refused FOR TESTING.
    METHODS name_only FOR TESTING.
ENDCLASS.

CLASS ltcl_generate IMPLEMENTATION.
  METHOD refused.
    DATA lt_src TYPE STANDARD TABLE OF string WITH DEFAULT KEY.
    DATA lv_prog TYPE c LENGTH 40 VALUE 'UNSET'.
    DATA lv_msg TYPE string VALUE `UNSET`.
    DATA lv_line TYPE i VALUE 99.
    DATA lv_word TYPE string VALUE `UNSET`.
    APPEND `PROGRAM.` TO lt_src.
    GENERATE SUBROUTINE POOL lt_src NAME lv_prog MESSAGE lv_msg LINE lv_line WORD lv_word.
    cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 8 ).
    cl_abap_unit_assert=>assert_initial( lv_prog ).
    cl_abap_unit_assert=>assert_equals( act = lv_msg exp = `GENERATE SUBROUTINE POOL is not supported` ).
    cl_abap_unit_assert=>assert_equals( act = lv_line exp = 0 ).
    cl_abap_unit_assert=>assert_initial( lv_word ).
  ENDMETHOD.
  METHOD name_only.
    DATA lt_src TYPE STANDARD TABLE OF string WITH DEFAULT KEY.
    DATA lv_prog TYPE c LENGTH 40 VALUE 'UNSET'.
    GENERATE SUBROUTINE POOL lt_src NAME lv_prog.
    cl_abap_unit_assert=>assert_differs( act = sy-subrc exp = 0 ).
    cl_abap_unit_assert=>assert_initial( lv_prog ).
  ENDMETHOD.
ENDCLASS.
