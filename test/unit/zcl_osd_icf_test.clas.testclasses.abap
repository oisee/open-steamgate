* The ICF registry read from ABAP, which is the half of G.5 that makes the
* claim "the system's own inventory" true from inside the system.
*
* The rows are inserted by the test rather than seeded: this is about the
* lookup, and a lookup checked against whatever the tree happens to carry is
* checked against a moving target. The rows' SHAPE comes from
* tools/osd-icf-rows.mjs, which is checked against the objects separately.
CLASS ltcl_lookup DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS setup.
    METHODS teardown.
    METHODS a_node_is_read_from_the_table FOR TESTING RAISING cx_static_check.
    METHODS the_deepest_node_wins FOR TESTING RAISING cx_static_check.
    METHODS a_child_inherits_the_handler FOR TESTING RAISING cx_static_check.
    METHODS an_inactive_node_answers_none FOR TESTING RAISING cx_static_check.
    METHODS an_unknown_path_has_no_handler FOR TESTING RAISING cx_static_check.
    METHODS node_and_handler_differ FOR TESTING RAISING cx_static_check.
    METHODS add
      IMPORTING
        iv_name    TYPE icfservice-icf_name
        iv_url     TYPE icfservice-url
        iv_handler TYPE icfhandler-icfhandler OPTIONAL
        iv_active  TYPE icfservice-icfactive DEFAULT 'X'.
ENDCLASS.

CLASS ltcl_lookup IMPLEMENTATION.

  METHOD add.
    DATA ls_service TYPE icfservice.
    DATA ls_handler TYPE icfhandler.

    ls_service-icf_name   = iv_name.
    ls_service-icfparguid = iv_name.
    ls_service-icfnodguid = iv_name.
    ls_service-url        = iv_url.
    ls_service-icfactive  = iv_active.
    ls_service-orig_name  = iv_name.
    INSERT icfservice FROM ls_service.

    IF iv_handler IS NOT INITIAL.
      ls_handler-icf_name   = iv_name.
      ls_handler-icfparguid = iv_name.
      ls_handler-icforder   = '01'.
      ls_handler-icftyp     = 'A'.
      ls_handler-icfhandler = iv_handler.
      INSERT icfhandler FROM ls_handler.
    ENDIF.
  ENDMETHOD.

  METHOD setup.
    DELETE FROM icfservice.
    DELETE FROM icfhandler.
  ENDMETHOD.

  METHOD teardown.
    DELETE FROM icfservice.
    DELETE FROM icfhandler.
  ENDMETHOD.

  METHOD a_node_is_read_from_the_table.
    DATA lt_nodes TYPE zcl_osd_icf=>tt_node.

    add( iv_name = 'ZOSD_RFC' iv_url = '/sap/bc/osd/rfc/' iv_handler = 'ZCL_OSD_RFC_HTTP' ).
    lt_nodes = zcl_osd_icf=>nodes( ).
    cl_abap_unit_assert=>assert_equals( act = lines( lt_nodes ) exp = 1 ).
    cl_abap_unit_assert=>assert_equals( act = lt_nodes[ 1 ]-handler exp = 'ZCL_OSD_RFC_HTTP' ).
    cl_abap_unit_assert=>assert_equals( act = lt_nodes[ 1 ]-icftyp exp = 'A' ).
  ENDMETHOD.

  METHOD the_deepest_node_wins.
