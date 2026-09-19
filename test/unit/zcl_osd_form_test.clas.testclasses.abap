CLASS ltcl_form DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
* A form's body, decoded. Every case here is one that a screen would read as
* "the person typed nothing" or, worse, as something slightly different from
* what they typed.
  PRIVATE SECTION.
    METHODS a_pair FOR TESTING RAISING cx_static_check.
    METHODS plus_is_a_space FOR TESTING RAISING cx_static_check.
    METHODS a_literal_plus_survives FOR TESTING RAISING cx_static_check.
    METHODS a_value_may_hold_equals FOR TESTING RAISING cx_static_check.
    METHODS the_name_is_decoded_too FOR TESTING RAISING cx_static_check.
    METHODS lookup_ignores_case FOR TESTING RAISING cx_static_check.
    METHODS a_posted_body_is_read FOR TESTING RAISING cx_static_check.
    METHODS the_gap_this_exists_for FOR TESTING RAISING cx_static_check.

    METHODS post
      IMPORTING iv_body           TYPE string
      RETURNING VALUE(ri_request) TYPE REF TO if_http_request.
ENDCLASS.

CLASS ltcl_form IMPLEMENTATION.

  METHOD post.
    DATA lo_entity TYPE REF TO cl_http_entity.

    CREATE OBJECT lo_entity.
    lo_entity->if_http_request~set_method( 'POST' ).
    lo_entity->if_http_entity~set_content_type( 'application/x-www-form-urlencoded' ).
    lo_entity->if_http_entity~set_cdata( iv_body ).
    ri_request = lo_entity.
  ENDMETHOD.

  METHOD a_pair.
    DATA lt_fields TYPE tihttpnvp.

    lt_fields = zcl_osd_form=>parse( `name=ZCL_X&do=check` ).
    cl_abap_unit_assert=>assert_equals(
      act = zcl_osd_form=>value( it_fields = lt_fields iv_name = `name` )
      exp = `ZCL_X` ).
    cl_abap_unit_assert=>assert_equals(
      act = zcl_osd_form=>value( it_fields = lt_fields iv_name = `do` )
      exp = `check` ).
  ENDMETHOD.

  METHOD plus_is_a_space.
*   a browser sends every space in a text area as '+', and a source posted
*   without this rule comes back with its indentation turned into plus signs
    DATA lt_fields TYPE tihttpnvp.

    lt_fields = zcl_osd_form=>parse( `src=DATA+lv_x+TYPE+i.` ).
    cl_abap_unit_assert=>assert_equals(
      act = zcl_osd_form=>value( it_fields = lt_fields iv_name = `src` )
      exp = `DATA lv_x TYPE i.` ).
  ENDMETHOD.

  METHOD a_literal_plus_survives.
*   and the rule is applied BEFORE the percent decoding, or a plus somebody
*   typed becomes a space: '%2B' is a plus, not a space
    DATA lt_fields TYPE tihttpnvp.

    lt_fields = zcl_osd_form=>parse( `src=lv_x+%3D+1+%2B+2.` ).
    cl_abap_unit_assert=>assert_equals(
      act = zcl_osd_form=>value( it_fields = lt_fields iv_name = `src` )
      exp = `lv_x = 1 + 2.` ).
  ENDMETHOD.

  METHOD a_value_may_hold_equals.
*   split at the FIRST '=' only: a source truncated at the first equals sign
*   in it would be a save that quietly dropped everything after the first
*   assignment
    DATA lt_fields TYPE tihttpnvp.

    lt_fields = zcl_osd_form=>parse( `src=a+%3D+b+%3D+c` ).
    cl_abap_unit_assert=>assert_equals(
      act = zcl_osd_form=>value( it_fields = lt_fields iv_name = `src` )
      exp = `a = b = c` ).
  ENDMETHOD.

  METHOD the_name_is_decoded_too.
    DATA lt_fields TYPE tihttpnvp.

    lt_fields = zcl_osd_form=>parse( `f_my%20field=1` ).
    cl_abap_unit_assert=>assert_equals(
      act = zcl_osd_form=>value( it_fields = lt_fields iv_name = `f_my field` )
      exp = `1` ).
  ENDMETHOD.

  METHOD lookup_ignores_case.
*   the case a name is stored in is the sender's business (ANORMALIES,
*   "get_form_field lower-cases the question and not the answer")
    DATA lt_fields TYPE tihttpnvp.

    lt_fields = zcl_osd_form=>parse( `Type=CLAS` ).
    cl_abap_unit_assert=>assert_equals(
      act = zcl_osd_form=>value( it_fields = lt_fields iv_name = `type` )
      exp = `CLAS` ).
  ENDMETHOD.

  METHOD a_posted_body_is_read.
    DATA li_request TYPE REF TO if_http_request.
    DATA lt_fields  TYPE tihttpnvp.

    li_request = post( `type=CLAS&name=ZCL_OSD_EDIT&do=check` ).
    lt_fields = zcl_osd_form=>fields( li_request ).
    cl_abap_unit_assert=>assert_equals(
      act = zcl_osd_form=>value( it_fields = lt_fields iv_name = `name` )
      exp = `ZCL_OSD_EDIT` ).
  ENDMETHOD.

  METHOD the_gap_this_exists_for.
*   The defect itself, asserted, so that the workaround has an expiry. The
*   shim fills the form fields from the query string only; `get_form_field`
*   over a posted body answers nothing. When the shim learns to parse a body
*   -- which is where the fix belongs -- this test fails and says to delete
*   zcl_osd_form rather than to adjust an expectation.
    DATA li_request TYPE REF TO if_http_request.

    li_request = post( `name=ZCL_OSD_EDIT` ).
    cl_abap_unit_assert=>assert_initial(
      act = li_request->get_form_field( 'name' )
      msg = 'the shim now parses a posted body: delete zcl_osd_form and read get_form_field again' ).
  ENDMETHOD.

ENDCLASS.
