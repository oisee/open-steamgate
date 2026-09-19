CLASS zcl_osd_rfc_channel DEFINITION PUBLIC CREATE PUBLIC.
* The light channel: call any remote-enabled function module of this tree.
*
* This is the spine of the RFC gateway track (docs/rfc-channel.md, backlog
* D.1). It is deliberately not a protocol: no RFC framing, no SOAP envelope,
* no authentication. It is the three things a caller of a function module
* needs, over plain HTTP and JSON, so that the marshalling can be proven with
* curl before anything has to survive a wire format:
*
*   GET  <base>/                 what this channel is
*   GET  <base>/functions        every module this tree declares, and whether
*                                it is exposed - and if not, why not
*   GET  <base>/functions/<NAME> its interface: parameters and exceptions
*   POST <base>/call/<NAME>      call it
*
* Everything here is ABAP on purpose. The request path of this project is
* ABAP end to end so that the same classes run in a system's ICF, and a
* gateway that only worked on Node would be a gateway this project cannot
* deploy.
*
* The gate: a module without REMOTE_CALL = 'R' in its function group is
* refused with 403. That is not security theatre and it is not our rule - it
* is what a real system enforces, and behaving like one is the whole value of
* this project. The generated zcl_osd_fm_call has no method for such a module
* either, so the refusal is a statement about a door that was never built.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_response,
             status       TYPE i,
             reason       TYPE string,
             content_type TYPE string,
             body         TYPE string,
           END OF ty_response.

*   the one entry point: a method, a path below the service node, a body
    CLASS-METHODS handle
      IMPORTING iv_method          TYPE string
                iv_path            TYPE string
                iv_body            TYPE string
      RETURNING VALUE(rs_response) TYPE ty_response.

  PRIVATE SECTION.
    TYPES: BEGIN OF ty_error,
             error    TYPE string,
             function TYPE string,
             message  TYPE string,
           END OF ty_error.
    TYPES: BEGIN OF ty_index,
             channel   TYPE string,
             routes    TYPE string,
             declared  TYPE i,
             exposed   TYPE i,
           END OF ty_index.
    TYPES: BEGIN OF ty_catalog,
             functions TYPE zcl_osd_fm_registry=>tt_function,
           END OF ty_catalog.
    TYPES: BEGIN OF ty_interface,
             function   TYPE zcl_osd_fm_registry=>ty_function,
             parameters TYPE zcl_osd_fm_registry=>tt_parameter,
             types      TYPE zcl_osd_fm_registry=>tt_type,
           END OF ty_interface.

    CLASS-METHODS segments
      IMPORTING iv_path        TYPE string
      RETURNING VALUE(rt_part) TYPE string_table.

    CLASS-METHODS index      RETURNING VALUE(rs_response) TYPE ty_response.
    CLASS-METHODS catalog    RETURNING VALUE(rs_response) TYPE ty_response.
    CLASS-METHODS describe   IMPORTING iv_name TYPE string
                             RETURNING VALUE(rs_response) TYPE ty_response.
    CLASS-METHODS invoke     IMPORTING iv_name TYPE string
                                       iv_body TYPE string
                             RETURNING VALUE(rs_response) TYPE ty_response.

    CLASS-METHODS ok
      IMPORTING iv_json            TYPE string
      RETURNING VALUE(rs_response) TYPE ty_response.
    CLASS-METHODS fail
      IMPORTING iv_status          TYPE i
                iv_reason          TYPE string
                iv_error           TYPE string
                iv_function        TYPE string OPTIONAL
                iv_message         TYPE string
      RETURNING VALUE(rs_response) TYPE ty_response.
ENDCLASS.

