CLASS ltcl_typestructure DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS dataname FOR TESTING RAISING cx_static_check.
    METHODS descriptors FOR TESTING RAISING cx_static_check.
ENDCLASS.
CLASS ltcl_typestructure IMPLEMENTATION.
  METHOD descriptors.
    DATA li_route TYPE REF TO zif_osd_adt_route.
    DATA ls_request TYPE zif_osd_adt_route=>ty_request.
    DATA ls_response TYPE zif_osd_adt_route=>ty_response.
    DATA ls_block TYPE zcl_osd_adt_scan=>ty_block.
    DATA lt_blocks TYPE zcl_osd_adt_scan=>tt_block.
    CREATE OBJECT li_route TYPE zcl_osd_adt_typestructure.
    ls_request-pattern = `/sap/bc/adt/repository/typestructure`.
    ls_response = li_route->handle( ls_request ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status exp = 200 ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-content_type
      exp = `application/vnd.sap.as+xml; charset=utf-8; dataname=com.sap.adt.RepositoryTypeList` ).
    lt_blocks = zcl_osd_adt_scan=>blocks( iv_xml = ls_response-body iv_element = `SEU_ADT_OBJECT_TYPE_DESCRIPTOR` ).
    cl_abap_unit_assert=>assert_equals( act = lines( lt_blocks ) exp = 15 ).
    READ TABLE lt_blocks INTO ls_block INDEX 1.
    cl_abap_unit_assert=>assert_subrc( ).
    cl_abap_unit_assert=>assert_equals( act = ls_block-content
      exp = `<OBJECT_TYPE>CLAS/OC</OBJECT_TYPE>`
        && `<OBJECT_TYPE_LABEL>Class</OBJECT_TYPE_LABEL>`
        && `<OBJECT_TYPE_LABEL_PLURAL>Classes</OBJECT_TYPE_LABEL_PLURAL>`
        && `<CATEGORY>Source Code Library</CATEGORY>`
        && `<CATEGORY_LABEL>Source Code Library</CATEGORY_LABEL>`
        && `<URI_TEMPLATE>/sap/bc/adt/oo/classes/{name}</URI_TEMPLATE>`
        && `<PARENT_OBJECT_TYPE/><OBJNAME_MAXLENGTH>30</OBJNAME_MAXLENGTH>`
        && `<CAPABILITIES/><USER_AUTHORIZATIONS/>` ).
  ENDMETHOD.
  METHOD dataname.
    DATA li_route TYPE REF TO zif_osd_adt_route.
    DATA ls_request TYPE zif_osd_adt_route=>ty_request.
    DATA ls_response TYPE zif_osd_adt_route=>ty_response.
    DATA ls_header TYPE ihttpnvp.
    CREATE OBJECT li_route TYPE zcl_osd_adt_typestructure.
    ls_request-pattern = `/sap/bc/adt/repository/typestructure`.
    ls_header-name = `Accept`.
    ls_header-value = `application/vnd.sap.as+xml; dataname=foo.bar`.
    APPEND ls_header TO ls_request-headers.
    ls_response = li_route->handle( ls_request ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-content_type
      exp = `application/vnd.sap.as+xml; charset=utf-8; dataname=foo.bar` ).
  ENDMETHOD.
ENDCLASS.
