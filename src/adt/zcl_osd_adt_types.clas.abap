"! The object types of the ADT facade and the collection each lives under
"! below /sap/bc/adt: the Node facade's TYPES (tools/osd-store.mjs), as far
"! as the routes ported so far need them (port-map.md section 2, step 12).
"!
"! Slice 2 needs the types a client locks: the six source types, in the
"! order TYPES lists them, and the package. The router generates its LOCK
"! and UNLOCK rows from this list, so a type added here gets its rows, and
"! no row is written by hand.
CLASS zcl_osd_adt_types DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_type,
             type       TYPE string,
             collection TYPE string,
           END OF ty_type.
    TYPES tt_type TYPE STANDARD TABLE OF ty_type WITH DEFAULT KEY.

    "! the source types, then DEVC: what POST <collection>/:name locks
    CLASS-METHODS lockable
      RETURNING VALUE(rt_types) TYPE tt_type.

    "! The Node facade's SOURCE_TYPES, derived from TYPES.source in
    "! tools/osd-store.mjs (the six source collections, in that order).
    CLASS-METHODS sources
      RETURNING VALUE(rt_types) TYPE tt_type.

    "! the type whose collection a path names: the path without its last
    "! segment, compared without case, as the router matched it; initial
    "! when no lockable collection matches
    CLASS-METHODS type_of_path
      IMPORTING iv_path        TYPE string
      RETURNING VALUE(rv_type) TYPE string.
  PRIVATE SECTION.
    CLASS-METHODS add
      IMPORTING iv_type       TYPE string
                iv_collection TYPE string
      CHANGING  ct_types      TYPE tt_type.
ENDCLASS.

CLASS zcl_osd_adt_types IMPLEMENTATION.

  METHOD lockable.
    rt_types = sources( ).
    add( EXPORTING iv_type = `DEVC` iv_collection = `packages` CHANGING ct_types = rt_types ).
  ENDMETHOD.

  METHOD sources.
    add( EXPORTING iv_type = `CLAS` iv_collection = `oo/classes` CHANGING ct_types = rt_types ).
    add( EXPORTING iv_type = `INTF` iv_collection = `oo/interfaces` CHANGING ct_types = rt_types ).
    add( EXPORTING iv_type = `PROG` iv_collection = `programs/programs` CHANGING ct_types = rt_types ).
    add( EXPORTING iv_type = `DDLS` iv_collection = `ddic/ddl/sources` CHANGING ct_types = rt_types ).
    add( EXPORTING iv_type = `SRVD` iv_collection = `ddic/srvd/sources` CHANGING ct_types = rt_types ).
    add( EXPORTING iv_type = `INCL` iv_collection = `programs/includes` CHANGING ct_types = rt_types ).
  ENDMETHOD.

  METHOD add.
    DATA ls_type TYPE ty_type.
    ls_type-type = iv_type.
    ls_type-collection = iv_collection.
    APPEND ls_type TO ct_types.
  ENDMETHOD.

  METHOD type_of_path.
    DATA lt_parts TYPE string_table.
    DATA lv_lines TYPE i.
    DATA lv_collection TYPE string.
    DATA lt_types TYPE tt_type.
    DATA ls_type TYPE ty_type.

    SPLIT iv_path AT `/` INTO TABLE lt_parts.
    lv_lines = lines( lt_parts ).
    IF lv_lines > 0.
      DELETE lt_parts INDEX lv_lines.
    ENDIF.
    CONCATENATE LINES OF lt_parts INTO lv_collection SEPARATED BY `/`.
    lv_collection = to_lower( lv_collection ).
    lt_types = lockable( ).
    LOOP AT lt_types INTO ls_type.
      IF lv_collection = to_lower( zcl_osd_adt_router=>c_base && `/` && ls_type-collection ).
        rv_type = ls_type-type.
        RETURN.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

ENDCLASS.
