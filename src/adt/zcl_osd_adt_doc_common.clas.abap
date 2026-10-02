"! Small shared documents; optional fields distinguish empty from absent.
CLASS zcl_osd_adt_doc_common DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_item,
             name TYPE string,
             description TYPE string,
             data TYPE string,
             has_data TYPE abap_bool,
           END OF ty_item.
    TYPES tt_item TYPE STANDARD TABLE OF ty_item WITH DEFAULT KEY.
    TYPES: BEGIN OF ty_reference,
             uri TYPE string,
             type TYPE string,
             name TYPE string,
             package_name TYPE string,
             description TYPE string,
             has_uri TYPE abap_bool,
             has_package TYPE abap_bool,
             has_description TYPE abap_bool,
           END OF ty_reference.
    TYPES tt_reference TYPE STANDARD TABLE OF ty_reference WITH DEFAULT KEY.
    CLASS-METHODS named_items IMPORTING it_items TYPE tt_item RETURNING VALUE(rv_xml) TYPE string.
    CLASS-METHODS object_references IMPORTING it_objects TYPE tt_reference RETURNING VALUE(rv_xml) TYPE string.
    "! Identity, title, self and timestamp deliberately remain unescaped.
    CLASS-METHODS empty_feed IMPORTING iv_user_full_name TYPE string iv_system_id TYPE string
      iv_title TYPE string iv_self TYPE string iv_updated TYPE string RETURNING VALUE(rv_xml) TYPE string.
ENDCLASS.
CLASS zcl_osd_adt_doc_common IMPLEMENTATION.
  METHOD named_items.
    DATA lv_nl TYPE string.
    DATA lv_count TYPE string.
    DATA ls_item TYPE ty_item.
    lv_nl = cl_abap_char_utilities=>newline.
    lv_count = lines( it_items ).
    CONDENSE lv_count NO-GAPS.
    rv_xml = `<?xml version="1.0" encoding="utf-8"?>` && lv_nl
      && `<nameditem:namedItemList xmlns:nameditem="http://www.sap.com/adt/nameditem">` && lv_nl
      && `  <nameditem:totalItemCount>` && lv_count && `</nameditem:totalItemCount>` && lv_nl.
    LOOP AT it_items INTO ls_item.
      IF sy-tabix > 1.
        rv_xml = rv_xml && lv_nl.
      ENDIF.
      rv_xml = rv_xml && `  <nameditem:namedItem><nameditem:name>` && zcl_osd_adt_xml=>esc( ls_item-name )
        && `</nameditem:name><nameditem:description>` && zcl_osd_adt_xml=>esc( ls_item-description )
        && `</nameditem:description>`.
      IF ls_item-has_data = abap_true.
        rv_xml = rv_xml && `<nameditem:data>` && zcl_osd_adt_xml=>esc( ls_item-data ) && `</nameditem:data>`.
      ENDIF.
      rv_xml = rv_xml && `</nameditem:namedItem>`.
    ENDLOOP.
    rv_xml = rv_xml && lv_nl && `</nameditem:namedItemList>` && lv_nl.
  ENDMETHOD.
  METHOD object_references.
    DATA lv_nl TYPE string.
    DATA ls_object TYPE ty_reference.
    lv_nl = cl_abap_char_utilities=>newline.
    rv_xml = `<?xml version="1.0" encoding="utf-8"?>` && lv_nl
      && `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">` && lv_nl.
    LOOP AT it_objects INTO ls_object.
      IF sy-tabix > 1.
        rv_xml = rv_xml && lv_nl.
      ENDIF.
      rv_xml = rv_xml && `  <adtcore:objectReference `.
      IF ls_object-has_uri = abap_true.
        rv_xml = rv_xml && `adtcore:uri="` && zcl_osd_adt_xml=>esc( ls_object-uri ) && `" `.
      ENDIF.
      rv_xml = rv_xml && `adtcore:type="` && zcl_osd_adt_xml=>esc( ls_object-type )
        && `" adtcore:name="` && zcl_osd_adt_xml=>esc( ls_object-name ) && `"`.
      IF ls_object-has_package = abap_true.
        rv_xml = rv_xml && ` adtcore:packageName="` && zcl_osd_adt_xml=>esc( ls_object-package_name ) && `"`.
      ENDIF.
      IF ls_object-has_description = abap_true.
        rv_xml = rv_xml && ` adtcore:description="` && zcl_osd_adt_xml=>esc( ls_object-description ) && `"`.
      ENDIF.
      rv_xml = rv_xml && `/>`.
    ENDLOOP.
    rv_xml = rv_xml && lv_nl && `</adtcore:objectReferences>` && lv_nl.
  ENDMETHOD.
  METHOD empty_feed.
    rv_xml = `<?xml version="1.0" encoding="utf-8"?>`
      && `<atom:feed xmlns:atom="http://www.w3.org/2005/Atom">`
      && `<atom:author><atom:name>` && iv_user_full_name && `</atom:name></atom:author>`
      && `<atom:contributor><atom:name>` && iv_system_id && `</atom:name></atom:contributor>`
      && `<atom:link href="` && iv_self && `" rel="self" type="application/atom+xml;type=feed"/>`
      && `<atom:title type="text">` && iv_title && `</atom:title>`
      && `<atom:updated>` && iv_updated && `</atom:updated></atom:feed>`.
  ENDMETHOD.
ENDCLASS.
