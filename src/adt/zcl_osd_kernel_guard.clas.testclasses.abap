CLASS lcl_empty DEFINITION FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
ENDCLASS.
CLASS lcl_empty IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.
  ENDMETHOD.
ENDCLASS.
CLASS lcl_assert DEFINITION FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
ENDCLASS.
CLASS lcl_assert IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.
    ASSERT 1 = 'todo'.
  ENDMETHOD.
ENDCLASS.
CLASS ltcl_guard DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS success FOR TESTING RAISING cx_root.
    METHODS plain_runtime_error FOR TESTING RAISING cx_root.
ENDCLASS.
CLASS ltcl_guard IMPLEMENTATION.
  METHOD success.
    DATA lo_run TYPE REF TO if_oo_adt_classrun.
    DATA lo_out TYPE REF TO zcl_osd_classrun_out.
    DATA lv_failed TYPE abap_bool.
    DATA lv_name_run TYPE string.
    CREATE OBJECT lo_run TYPE lcl_empty.
    lv_name_run = cl_abap_classdescr=>get_class_name( lo_run ).
    CREATE OBJECT lo_out.
    zcl_osd_kernel_guard=>call_classrun( EXPORTING iv_name = lv_name_run io_out = lo_out
      IMPORTING ev_failed = lv_failed ).
    cl_abap_unit_assert=>assert_initial( lv_failed ).
    cl_abap_unit_assert=>assert_initial( lo_out->text( ) ).
  ENDMETHOD.
  METHOD plain_runtime_error.
    DATA lo_run TYPE REF TO if_oo_adt_classrun.
    DATA lo_out TYPE REF TO zcl_osd_classrun_out.
    DATA lv_failed TYPE abap_bool.
    DATA lv_name_run TYPE string.
    DATA lv_name TYPE string.
    DATA lv_message TYPE string.
    DATA lv_stack TYPE string.
    CREATE OBJECT lo_run TYPE lcl_assert.
    lv_name_run = cl_abap_classdescr=>get_class_name( lo_run ).
    CREATE OBJECT lo_out.
    zcl_osd_kernel_guard=>call_classrun( EXPORTING iv_name = lv_name_run io_out = lo_out
      IMPORTING ev_failed = lv_failed ev_name = lv_name
        ev_message = lv_message ev_stack = lv_stack ).
    cl_abap_unit_assert=>assert_equals( act = lv_failed exp = abap_true ).
    cl_abap_unit_assert=>assert_not_initial( lv_name ).
    cl_abap_unit_assert=>assert_not_initial( lv_message ).
    cl_abap_unit_assert=>assert_not_initial( lv_stack ).
  ENDMETHOD.
ENDCLASS.
