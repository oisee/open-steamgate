* The coverage gate must ask MATCH in the serving child too.
CLASS zcl_osd_adt_coverage_probe DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
ENDCLASS.
CLASS zcl_osd_adt_coverage_probe IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.
    DATA lt_routes TYPE zcl_osd_adt_router=>tt_route.
    DATA ls_route TYPE zcl_osd_adt_router=>ty_route.
    DATA lv_source TYPE string.
    DATA lv_line TYPE string.
    DATA lt_lines TYPE string_table.
    DATA lv_method TYPE string.
    DATA lv_path TYPE string.
    DATA lv_found TYPE abap_bool.
    DATA lv_text TYPE string.
    lt_routes = zcl_osd_adt_router=>routes( ).
    LOOP AT lt_routes INTO ls_route.
      CONCATENATE 'TABLE' ls_route-method ls_route-pattern
        ls_route-handler ls_route-served_by INTO lv_text SEPARATED BY '|'.
      out->write( lv_text ).
    ENDLOOP.
    CALL FUNCTION 'ZOSD_STORE' DESTINATION 'STORE'
      EXPORTING iv_command = 'SYSTEM' iv_type = 'BUILD'
                iv_name = 'ADT_COVERAGE'
      IMPORTING ev_source = lv_source.
    SPLIT lv_source AT cl_abap_char_utilities=>newline INTO TABLE lt_lines.
    LOOP AT lt_lines INTO lv_line.
      SPLIT lv_line AT space INTO lv_method lv_path.
      zcl_osd_adt_router=>match(
        EXPORTING it_routes = lt_routes iv_method = lv_method
                  iv_path = lv_path
        IMPORTING ev_found = lv_found es_route = ls_route ).
      CONCATENATE 'PROBE' lv_found ls_route-method ls_route-pattern
        ls_route-handler ls_route-served_by INTO lv_text SEPARATED BY '|'.
      out->write( lv_text ).
    ENDLOOP.
  ENDMETHOD.
ENDCLASS.