CLASS zcl_osd_rfc_channel IMPLEMENTATION.

  METHOD handle.
    DATA lt_part  TYPE string_table.
    DATA lv_route TYPE string.
    DATA lv_name  TYPE string.
    DATA lv_method TYPE string.

    lv_method = to_upper( iv_method ).
    lt_part   = segments( iv_path ).
    READ TABLE lt_part INDEX 1 INTO lv_route.
    READ TABLE lt_part INDEX 2 INTO lv_name.
    lv_route = to_lower( lv_route ).

    IF lv_route IS INITIAL.
      IF lv_method <> 'GET'.
        rs_response = fail( iv_status  = 405
                            iv_reason  = 'Method Not Allowed'
                            iv_error   = 'METHOD_NOT_ALLOWED'
                            iv_message = 'The channel document is a GET' ).
        RETURN.
      ENDIF.
      rs_response = index( ).
      RETURN.
    ENDIF.

    IF lv_route = 'functions'.
      IF lv_method <> 'GET'.
        rs_response = fail( iv_status  = 405
                            iv_reason  = 'Method Not Allowed'
                            iv_error   = 'METHOD_NOT_ALLOWED'
                            iv_message = 'Metadata is read with GET; a call is POST /call/<NAME>' ).
        RETURN.
      ENDIF.
      IF lv_name IS INITIAL.
        rs_response = catalog( ).
      ELSE.
        rs_response = describe( lv_name ).
      ENDIF.
      RETURN.
    ENDIF.

    IF lv_route = 'call'.
      IF lv_method <> 'POST'.
        rs_response = fail( iv_status  = 405
                            iv_reason  = 'Method Not Allowed'
                            iv_error   = 'METHOD_NOT_ALLOWED'
                            iv_message = 'A call is a POST, because it is not idempotent' ).
        RETURN.
      ENDIF.
      IF lv_name IS INITIAL.
        rs_response = fail( iv_status  = 400
                            iv_reason  = 'Bad Request'
                            iv_error   = 'NO_FUNCTION_NAMED'
                            iv_message = 'The path is /call/<FUNCTION MODULE>' ).
        RETURN.
      ENDIF.
      rs_response = invoke( iv_name = lv_name
                            iv_body = iv_body ).
      RETURN.
    ENDIF.

    rs_response = fail( iv_status  = 404
                        iv_reason  = 'Not Found'
                        iv_error   = 'NO_SUCH_ROUTE'
                        iv_message = 'The channel serves /, /functions, /functions/<NAME> and /call/<NAME>' ).
  ENDMETHOD.

  METHOD segments.
    DATA lt_raw TYPE string_table.
    DATA lv_raw TYPE string.

    SPLIT iv_path AT '/' INTO TABLE lt_raw.
    LOOP AT lt_raw INTO lv_raw.
      IF lv_raw IS NOT INITIAL.
        APPEND lv_raw TO rt_part.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD index.
    DATA ls_index    TYPE ty_index.
    DATA lt_function TYPE zcl_osd_fm_registry=>tt_function.
    DATA ls_function TYPE zcl_osd_fm_registry=>ty_function.

    lt_function = zcl_osd_fm_registry=>list( ).
    LOOP AT lt_function INTO ls_function.
      ls_index-declared = ls_index-declared + 1.
      IF ls_function-exposed = abap_true.
        ls_index-exposed = ls_index-exposed + 1.
      ENDIF.
    ENDLOOP.

    ls_index-channel = 'open-steamgate RFC channel'.
    ls_index-routes  = 'GET /functions, GET /functions/<NAME>, POST /call/<NAME>'.
    rs_response = ok( /ui2/cl_json=>serialize( data = ls_index ) ).
  ENDMETHOD.

  METHOD catalog.
    DATA ls_catalog TYPE ty_catalog.

*   every module the tree declares, exposed or not, each carrying the reason
*   it is not. A refusal nobody can see is a refusal nobody can debug, and
*   this channel is a development door rather than an internet-facing one.
    ls_catalog-functions = zcl_osd_fm_registry=>list( ).
    rs_response = ok( /ui2/cl_json=>serialize( data = ls_catalog ) ).
  ENDMETHOD.

  METHOD describe.
    DATA ls_interface TYPE ty_interface.

    ls_interface-function = zcl_osd_fm_registry=>get( iv_name ).
    IF ls_interface-function-name IS INITIAL.
      rs_response = fail( iv_status   = 404
                          iv_reason   = 'Not Found'
                          iv_error    = 'FU_NOT_FOUND'
                          iv_function = iv_name
                          iv_message  = 'No function module of that name in this tree' ).
      RETURN.
    ENDIF.
    ls_interface-parameters = zcl_osd_fm_registry=>parameters( iv_name ).
