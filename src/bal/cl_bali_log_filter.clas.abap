CLASS cl_bali_log_filter DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_bali_log_filter.
    CLASS-METHODS create
      RETURNING VALUE(filter) TYPE REF TO if_bali_log_filter.
ENDCLASS.

CLASS cl_bali_log_filter IMPLEMENTATION.
  METHOD create.
    filter = NEW cl_bali_log_filter( ).
  ENDMETHOD.
  METHOD if_bali_log_filter~set_descriptor.
    IF object IS INITIAL.
      RAISE EXCEPTION TYPE cx_bali_runtime
        EXPORTING iv_reason = 'Application log object is required'.
    ENDIF.
    me->if_bali_log_filter~object = object.
    me->if_bali_log_filter~subobject = subobject.
    me->if_bali_log_filter~external_id = external_id.
    new_filter = me.
  ENDMETHOD.
ENDCLASS.
