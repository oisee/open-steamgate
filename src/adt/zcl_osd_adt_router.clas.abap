"! The route table of the ADT facade in ABAP (ADR 0007, port-map.md section
"! 2, step 3): an ordered list of rows, each a method, a path pattern, the
"! class that answers and who serves it, ABAP or HOST.
"!
"! The rules, which are Express's, because the Node facade is the reference
"! until the last group has moved:
"!   - the first row that matches wins, so order is part of the contract;
"!   - a pattern segment :name matches one non-empty segment and is handed
"!     to the route percent-decoded, after the split and after the match
"!     (ZCL_OSD_ADT_URI: a segment that does not decode is a 400, as in
"!     Express); a last segment * matches whatever follows;
"!   - literal segments compare without case, and one trailing slash on the
"!     request is ignored (Express routes are case-insensitive, non-strict);
"!   - HEAD matches a HEAD row or, failing that, a GET row. The GET answer is
"!     kept whole and the HTTP layer drops the body, so Content-Length is the
"!     GET's, as Express sends it. A row of its own is how a HEAD answers
"!     differently (the graph does);
"!   - a row served by HOST, or no row at all, is not answered here: the
"!     handler says so and the Node front hands the request to the Node
"!     facade after the step (docs/adt-abap-port/slice-3-front.md). This
"!     table is the only matcher: the front no longer matches it in
"!     JavaScript, every request enters the handler first.
"! Slice 1 lists the rows ABAP serves and one catch-all for the host. The
"! per-type rows are generated from the type table (ZCL_OSD_ADT_TYPES) when
"! their group moves; slice 2 moves POST <collection>/:name, LOCK and UNLOCK.
CLASS zcl_osd_adt_router DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CONSTANTS c_base TYPE string VALUE `/sap/bc/adt`.
    CONSTANTS c_abap TYPE string VALUE `ABAP`.
    CONSTANTS c_host TYPE string VALUE `HOST`.

    TYPES: BEGIN OF ty_route,
             method    TYPE string,
             pattern   TYPE string,
             handler   TYPE string,
             served_by TYPE string,
           END OF ty_route.
    TYPES tt_route TYPE STANDARD TABLE OF ty_route WITH DEFAULT KEY.

    TYPES: BEGIN OF ty_result,
             served_by TYPE string,
             response  TYPE zif_osd_adt_route=>ty_response,
           END OF ty_result.

    CLASS-METHODS routes
      RETURNING VALUE(rt_routes) TYPE tt_route.

    CLASS-METHODS match
      IMPORTING it_routes TYPE tt_route
                iv_method TYPE string
                iv_path   TYPE string
      EXPORTING ev_found  TYPE abap_bool
                es_route  TYPE ty_route
                et_params TYPE zif_osd_adt_route=>tt_param.

    "! it_routes replaces the table, for a test
    CLASS-METHODS dispatch
      IMPORTING is_request       TYPE zif_osd_adt_route=>ty_request
                it_routes        TYPE tt_route OPTIONAL
      RETURNING VALUE(rs_result) TYPE ty_result
      RAISING   zcx_osd_adt.

  PRIVATE SECTION.
    CLASS-METHODS add
      IMPORTING iv_method    TYPE string
                iv_pattern   TYPE string
                iv_handler   TYPE string OPTIONAL
                iv_served_by TYPE string DEFAULT c_abap
      CHANGING  ct_routes    TYPE tt_route.
    CLASS-METHODS match_pattern
      IMPORTING iv_pattern TYPE string
                iv_path    TYPE string
      EXPORTING ev_match   TYPE abap_bool
                et_params  TYPE zif_osd_adt_route=>tt_param.
ENDCLASS.

