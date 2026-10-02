"! B8a: deterministic repository type descriptors from the shared catalog.
CLASS zcl_osd_adt_typestructure DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_osd_adt_route.
ENDCLASS.
CLASS zcl_osd_adt_typestructure IMPLEMENTATION.
  METHOD zif_osd_adt_route~handle.
    DATA lt_types TYPE zcl_osd_adt_types=>tt_type.
    DATA ls_type TYPE zcl_osd_adt_types=>ty_type.
    DATA lv_descriptors TYPE string.

    lt_types = zcl_osd_adt_types=>all( ).
    LOOP AT lt_types INTO ls_type.
      lv_descriptors = lv_descriptors && `<SEU_ADT_OBJECT_TYPE_DESCRIPTOR>`
        && |<OBJECT_TYPE>{ ls_type-adt_type }</OBJECT_TYPE>|
        && |<OBJECT_TYPE_LABEL>{ ls_type-label }</OBJECT_TYPE_LABEL>|
        && |<OBJECT_TYPE_LABEL_PLURAL>{ ls_type-plural }</OBJECT_TYPE_LABEL_PLURAL>|
        && |<CATEGORY>{ ls_type-category }</CATEGORY>|
        && |<CATEGORY_LABEL>{ ls_type-category }</CATEGORY_LABEL>|
        && `<URI_TEMPLATE>/sap/bc/adt/` && ls_type-collection && `/{name}</URI_TEMPLATE>`
        && `<PARENT_OBJECT_TYPE/><OBJNAME_MAXLENGTH>30</OBJNAME_MAXLENGTH>`
        && `<CAPABILITIES/><USER_AUTHORIZATIONS/></SEU_ADT_OBJECT_TYPE_DESCRIPTOR>`.
    ENDLOOP.
    rs_response-status = 200.
    rs_response-content_type = zcl_osd_adt_lock=>as_xml_type(
      it_headers = is_request-headers iv_fallback = `com.sap.adt.RepositoryTypeList` ).
    rs_response-body = `<?xml version="1.0" encoding="utf-8"?>`
      && `<asx:abap version="1.0" xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA>`
      && lv_descriptors && `</DATA></asx:values></asx:abap>`.
  ENDMETHOD.
ENDCLASS.
