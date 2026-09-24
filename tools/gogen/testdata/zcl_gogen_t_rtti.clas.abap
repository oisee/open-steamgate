CLASS zcl_gogen_t_rtti DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
    TYPES: BEGIN OF ty_flat,
             c3 TYPE c LENGTH 3,
             n4 TYPE n LENGTH 4,
             x2 TYPE x LENGTH 2,
             d  TYPE d,
             t  TYPE t,
             f  TYPE f,
             i  TYPE i,
             i8 TYPE int8,
             p  TYPE p LENGTH 8 DECIMALS 2,
             b  TYPE abap_bool,
           END OF ty_flat.
    TYPES ty_flats TYPE STANDARD TABLE OF ty_flat WITH DEFAULT KEY.
    TYPES: BEGIN OF ty_deep,
             s  TYPE string,
             xs TYPE xstring,
             fl TYPE ty_flat,
             tb TYPE ty_flats,
           END OF ty_deep.
  PRIVATE SECTION.
    CLASS-METHODS d1 IMPORTING p TYPE any RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_rtti IMPLEMENTATION.
  METHOD d1.
* what cl_abap_typedescr=>describe_by_data says of a component: kind, type
* kind, length, decimals, the output length of an elementary one; the
* absolute name only where it is not a technical name
    DATA lo TYPE REF TO cl_abap_typedescr.
    DATA le TYPE REF TO cl_abap_elemdescr.
    lo = cl_abap_typedescr=>describe_by_data( p ).
    rv = |{ lo->kind }/{ lo->type_kind }/{ lo->decimals }|.
    IF lo->kind <> cl_abap_typedescr=>kind_struct.
      rv = |{ rv }/{ lo->length }|.
    ENDIF.
    IF lo->absolute_name NP '\TYPE=%_T*'.
      rv = |{ rv }/{ lo->absolute_name }/{ lo->get_relative_name( ) }/{ lo->is_ddic_type( ) }|.
    ENDIF.
    IF lo->kind = cl_abap_typedescr=>kind_elem.
      le ?= lo.
      rv = |{ rv }/{ le->output_length }|.
    ENDIF.
  ENDMETHOD.

  METHOD run.
    DATA ls TYPE ty_deep.
    DATA lt TYPE ty_flats.
    DATA lo TYPE REF TO cl_abap_typedescr.
    DATA lt2 TYPE cl_abap_structdescr=>component_table.
    DATA ls2 LIKE LINE OF lt2.
    DATA lo_s TYPE REF TO cl_abap_structdescr.
    DATA lo_t TYPE REF TO cl_abap_tabledescr.
    rv = |c3:{ d1( ls-fl-c3 ) } n4:{ d1( ls-fl-n4 ) } x2:{ d1( ls-fl-x2 ) }|.
    rv = |{ rv } d:{ d1( ls-fl-d ) } t:{ d1( ls-fl-t ) } f:{ d1( ls-fl-f ) }|.
    rv = |{ rv } i:{ d1( ls-fl-i ) } i8:{ d1( ls-fl-i8 ) } p:{ d1( ls-fl-p ) }|.
    rv = |{ rv } b:{ d1( ls-fl-b ) } s:{ d1( ls-s ) } xs:{ d1( ls-xs ) }|.
    rv = |{ rv } flat:{ d1( ls-fl ) } deep:{ d1( ls ) }|.
    lo = cl_abap_typedescr=>describe_by_data( ls ).
    lo_s ?= lo.
    lt2 = lo_s->get_components( ).
    rv = |{ rv } comps:|.
    LOOP AT lt2 INTO ls2.
      rv = |{ rv }{ ls2-name }={ ls2-type->kind },|.
    ENDLOOP.
    lo_t ?= cl_abap_typedescr=>describe_by_data( lt ).
    lo = lo_t->get_table_line_type( ).
    rv = |{ rv } line:{ lo->absolute_name }|.
    rv = |{ rv } tk:{ lo_t->table_kind } uk:{ lo_t->has_unique_key }|.
    IF cl_abap_typedescr=>describe_by_data( lt ) = lo_t.
      rv = |{ rv } same|.
    ENDIF.
  ENDMETHOD.
ENDCLASS.
