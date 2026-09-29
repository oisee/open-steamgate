CLASS ltcl_pcp DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS captured_text FOR TESTING RAISING cx_static_check.
    METHODS fields FOR TESTING RAISING cx_static_check.
    METHODS binary_body FOR TESTING RAISING cx_static_check.
    METHODS malformed FOR TESTING RAISING cx_static_check.
    METHODS assumed_escaping FOR TESTING RAISING cx_static_check.
    METHODS duplicate_empty_header FOR TESTING RAISING cx_static_check.
    METHODS carriage_return FOR TESTING RAISING cx_static_check.
ENDCLASS.

CLASS ltcl_pcp IMPLEMENTATION.
  METHOD captured_text.
    DATA lo_message TYPE REF TO if_ac_message_type_pcp.
    DATA lv_lf TYPE string.
    DATA lv_expected TYPE string.
    lv_lf = cl_abap_char_utilities=>newline.
    lo_message = cl_ac_message_type_pcp=>create( ).
    lo_message->set_field( i_name = 'cmd' i_value = 'pcp' ).
    lo_message->set_field( i_name = 'a' i_value = '1' ).
    lo_message->set_field( i_name = 'b' i_value = 'x:y' ).
    lo_message->set_text( 'hello' && lv_lf && 'world' ).
    lv_expected = 'pcp-action:MESSAGE' && lv_lf
      && 'pcp-body-type:text' && lv_lf
      && 'cmd:pcp' && lv_lf
      && 'a:1' && lv_lf
      && 'b:x\:y' && lv_lf && lv_lf
      && 'hello' && lv_lf && 'world'.
    cl_abap_unit_assert=>assert_equals( act = lo_message->serialize( ) exp = lv_expected ).
    lo_message = cl_ac_message_type_pcp=>if_ac_message_type_pcp~deserialize( lv_expected ).
    cl_abap_unit_assert=>assert_equals( act = lo_message->serialize( ) exp = lv_expected ).
    cl_abap_unit_assert=>assert_equals( act = lo_message->get_text( )
      exp = 'hello' && lv_lf && 'world' ).
  ENDMETHOD.

  METHOD fields.
    DATA lo_message TYPE REF TO if_ac_message_type_pcp.
    DATA lv_exists TYPE abap_bool.
    DATA lv_value TYPE string.
    DATA lt_fields TYPE if_ac_message_type_pcp=>tt_pcp_fields.
    lo_message = cl_ac_message_type_pcp=>create( ).
    lv_value = lo_message->get_field( EXPORTING i_name = 'a' IMPORTING e_exists = lv_exists ).
    cl_abap_unit_assert=>assert_equals( act = lv_exists exp = abap_false ).
    lo_message->set_field( i_name = 'a' i_value = '1' ).
    lo_message->set_field( i_name = 'b' i_value = '2' ).
    lo_message->set_field( i_name = 'a' i_value = '3' ).
    lv_value = lo_message->get_field( EXPORTING i_name = 'a' IMPORTING e_exists = lv_exists ).
    cl_abap_unit_assert=>assert_equals( act = lv_exists exp = abap_true ).
    cl_abap_unit_assert=>assert_equals( act = lv_value exp = '3' ).
    lo_message->get_fields( CHANGING c_fields = lt_fields ).
    cl_abap_unit_assert=>assert_equals( act = lines( lt_fields ) exp = 2 ).
    READ TABLE lt_fields INDEX 1 INTO DATA(ls_field).
    cl_abap_unit_assert=>assert_equals( act = ls_field-name exp = 'a' ).
    cl_abap_unit_assert=>assert_equals( act = ls_field-value exp = '3' ).
    lo_message->delete_field( 'a' ).
    lv_value = lo_message->get_field( EXPORTING i_name = 'a' IMPORTING e_exists = lv_exists ).
    cl_abap_unit_assert=>assert_equals( act = lv_exists exp = abap_false ).
  ENDMETHOD.

  METHOD binary_body.
    DATA lo_message TYPE REF TO if_ac_message_type_pcp.
    DATA lv_wire TYPE string.
    lo_message = cl_ac_message_type_pcp=>create( ).
    lo_message->set_binary( '0001FF' ).
    cl_abap_unit_assert=>assert_equals( act = lo_message->get_binary( ) exp = '0001FF' ).
    lv_wire = lo_message->serialize( ).
    cl_abap_unit_assert=>assert_true( xsdbool( lv_wire CS 'pcp-body-type:binary' ) ).
    lo_message = cl_ac_message_type_pcp=>deserialize( lv_wire ).
    cl_abap_unit_assert=>assert_equals( act = lo_message->get_binary( ) exp = '0001FF' ).
    TRY.
        lo_message->get_text( ).
        cl_abap_unit_assert=>fail( 'binary GET_TEXT should raise' ).
      CATCH cx_ac_message_type_pcp_error.
    ENDTRY.
    lo_message->set_text( 'again' ).
    cl_abap_unit_assert=>assert_equals( act = lo_message->get_text( ) exp = 'again' ).
    TRY.
        lo_message->get_binary( ).
        cl_abap_unit_assert=>fail( 'text GET_BINARY should raise' ).
      CATCH cx_ac_message_type_pcp_error.
    ENDTRY.
  ENDMETHOD.

  METHOD malformed.
    TRY.
        cl_ac_message_type_pcp=>deserialize( 'bad' ).
        cl_abap_unit_assert=>fail( 'missing separator should raise' ).
      CATCH cx_ac_message_type_pcp_error.
    ENDTRY.
    TRY.
        cl_ac_message_type_pcp=>deserialize(
          'pcp-action:MESSAGE' && cl_abap_char_utilities=>newline
          && 'pcp-body-type:text' && cl_abap_char_utilities=>newline
          && 'broken' && cl_abap_char_utilities=>newline
          && cl_abap_char_utilities=>newline ).
        cl_abap_unit_assert=>fail( 'header without colon should raise' ).
      CATCH cx_ac_message_type_pcp_error.
    ENDTRY.
  ENDMETHOD.

  METHOD assumed_escaping.
    DATA lo_message TYPE REF TO if_ac_message_type_pcp.
    DATA lv_wire TYPE string.
    lo_message = cl_ac_message_type_pcp=>create( ).
    lo_message->set_field( i_name = 'path' i_value = 'a\b:c' ).
    lv_wire = lo_message->serialize( ).
    cl_abap_unit_assert=>assert_true( xsdbool( lv_wire CS 'path:a\\b\:c' ) ).
    lo_message = cl_ac_message_type_pcp=>deserialize( lv_wire ).
    cl_abap_unit_assert=>assert_equals( act = lo_message->serialize( ) exp = lv_wire ).
  ENDMETHOD.

  METHOD duplicate_empty_header.
    DATA lv_lf TYPE string.
    lv_lf = cl_abap_char_utilities=>newline.
    TRY.
        cl_ac_message_type_pcp=>if_ac_message_type_pcp~deserialize(
          'pcp-action:MESSAGE' && lv_lf
          && 'pcp-body-type:' && lv_lf
          && 'pcp-body-type:text' && lv_lf && lv_lf ).
        cl_abap_unit_assert=>fail( 'duplicate body type after empty value should raise' ).
      CATCH cx_ac_message_type_pcp_error.
    ENDTRY.
    TRY.
        cl_ac_message_type_pcp=>if_ac_message_type_pcp~deserialize(
          'pcp-action:' && lv_lf
          && 'pcp-action:MESSAGE' && lv_lf
          && 'pcp-body-type:text' && lv_lf && lv_lf ).
        cl_abap_unit_assert=>fail( 'duplicate action after empty value should raise' ).
      CATCH cx_ac_message_type_pcp_error.
    ENDTRY.
  ENDMETHOD.

  METHOD carriage_return.
    DATA lo_message TYPE REF TO if_ac_message_type_pcp.
    DATA lv_cr TYPE string.
    DATA lv_lf TYPE string.
    lv_cr = cl_abap_char_utilities=>cr_lf(1).
    lv_lf = cl_abap_char_utilities=>newline.
    lo_message = cl_ac_message_type_pcp=>create( ).
    TRY.
        lo_message->set_field( i_name = 'a' && lv_cr && 'b' i_value = '1' ).
        cl_abap_unit_assert=>fail( 'carriage return in field name should raise' ).
      CATCH cx_ac_message_type_pcp_error.
    ENDTRY.
    lo_message->set_field( i_name = 'a' i_value = 'x' && lv_cr && 'y' ).
    TRY.
        lo_message->serialize( ).
        cl_abap_unit_assert=>fail( 'carriage return in field value should raise' ).
      CATCH cx_ac_message_type_pcp_error.
    ENDTRY.
    TRY.
        cl_ac_message_type_pcp=>if_ac_message_type_pcp~deserialize(
          'pcp-action:MESSAGE' && lv_lf && 'pcp-body-type:text' && lv_lf
          && 'a' && lv_cr && 'b:1' && lv_lf && lv_lf ).
        cl_abap_unit_assert=>fail( 'carriage return in parsed field name should raise' ).
      CATCH cx_ac_message_type_pcp_error.
    ENDTRY.
    TRY.
        cl_ac_message_type_pcp=>if_ac_message_type_pcp~deserialize(
          'pcp-action:MESSAGE' && lv_lf && 'pcp-body-type:text' && lv_lf
          && 'a:x' && lv_cr && 'y' && lv_lf && lv_lf ).
        cl_abap_unit_assert=>fail( 'carriage return in parsed field value should raise' ).
      CATCH cx_ac_message_type_pcp_error.
    ENDTRY.
  ENDMETHOD.
ENDCLASS.
