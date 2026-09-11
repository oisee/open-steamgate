CLASS zcl_stg_filter DEFINITION PUBLIC CREATE PUBLIC.
* $filter -> /iwbep/t_mgw_select_option. QW4 fills this in; until then the
* DPC gets the raw string only, like a real system does for a filter it
* cannot express as select-options.
  PUBLIC SECTION.
    CLASS-METHODS parse
      IMPORTING
        iv_filter                TYPE string
        is_set                   TYPE zcl_stg_model_info=>ty_entity_set
      RETURNING
        VALUE(rt_select_options) TYPE /iwbep/t_mgw_select_option
      RAISING
        zcx_stg_error.
ENDCLASS.

CLASS zcl_stg_filter IMPLEMENTATION.

  METHOD parse.
    RETURN.
  ENDMETHOD.

ENDCLASS.