CLASS zcl_osd_adt_router IMPLEMENTATION.

  METHOD routes.
    DATA lt_types TYPE zcl_osd_adt_types=>tt_type.
    DATA ls_type TYPE zcl_osd_adt_types=>ty_type.
    DATA lv_pattern TYPE string.

    add( EXPORTING iv_method = `HEAD` iv_pattern = `/sap/bc/adt/compatibility/graph` iv_handler = `ZCL_OSD_ADT_GRAPH`
         CHANGING ct_routes = rt_routes ).
    add( EXPORTING iv_method = `GET` iv_pattern = `/sap/bc/adt/compatibility/graph` iv_handler = `ZCL_OSD_ADT_GRAPH`
         CHANGING ct_routes = rt_routes ).
    add( EXPORTING iv_method = `GET` iv_pattern = `/sap/bc/adt/core/http/systeminformation`
                   iv_handler = `ZCL_OSD_ADT_SYSINFO`
         CHANGING ct_routes = rt_routes ).
*   Static package rows must precede future GET packages/:name rows.
    add( EXPORTING iv_method = `GET` iv_pattern = `/sap/bc/adt/repository/informationsystem/virtualfolders/facets`
                   iv_handler = `ZCL_OSD_ADT_RIS_STATIC` CHANGING ct_routes = rt_routes ).
    add( EXPORTING iv_method = `GET` iv_pattern = `/sap/bc/adt/repository/informationsystem/objecttypes`
                   iv_handler = `ZCL_OSD_ADT_RIS_STATIC` CHANGING ct_routes = rt_routes ).
    add( EXPORTING iv_method = `GET` iv_pattern = `/sap/bc/adt/repository/informationsystem/releasestates`
                   iv_handler = `ZCL_OSD_ADT_RIS_STATIC` CHANGING ct_routes = rt_routes ).
    add( EXPORTING iv_method = `GET` iv_pattern = `/sap/bc/adt/repository/informationsystem/objectproperties/values`
                   iv_handler = `ZCL_OSD_ADT_RIS_STATIC` CHANGING ct_routes = rt_routes ).
    add( EXPORTING iv_method = `GET` iv_pattern = `/sap/bc/adt/packages/settings`
                   iv_handler = `ZCL_OSD_ADT_RIS_STATIC` CHANGING ct_routes = rt_routes ).
    add( EXPORTING iv_method = `GET` iv_pattern = `/sap/bc/adt/packages/valuehelps/:what`
                   iv_handler = `ZCL_OSD_ADT_RIS_STATIC` CHANGING ct_routes = rt_routes ).
    add( EXPORTING iv_method = `POST` iv_pattern = `/sap/bc/adt/repository/typestructure`
                   iv_handler = `ZCL_OSD_ADT_TYPESTRUCTURE` CHANGING ct_routes = rt_routes ).
    add( EXPORTING iv_method = `GET` iv_pattern = `/sap/bc/adt/ddic/tables/parser/info`
                   iv_handler = `ZCL_OSD_ADT_DDIC` CHANGING ct_routes = rt_routes ).
    add( EXPORTING iv_method = `GET` iv_pattern = `/sap/bc/adt/ddic/dataelements/:name` iv_handler = `ZCL_OSD_ADT_DDIC` CHANGING ct_routes = rt_routes ).
    add( EXPORTING iv_method = `GET` iv_pattern = `/sap/bc/adt/ddic/tables/:name` iv_handler = `ZCL_OSD_ADT_DDIC` CHANGING ct_routes = rt_routes ).
    add( EXPORTING iv_method = `GET` iv_pattern = `/sap/bc/adt/ddic/tables/:name/source/main` iv_handler = `ZCL_OSD_ADT_DDIC` CHANGING ct_routes = rt_routes ).
