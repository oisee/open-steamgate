CLASS zcl_gogen_t_ajson DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string
      RAISING zcx_ajson_error cx_abap_message_digest.
ENDCLASS.

CLASS zcl_gogen_t_ajson IMPLEMENTATION.
  METHOD run.
    DATA lo TYPE REF TO zif_ajson.
    DATA lv_hash TYPE string.
    lo = zcl_ajson=>create_empty( ).
    lo->set_string( iv_path = '/a' iv_val = 'x' ).
    lo->touch_array( '/b' ).
    lo->set_integer( iv_path = '/b/1' iv_val = 7 ).
    rv = lo->stringify( ).
    cl_abap_message_digest=>calculate_hash_for_char(
      EXPORTING if_algorithm = 'SHA256' if_data = rv
      IMPORTING ef_hashstring = lv_hash ).
    rv = rv && `|` && lv_hash.
  ENDMETHOD.
ENDCLASS.
