CLASS zcl_osd_adt_types DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_type,
             type       TYPE string,
             collection TYPE string,
             source TYPE abap_bool,
             adt_type TYPE string,
             label TYPE string,
             plural TYPE string,
             category TYPE string,
             tree_folder TYPE string,
             tree_label TYPE string,
             tree_category TYPE string,
             tree_category_label TYPE string,
           END OF ty_type.
    TYPES tt_type TYPE STANDARD TABLE OF ty_type WITH DEFAULT KEY.

    TYPES: BEGIN OF ty_object,
             type TYPE string,
             name TYPE string,
             found TYPE abap_bool,
             ok TYPE abap_bool,
           END OF ty_object.
    CLASS-METHODS all RETURNING VALUE(rt_types) TYPE tt_type.
    CLASS-METHODS adt_type IMPORTING iv_type TYPE string RETURNING VALUE(rv_type) TYPE string.
    CLASS-METHODS type_of_collection IMPORTING iv_collection TYPE string RETURNING VALUE(rv_type) TYPE string.
    CLASS-METHODS object_from_uri IMPORTING iv_uri TYPE string RETURNING VALUE(rs_object) TYPE ty_object.
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
    CLASS-METHODS add_sources CHANGING ct_types TYPE tt_type.
    CLASS-METHODS add_dictionary CHANGING ct_types TYPE tt_type.
    CLASS-METHODS add_other CHANGING ct_types TYPE tt_type.

ENDCLASS.

