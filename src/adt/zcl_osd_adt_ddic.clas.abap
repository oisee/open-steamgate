"! B8a: parser information belongs to the system and is a resource miss.
CLASS zcl_osd_adt_ddic DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_osd_adt_route.
ENDCLASS.
CLASS zcl_osd_adt_ddic IMPLEMENTATION.
  METHOD zif_osd_adt_route~handle.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    CASE is_request-pattern.
      WHEN `/sap/bc/adt/ddic/tables/parser/info`.
        lx_error = zcx_osd_adt=>not_found(
          iv_message = `the DDL parser information is the system's own and is not served here`
          iv_miss = zcx_osd_adt=>c_miss_resource ).
      WHEN OTHERS.
        lx_error = zcx_osd_adt=>internal( |unknown DDIC route pattern: { is_request-pattern }| ).
    ENDCASE.
    RAISE EXCEPTION lx_error.
  ENDMETHOD.
ENDCLASS.