*   and what those parameter types ARE, not only what they are called: a
*   caller that has to encode a value needs the letter and the length, and a
*   data element carries neither -- it names a domain (backlog D.3)
    ls_interface-types      = zcl_osd_fm_registry=>types( iv_name ).
    rs_response = ok( /ui2/cl_json=>serialize( data = ls_interface ) ).
  ENDMETHOD.

  METHOD invoke.
    DATA ls_function TYPE zcl_osd_fm_registry=>ty_function.
    DATA ls_result   TYPE zcl_osd_fm_call=>ty_result.
    DATA lv_json     TYPE string.

    ls_function = zcl_osd_fm_registry=>get( iv_name ).

    IF ls_function-name IS INITIAL.
*     what a real gateway says when the name is not in TFDIR
      rs_response = fail( iv_status   = 404
                          iv_reason   = 'Not Found'
                          iv_error    = 'FU_NOT_FOUND'
                          iv_function = iv_name
                          iv_message  = 'No function module of that name in this tree' ).
      RETURN.
    ENDIF.

    IF ls_function-remote = abap_false.
*     the gate. A system refuses this call however the caller reaches it, and
*     so does this channel; the module stays callable from inside.
      rs_response = fail( iv_status   = 403
                          iv_reason   = 'Forbidden'
                          iv_error    = 'FUNCTION_NOT_REMOTE_ENABLED'
                          iv_function = ls_function-name
                          iv_message  = 'The function module is not marked remote-enabled in its function group' ).
      RETURN.
    ENDIF.

    IF ls_function-exposed = abap_false.
*     remote-enabled, but this tree cannot carry it: no body, or a signature
*     with nothing to marshal it as. The registry keeps the reason.
      rs_response = fail( iv_status   = 501
                          iv_reason   = 'Not Implemented'
                          iv_error    = 'FUNCTION_NOT_CALLABLE_HERE'
                          iv_function = ls_function-name
                          iv_message  = ls_function-reason ).
      RETURN.
    ENDIF.

    ls_result = zcl_osd_fm_call=>call( iv_name = ls_function-name
                                       iv_json = iv_body ).
    IF ls_result-handled = abap_false.
*     the registry said exposed and the generated dispatcher disagrees, which
*     means the two were generated from different trees
      rs_response = fail( iv_status   = 500
                          iv_reason   = 'Internal Server Error'
                          iv_error    = 'REGISTRY_OUT_OF_STEP'
                          iv_function = ls_function-name
                          iv_message  = 'The registry exposes the module and the generated dispatcher has no body for it' ).
      RETURN.
    ENDIF.

    IF ls_result-exception IS NOT INITIAL.
*     A classic exception is not a failed call. CALL FUNCTION ... EXCEPTIONS
*     comes back with sy-subrc and the conversation is intact, which is
*     exactly what an RFC client is told; only a SYSTEM_FAILURE is a broken
*     call. So the exception is a field of a 200 answer, and the outputs are
*     empty, the way a raising module returns none.
      rs_response = ok( |\{"FUNCTION":"{ ls_function-name }","EXCEPTION":"{ ls_result-exception }"\}| ).
      RETURN.
    ENDIF.

    IF ls_result-json IS INITIAL OR ls_result-json = '{}'.
      lv_json = |\{"FUNCTION":"{ ls_function-name }"\}|.
    ELSE.
      lv_json = |\{"FUNCTION":"{ ls_function-name }",{ substring( val = ls_result-json off = 1 ) }|.
    ENDIF.
    rs_response = ok( lv_json ).
  ENDMETHOD.

  METHOD ok.
    rs_response-status       = 200.
    rs_response-reason       = 'OK'.
    rs_response-content_type = 'application/json'.
    rs_response-body         = iv_json.
  ENDMETHOD.

  METHOD fail.
    DATA ls_error TYPE ty_error.

    ls_error-error    = iv_error.
    ls_error-function = iv_function.
    ls_error-message  = iv_message.

    rs_response-status       = iv_status.
    rs_response-reason       = iv_reason.
    rs_response-content_type = 'application/json'.
    rs_response-body         = /ui2/cl_json=>serialize( data = ls_error ).
  ENDMETHOD.

ENDCLASS.
