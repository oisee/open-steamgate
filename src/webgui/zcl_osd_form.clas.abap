CLASS zcl_osd_form DEFINITION PUBLIC CREATE PUBLIC.
* The fields of a form, including the ones in the BODY of a POST.
*
* Why this class exists (ANORMALIES, "a posted form has no form fields"):
* `cl_express_icf_shim` fills the request's form fields from the **query
* string only**. On a system, ICF parses an `application/x-www-form-
* urlencoded` body into the same form fields, which is what every HTML form
* with `method="post"` relies on. Here such a request arrives with its body
* intact and `get_form_field` empty, so a screen that posts a form reads
* nothing and silently behaves as though the person had typed nothing --
* which is exactly what the editor did on its first run: Check and Save both
* answered the object list, because the object's name was "".
*
* The screens written before this one had not met it: SE16 uses GET, and the
* webgui posts through `sapevent`, which carries its payload in the URL.
*
* Two things this does that `cl_http_utility=>string_to_fields` does not, and
* both are required by the form encoding rather than by taste:
*   - `+` is a space. `string_to_fields` decodes with `decodeURIComponent`,
*     which leaves `+` alone; a browser sends every space in a text area as
*     `+`, so a source code posted through it would come back with its
*     indentation turned into plus signs
*   - the NAME is unescaped too, not only the value
*
* It is a workaround and it has an expiry: the fix belongs in the shim, where
* the request is assembled (docs/upstream.md). `test/unit/zcl_osd_form_test`
* asserts the gap as well as the workaround, so when the shim learns to parse
* a body, that test fails and says to delete this.
  PUBLIC SECTION.
*   every field of the request: the query string, and the body when the body
*   is a form
    CLASS-METHODS fields
      IMPORTING
        ii_request       TYPE REF TO if_http_request
      RETURNING
        VALUE(rt_fields) TYPE tihttpnvp.

*   one field by name, matched without case -- the case a name is stored in
*   is the sender's business (ANORMALIES, "get_form_field lower-cases the
*   question and not the answer")
    CLASS-METHODS value
      IMPORTING
        it_fields       TYPE tihttpnvp
        iv_name         TYPE string
      RETURNING
        VALUE(rv_value) TYPE string.

*   the parser itself, so a test can reach it without a request
    CLASS-METHODS parse
      IMPORTING
        iv_body          TYPE string
      RETURNING
        VALUE(rt_fields) TYPE tihttpnvp.
  PROTECTED SECTION.
  PRIVATE SECTION.
    CLASS-METHODS decode
      IMPORTING
        iv_text        TYPE string
      RETURNING
        VALUE(rv_text) TYPE string.
ENDCLASS.

CLASS zcl_osd_form IMPLEMENTATION.

  METHOD fields.
    DATA lv_type   TYPE string.
    DATA lv_method TYPE string.
    DATA lv_body   TYPE string.
    DATA lt_body   TYPE tihttpnvp.
    DATA ls_field  TYPE ihttpnvp.

*   `get_form_fields_cs` takes its answer as CHANGING, which is the
*   interface's own shape and not ours. Its signature is worth reading
*   twice: `search_option TYPE i DEFAULT co_body_before_query_string`. The
*   interface says the body is a source of form fields and names it first --
*   it is the shim's assembly that never puts one there
    ii_request->get_form_fields_cs( CHANGING fields = rt_fields ).

    lv_method = to_upper( ii_request->get_method( ) ).
    IF lv_method <> 'POST' AND lv_method <> 'PUT'.
      RETURN.
    ENDIF.
    lv_type = to_lower( ii_request->get_header_field( 'content-type' ) ).
    IF lv_type NS 'application/x-www-form-urlencoded'.
      RETURN.
    ENDIF.

    lv_body = ii_request->get_cdata( ).
    lt_body = parse( lv_body ).
*   the body is appended after the query string, and neither replaces the
*   other: a form may post to a URL that carries parameters of its own, and
*   dropping either half would be a silent loss of what somebody sent
    LOOP AT lt_body INTO ls_field.
      APPEND ls_field TO rt_fields.
    ENDLOOP.
  ENDMETHOD.

  METHOD parse.
    DATA lt_pairs TYPE STANDARD TABLE OF string WITH DEFAULT KEY.
    DATA lv_pair  TYPE string.
    DATA ls_field TYPE ihttpnvp.

    IF iv_body IS INITIAL.
      RETURN.
    ENDIF.
    SPLIT iv_body AT '&' INTO TABLE lt_pairs.
    LOOP AT lt_pairs INTO lv_pair.
      IF lv_pair IS INITIAL.
        CONTINUE.
      ENDIF.
*     two targets, so everything after the FIRST '=' is the value: a value
*     may hold '=' and a field that lost its tail would be a source silently
*     truncated at the first equals sign in it
      SPLIT lv_pair AT '=' INTO ls_field-name ls_field-value.
      ls_field-name = decode( ls_field-name ).
      ls_field-value = decode( ls_field-value ).
      APPEND ls_field TO rt_fields.
    ENDLOOP.
  ENDMETHOD.

  METHOD decode.
    rv_text = iv_text.
*   '+' before the percent decoding, never after: a literal plus sign is sent
*   as '%2B', so it becomes a '+' only in the second step and must not be
*   turned into a space by the first
    REPLACE ALL OCCURRENCES OF '+' IN rv_text WITH ` `.
    rv_text = cl_http_utility=>unescape_url( rv_text ).
  ENDMETHOD.

  METHOD value.
    DATA ls_field TYPE ihttpnvp.
    DATA lv_name  TYPE string.

    lv_name = to_lower( iv_name ).
    LOOP AT it_fields INTO ls_field.
      IF to_lower( ls_field-name ) = lv_name.
        rv_value = ls_field-value.
        RETURN.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

ENDCLASS.
