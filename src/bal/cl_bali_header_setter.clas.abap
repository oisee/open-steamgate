CLASS cl_bali_header_setter DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_bali_header_setter.
    TYPES ty_object TYPE c LENGTH 20.
    TYPES ty_subobject TYPE c LENGTH 20.
    TYPES ty_external_id TYPE c LENGTH 100.
    CLASS-METHODS create
      IMPORTING object TYPE ty_object
                subobject TYPE ty_subobject
                external_id TYPE ty_external_id OPTIONAL
      RETURNING VALUE(header) TYPE REF TO if_bali_header_setter
      RAISING cx_bali_runtime.
ENDCLASS.

CLASS cl_bali_header_setter IMPLEMENTATION.
  METHOD create.
    IF object IS INITIAL OR subobject IS INITIAL.
      RAISE EXCEPTION TYPE cx_bali_runtime
        EXPORTING iv_reason = 'Application log object and subobject are required'.
    ENDIF.
    DATA(lo_header) = NEW cl_bali_header_setter( ).
    lo_header->if_bali_header_getter~object = object.
    lo_header->if_bali_header_getter~subobject = subobject.
    lo_header->if_bali_header_getter~external_id = external_id.
    header = lo_header.
  ENDMETHOD.
ENDCLASS.