*   /sap/bc/gui/sap/its/webgui/sapevent/ is a node under
*   /sap/bc/gui/sap/its/webgui/, and both have a handler. A parent that
*   swallowed its child would send every sapevent round trip to the wrong
*   class -- the same defect `services()` sorts against on the host side.
    add( iv_name = 'WEBGUI'   iv_url = '/sap/bc/gui/sap/its/webgui/' iv_handler = 'ZCL_OSD_WEBGUI' ).
    add( iv_name = 'SAPEVENT' iv_url = '/sap/bc/gui/sap/its/webgui/sapevent/' iv_handler = 'ZCL_OSD_SAPEVENT' ).

    cl_abap_unit_assert=>assert_equals(
      act = zcl_osd_icf=>handler_of( '/sap/bc/gui/sap/its/webgui/sapevent/' )
      exp = 'ZCL_OSD_SAPEVENT' ).
    cl_abap_unit_assert=>assert_equals(
      act = zcl_osd_icf=>handler_of( '/sap/bc/gui/sap/its/webgui/' )
      exp = 'ZCL_OSD_WEBGUI' ).
  ENDMETHOD.

  METHOD a_child_inherits_the_handler.
*   **ICF's own rule, and the one that makes a deployed Fiori app work.**
*   A UI5 application's node carries no handler: it is served by the branch
*   above it. Measured on A4H 2026-09-19 -- /sap/bc/ui5_ui5/sap/ has the
*   handler and /sap/bc/ui5_ui5/sap/arsrvc_upb_admn/ answers 200 with none
*   of its own. A lookup matching whole nodes only would call every
*   deployed application unserved.
    add( iv_name = 'ZOSD_BSP' iv_url = '/sap/bc/ui5_ui5/sap/' iv_handler = 'ZCL_OSD_BSP' ).
    add( iv_name = 'ZOSD_008' iv_url = '/sap/bc/ui5_ui5/sap/zosd_008_app/' ).

    cl_abap_unit_assert=>assert_equals(
      act = zcl_osd_icf=>handler_of( '/sap/bc/ui5_ui5/sap/zosd_008_app/index.html' )
      exp = 'ZCL_OSD_BSP' ).
  ENDMETHOD.

  METHOD an_inactive_node_answers_none.
*   and it does not hide the node above it either: an inactive child of an
*   active branch is served by the branch, which is what deactivating a
*   single service in SICF does
    add( iv_name = 'ZOSD_BSP' iv_url = '/sap/bc/ui5_ui5/sap/' iv_handler = 'ZCL_OSD_BSP' ).
    add( iv_name = 'ZOFF'     iv_url = '/sap/bc/ui5_ui5/sap/zoff/'
         iv_handler = 'ZCL_OFF' iv_active = ' ' ).

    cl_abap_unit_assert=>assert_equals(
      act = zcl_osd_icf=>handler_of( '/sap/bc/ui5_ui5/sap/zoff/index.html' )
      exp = 'ZCL_OSD_BSP' ).
  ENDMETHOD.

  METHOD an_unknown_path_has_no_handler.
    add( iv_name = 'ZOSD_RFC' iv_url = '/sap/bc/osd/rfc/' iv_handler = 'ZCL_OSD_RFC_HTTP' ).
    cl_abap_unit_assert=>assert_initial( zcl_osd_icf=>handler_of( '/sap/public/nothing/' ) ).
  ENDMETHOD.

  METHOD node_and_handler_differ.
*   what SICF shows when you navigate to a path is not what runs on it: the
*   node exists and is the one you edit, the handler is the one above it
    add( iv_name = 'ZOSD_BSP' iv_url = '/sap/bc/ui5_ui5/sap/' iv_handler = 'ZCL_OSD_BSP' ).
    add( iv_name = 'ZOSD_008' iv_url = '/sap/bc/ui5_ui5/sap/zosd_008_app/' ).

    cl_abap_unit_assert=>assert_equals(
      act = zcl_osd_icf=>node_of( '/sap/bc/ui5_ui5/sap/zosd_008_app/x.js' )-icf_name
      exp = 'ZOSD_008' ).
    cl_abap_unit_assert=>assert_equals(
      act = zcl_osd_icf=>handler_of( '/sap/bc/ui5_ui5/sap/zosd_008_app/x.js' )
      exp = 'ZCL_OSD_BSP' ).
  ENDMETHOD.

ENDCLASS.