*   After the B1 statics: packages/settings must match before packages/:name.
    add( EXPORTING iv_method = `GET` iv_pattern = `/sap/bc/adt/packages/:name` iv_handler = `ZCL_OSD_ADT_PACKAGE` CHANGING ct_routes = rt_routes ).
    add( EXPORTING iv_method = `POST` iv_pattern = `/sap/bc/adt/repository/nodepath` iv_handler = `ZCL_OSD_ADT_TREE` CHANGING ct_routes = rt_routes ).
    add( EXPORTING iv_method = `POST` iv_pattern = `/sap/bc/adt/repository/nodestructure` iv_handler = `ZCL_OSD_ADT_TREE` CHANGING ct_routes = rt_routes ).
    add( EXPORTING iv_method = `GET` iv_pattern = `/sap/bc/adt/checkruns/reporters`
                   iv_handler = `ZCL_OSD_ADT_CHECKRUN` CHANGING ct_routes = rt_routes ).
    add( EXPORTING iv_method = `POST` iv_pattern = `/sap/bc/adt/checkruns`
                   iv_handler = `ZCL_OSD_ADT_CHECKRUN` CHANGING ct_routes = rt_routes ).
    add( EXPORTING iv_method = `GET` iv_pattern = `/sap/bc/adt/abapunit/metadata`
                   iv_handler = `ZCL_OSD_ADT_UNIT_OBJECT` CHANGING ct_routes = rt_routes ).
    add( EXPORTING iv_method = `GET` iv_pattern = `/sap/bc/adt/core/http/unit/object`
                   iv_handler = `ZCL_OSD_ADT_UNIT_OBJECT` CHANGING ct_routes = rt_routes ).
*   LOCK and UNLOCK, one row per lockable type, from the type table
    lt_types = zcl_osd_adt_types=>lockable( ).
    LOOP AT lt_types INTO ls_type.
      lv_pattern = c_base && `/` && ls_type-collection && `/:name`.
      add( EXPORTING iv_method = `POST` iv_pattern = lv_pattern iv_handler = `ZCL_OSD_ADT_LOCK`
           CHANGING ct_routes = rt_routes ).
    ENDLOOP.
*   Versions use the same source collections as the Node facade. These
*   specific GET rows precede the HOST catch-all and cannot shadow POST LOCK.
    lt_types = zcl_osd_adt_types=>sources( ).
    LOOP AT lt_types INTO ls_type.
      lv_pattern = c_base && `/` && ls_type-collection && `/:name/source/main/versions`.
      add( EXPORTING iv_method = `GET` iv_pattern = lv_pattern iv_handler = `ZCL_OSD_ADT_VERSIONS`
           CHANGING ct_routes = rt_routes ).
      add( EXPORTING iv_method = `GET` iv_pattern = lv_pattern && `/:stamp/:version/content`
                     iv_handler = `ZCL_OSD_ADT_VERSIONS` CHANGING ct_routes = rt_routes ).
      IF ls_type-type = `DDLS`.
        lv_pattern = c_base && `/` && ls_type-collection && `/:name/versions`.
        add( EXPORTING iv_method = `GET` iv_pattern = lv_pattern iv_handler = `ZCL_OSD_ADT_VERSIONS`
             CHANGING ct_routes = rt_routes ).
        add( EXPORTING iv_method = `GET` iv_pattern = lv_pattern && `/:stamp/:version/content`
                       iv_handler = `ZCL_OSD_ADT_VERSIONS` CHANGING ct_routes = rt_routes ).
      ENDIF.
      IF ls_type-type = `CLAS` OR ls_type-type = `INTF`.
        lv_pattern = c_base && `/` && ls_type-collection && `/:name/includes/:include/versions`.
        add( EXPORTING iv_method = `GET` iv_pattern = lv_pattern iv_handler = `ZCL_OSD_ADT_VERSIONS`
             CHANGING ct_routes = rt_routes ).
        add( EXPORTING iv_method = `GET` iv_pattern = lv_pattern && `/:stamp/:version/content`
                       iv_handler = `ZCL_OSD_ADT_VERSIONS` CHANGING ct_routes = rt_routes ).
      ENDIF.
    ENDLOOP.