CLASS zcl_osd_adt_types IMPLEMENTATION.

  METHOD all.
    add_sources( CHANGING ct_types = rt_types ).
    add_dictionary( CHANGING ct_types = rt_types ).
    add_other( CHANGING ct_types = rt_types ).
  ENDMETHOD.
  METHOD add_sources.
    DATA ls_type TYPE ty_type.
    CLEAR ls_type.
    ls_type-type = `CLAS`.
    ls_type-collection = `oo/classes`.
    ls_type-source = `X`.
    ls_type-adt_type = `CLAS/OC`.
    ls_type-label = `Class`.
    ls_type-plural = `Classes`.
    ls_type-category = `Source Code Library`.
    ls_type-tree_folder = `DEVC/OC`.
    ls_type-tree_label = `Classes`.
    ls_type-tree_category = `source_library`.
    ls_type-tree_category_label = `Source Code Library`.
    APPEND ls_type TO ct_types.
    CLEAR ls_type.
    ls_type-type = `INTF`.
    ls_type-collection = `oo/interfaces`.
    ls_type-source = `X`.
    ls_type-adt_type = `INTF/OI`.
    ls_type-label = `Interface`.
    ls_type-plural = `Interfaces`.
    ls_type-category = `Source Code Library`.
    ls_type-tree_folder = `DEVC/OI`.
    ls_type-tree_label = `Interfaces`.
    ls_type-tree_category = `source_library`.
    ls_type-tree_category_label = `Source Code Library`.
    APPEND ls_type TO ct_types.
    CLEAR ls_type.
    ls_type-type = `PROG`.
    ls_type-collection = `programs/programs`.
    ls_type-source = `X`.
    ls_type-adt_type = `PROG/P`.
    ls_type-label = `Program`.
    ls_type-plural = `Programs`.
    ls_type-category = `Source Code Library`.
    ls_type-tree_folder = `DEVC/P`.
    ls_type-tree_label = `Programs`.
    ls_type-tree_category = `source_library`.
    ls_type-tree_category_label = `Source Code Library`.
    APPEND ls_type TO ct_types.
    CLEAR ls_type.
    ls_type-type = `FUGR`.
    ls_type-collection = `functions/groups`.
    ls_type-source = ``.
    ls_type-adt_type = `FUGR/F`.
    ls_type-label = `Function Group`.
    ls_type-plural = `Function Groups`.
    ls_type-category = `Source Code Library`.
    ls_type-tree_folder = `DEVC/F`.
    ls_type-tree_label = `Function Groups`.
    ls_type-tree_category = `source_library`.
    ls_type-tree_category_label = `Source Code Library`.
    APPEND ls_type TO ct_types.
    CLEAR ls_type.
    ls_type-type = `TABL`.
    ls_type-collection = `ddic/tables`.
    ls_type-source = ``.
    ls_type-adt_type = `TABL/DT`.
    ls_type-label = `Database Table`.
    ls_type-plural = `Database Tables`.
    ls_type-category = `Dictionary`.
    ls_type-tree_folder = ``.
    ls_type-tree_label = `Database Tables`.
    ls_type-tree_category = `dictionary`.
    ls_type-tree_category_label = `Dictionary`.
    APPEND ls_type TO ct_types.
  ENDMETHOD.
  METHOD add_dictionary.
    DATA ls_type TYPE ty_type.
    CLEAR ls_type.
    ls_type-type = `DTEL`.
    ls_type-collection = `ddic/dataelements`.
    ls_type-source = ``.
    ls_type-adt_type = `DTEL/DE`.
    ls_type-label = `Data Element`.
    ls_type-plural = `Data Elements`.
    ls_type-category = `Dictionary`.
    ls_type-tree_folder = ``.
    ls_type-tree_label = `Data Elements`.
    ls_type-tree_category = `dictionary`.
    ls_type-tree_category_label = `Dictionary`.
    APPEND ls_type TO ct_types.
    CLEAR ls_type.
    ls_type-type = `DOMA`.
    ls_type-collection = `ddic/domains`.
    ls_type-source = ``.
    ls_type-adt_type = `DOMA/DD`.
    ls_type-label = `Domain`.
    ls_type-plural = `Domains`.
    ls_type-category = `Dictionary`.
    ls_type-tree_folder = ``.
    ls_type-tree_label = `Domains`.
    ls_type-tree_category = `dictionary`.
    ls_type-tree_category_label = `Dictionary`.
    APPEND ls_type TO ct_types.
    CLEAR ls_type.
    ls_type-type = `TTYP`.
    ls_type-collection = `ddic/tabletypes`.
    ls_type-source = ``.
    ls_type-adt_type = `TTYP/DA`.
    ls_type-label = `Table Type`.
    ls_type-plural = `Table Types`.
    ls_type-category = `Dictionary`.
    ls_type-tree_folder = ``.
    ls_type-tree_label = `Table Types`.
    ls_type-tree_category = `dictionary`.
    ls_type-tree_category_label = `Dictionary`.
    APPEND ls_type TO ct_types.
    CLEAR ls_type.
    ls_type-type = `DDLS`.
    ls_type-collection = `ddic/ddl/sources`.
    ls_type-source = `X`.
    ls_type-adt_type = `DDLS/DF`.
    ls_type-label = `Data Definition`.
    ls_type-plural = `Data Definitions`.
    ls_type-category = `Dictionary`.
    ls_type-tree_folder = ``.
    ls_type-tree_label = `Data Definitions`.
    ls_type-tree_category = `dictionary`.
    ls_type-tree_category_label = `Dictionary`.
    APPEND ls_type TO ct_types.
    CLEAR ls_type.
    ls_type-type = `SRVD`.
    ls_type-collection = `ddic/srvd/sources`.
    ls_type-source = `X`.
    ls_type-adt_type = `SRVD/SRV`.
    ls_type-label = `Service Definition`.
    ls_type-plural = `Service Definitions`.
    ls_type-category = `Dictionary`.
    ls_type-tree_folder = ``.
    ls_type-tree_label = `Service Definitions`.
    ls_type-tree_category = `dictionary`.
    ls_type-tree_category_label = `Dictionary`.
    APPEND ls_type TO ct_types.
  ENDMETHOD.
  METHOD add_other.
    DATA ls_type TYPE ty_type.
    CLEAR ls_type.
    ls_type-type = `VIEW`.
    ls_type-collection = `ddic/views`.
    ls_type-source = ``.
    ls_type-adt_type = `VIEW/DV`.
    ls_type-label = `View`.
    ls_type-plural = `Views`.
    ls_type-category = `Dictionary`.
    ls_type-tree_folder = ``.
    ls_type-tree_label = `Views`.
    ls_type-tree_category = `dictionary`.
    ls_type-tree_category_label = `Dictionary`.
    APPEND ls_type TO ct_types.
    CLEAR ls_type.
    ls_type-type = `SHLP`.
    ls_type-collection = `ddic/searchhelps`.
    ls_type-source = ``.
    ls_type-adt_type = `SHLP/DH`.
    ls_type-label = `Search Help`.
    ls_type-plural = `Search Helps`.
    ls_type-category = `Dictionary`.
    ls_type-tree_folder = ``.
    ls_type-tree_label = `Search Helps`.
    ls_type-tree_category = `dictionary`.
    ls_type-tree_category_label = `Dictionary`.
    APPEND ls_type TO ct_types.
    CLEAR ls_type.
    ls_type-type = `MSAG`.
    ls_type-collection = `messageclass`.
    ls_type-source = ``.
    ls_type-adt_type = `MSAG/N`.
    ls_type-label = `Message Class`.
    ls_type-plural = `Message Classes`.
    ls_type-category = `Source Code Library`.
    ls_type-tree_folder = ``.
    ls_type-tree_label = `Message Classes`.
    ls_type-tree_category = `source_library`.
    ls_type-tree_category_label = `Source Code Library`.
    APPEND ls_type TO ct_types.
    CLEAR ls_type.
    ls_type-type = `DEVC`.
    ls_type-collection = `packages`.
    ls_type-source = ``.
    ls_type-adt_type = `DEVC/K`.
    ls_type-label = `Package`.
    ls_type-plural = `Packages`.
    ls_type-category = `Others`.
    ls_type-tree_folder = `DEVC/K`.
    ls_type-tree_label = `Subpackages`.
    ls_type-tree_category = `other`.
    ls_type-tree_category_label = `Others`.
    APPEND ls_type TO ct_types.
    CLEAR ls_type.
    ls_type-type = `INCL`.
    ls_type-collection = `programs/includes`.
    ls_type-source = `X`.
    ls_type-adt_type = `PROG/I`.
    ls_type-label = `Include`.
    ls_type-plural = `Includes`.
    ls_type-category = `Source Code Library`.
    ls_type-tree_folder = ``.
    ls_type-tree_label = `Includes`.
    ls_type-tree_category = `source_library`.
    ls_type-tree_category_label = `Source Code Library`.
    APPEND ls_type TO ct_types.
  ENDMETHOD.
  METHOD adt_type.
    DATA lt_types TYPE tt_type.
    DATA ls_type TYPE ty_type.
    rv_type = iv_type.
    IF iv_type = `STRU`.
      rv_type = `TABL/DS`.
      RETURN.
    ENDIF.
    lt_types = all( ).
    READ TABLE lt_types INTO ls_type WITH KEY type = iv_type.
    IF sy-subrc = 0.
      rv_type = ls_type-adt_type.
    ENDIF.
  ENDMETHOD.
  METHOD type_of_collection.
    DATA lt_types TYPE tt_type.
    DATA ls_type TYPE ty_type.
    lt_types = all( ).
    READ TABLE lt_types INTO ls_type WITH KEY collection = iv_collection.
    IF sy-subrc = 0.
      rv_type = ls_type-type.
    ENDIF.
  ENDMETHOD.
  METHOD object_from_uri.
    DATA lv_path TYPE string.
    DATA lv_tail TYPE string.
    DATA lv_prefix TYPE string.
    DATA lv_offset TYPE i.
    DATA lv_len TYPE i.
    DATA lt_types TYPE tt_type.
    DATA ls_type TYPE ty_type.
    rs_object-ok = abap_true.
    lv_path = iv_uri.
    FIND FIRST OCCURRENCE OF `#` IN lv_path MATCH OFFSET lv_offset.
    IF sy-subrc = 0.
      lv_path = lv_path(lv_offset).
    ENDIF.
    FIND FIRST OCCURRENCE OF `?` IN lv_path MATCH OFFSET lv_offset.
    IF sy-subrc = 0.
      lv_path = lv_path(lv_offset).
    ENDIF.
    lv_offset = strlen( lv_path ) - 12.
    IF lv_offset >= 0 AND substring( val = lv_path off = lv_offset ) = `/source/main`.
      lv_path = lv_path(lv_offset).
    ENDIF.
    lt_types = all( ).
    LOOP AT lt_types INTO ls_type.
      lv_prefix = `/sap/bc/adt/` && ls_type-collection && `/`.
      lv_len = strlen( lv_prefix ).
      IF strlen( lv_path ) >= lv_len AND lv_path(lv_len) = lv_prefix.
        lv_tail = substring( val = lv_path off = lv_len ).
        zcl_osd_adt_uri=>decode_component( EXPORTING iv_text = lv_tail
          IMPORTING ev_text = rs_object-name ev_ok = rs_object-ok ).
        rs_object-found = abap_true.
        rs_object-type = ls_type-type.
        rs_object-name = to_upper( rs_object-name ).
        RETURN.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD lockable.
    DATA lt_all TYPE tt_type.
    DATA ls_type TYPE ty_type.
    rt_types = sources( ).
    lt_all = all( ).
    READ TABLE lt_all INTO ls_type WITH KEY type = `DEVC`.
    APPEND ls_type TO rt_types.
  ENDMETHOD.

  METHOD sources.
    DATA lt_all TYPE tt_type.
    DATA ls_type TYPE ty_type.
    lt_all = all( ).
    LOOP AT lt_all INTO ls_type WHERE source = abap_true.
      APPEND ls_type TO rt_types.
    ENDLOOP.
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