*   everything else is still the Node facade's, until its group moves
    add( EXPORTING iv_method = `*` iv_pattern = `/sap/bc/adt/*` iv_served_by = c_host
         CHANGING ct_routes = rt_routes ).
  ENDMETHOD.

  METHOD add.
    DATA ls_route TYPE ty_route.
    ls_route-method = iv_method.
    ls_route-pattern = iv_pattern.
    ls_route-handler = iv_handler.
    ls_route-served_by = iv_served_by.
    APPEND ls_route TO ct_routes.
  ENDMETHOD.

  METHOD match.
    DATA ls_route TYPE ty_route.
    DATA lv_match TYPE abap_bool.

    CLEAR: ev_found, es_route, et_params.
    LOOP AT it_routes INTO ls_route.
      IF ls_route-method <> `*` AND ls_route-method <> iv_method
          AND NOT ( iv_method = `HEAD` AND ls_route-method = `GET` ).
        CONTINUE.
      ENDIF.
      match_pattern( EXPORTING iv_pattern = ls_route-pattern
                               iv_path    = iv_path
                     IMPORTING ev_match   = lv_match
                               et_params  = et_params ).
      IF lv_match = abap_true.
        ev_found = abap_true.
        es_route = ls_route.
        RETURN.
      ENDIF.
    ENDLOOP.
    CLEAR et_params.
  ENDMETHOD.

  METHOD match_pattern.
    DATA lt_pattern TYPE string_table.
    DATA lt_path TYPE string_table.
    DATA lv_part TYPE string.
    DATA lv_segment TYPE string.
    DATA lv_last TYPE i.
    DATA ls_param TYPE zif_osd_adt_route=>ty_param.

    CLEAR: ev_match, et_params.
    SPLIT iv_pattern AT `/` INTO TABLE lt_pattern.
    SPLIT iv_path AT `/` INTO TABLE lt_path.
    lv_last = lines( lt_pattern ).

    LOOP AT lt_pattern INTO lv_part.
      IF sy-tabix = lv_last AND lv_part = `*`.
        ev_match = abap_true.
        RETURN.
      ENDIF.
      READ TABLE lt_path INDEX sy-tabix INTO lv_segment.
      IF sy-subrc <> 0.
        CLEAR et_params.
        RETURN.
      ENDIF.
      IF strlen( lv_part ) > 1 AND lv_part(1) = `:`.
        IF lv_segment IS INITIAL.
          CLEAR et_params.
          RETURN.
        ENDIF.
        ls_param-name = substring( val = lv_part off = 1 ).
*       raw: decoded by dispatch after the match, where a refusal is a 400
        ls_param-value = lv_segment.
        APPEND ls_param TO et_params.
      ELSEIF to_lower( lv_part ) <> to_lower( lv_segment ).
        CLEAR et_params.
        RETURN.
      ENDIF.
    ENDLOOP.

    IF lines( lt_path ) = lv_last.
      ev_match = abap_true.
    ELSE.
      CLEAR et_params.
    ENDIF.
  ENDMETHOD.

  METHOD dispatch.
    DATA ls_route TYPE ty_route.
    DATA lv_found TYPE abap_bool.
    DATA ls_request TYPE zif_osd_adt_route=>ty_request.
    DATA li_route TYPE REF TO zif_osd_adt_route.
    DATA lt_routes TYPE tt_route.
    FIELD-SYMBOLS <ls_param> LIKE LINE OF ls_request-params.

    lt_routes = it_routes.
    IF lt_routes IS INITIAL.
      lt_routes = routes( ).
    ENDIF.
    ls_request = is_request.
    match( EXPORTING it_routes = lt_routes
                     iv_method = is_request-method
                     iv_path   = is_request-path
           IMPORTING ev_found  = lv_found
                     es_route  = ls_route
                     et_params = ls_request-params ).
    IF lv_found = abap_false OR ls_route-served_by = c_host.
      rs_result-served_by = c_host.
      RETURN.
    ENDIF.

    LOOP AT ls_request-params ASSIGNING <ls_param>.
      <ls_param>-value = zcl_osd_adt_uri=>decode_segment( <ls_param>-value ).
    ENDLOOP.

    ls_request-pattern = ls_route-pattern.
    CREATE OBJECT li_route TYPE (ls_route-handler).
    rs_result-served_by = c_abap.
    rs_result-response = li_route->handle( ls_request ).
  ENDMETHOD.

ENDCLASS.
