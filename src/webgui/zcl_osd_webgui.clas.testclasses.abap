CLASS ltcl_okcode DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
* The command field, without a server in front of it. What the HTTP test
* cannot show is that the resolution is a function of the menu and nothing
* else: the same list the tree is drawn from answers the typed name.
  PRIVATE SECTION.
    METHODS the_menu_has_the_fixed_folders FOR TESTING RAISING cx_static_check.
    METHODS a_transaction_is_a_third_kind FOR TESTING RAISING cx_static_check.
    METHODS slash_n_and_case_are_stripped FOR TESTING RAISING cx_static_check.
    METHODS a_folder_is_not_an_okcode FOR TESTING RAISING cx_static_check.
    METHODS an_unknown_code_is_nothing FOR TESTING RAISING cx_static_check.
ENDCLASS.

CLASS ltcl_okcode IMPLEMENTATION.

  METHOD the_menu_has_the_fixed_folders.
* the rows out of the status tables come and go with the system; these do not
    DATA(lt_nodes) = zcl_osd_webgui=>menu( ).
    READ TABLE lt_nodes WITH KEY id = 'MENU' TRANSPORTING NO FIELDS.
    cl_abap_unit_assert=>assert_subrc( ).
    READ TABLE lt_nodes WITH KEY id = 'FAVORITES' TRANSPORTING NO FIELDS.
    cl_abap_unit_assert=>assert_subrc( ).
    READ TABLE lt_nodes WITH KEY parent = 'SERVICES' id = 'ODATA' TRANSPORTING NO FIELDS.
    cl_abap_unit_assert=>assert_subrc( ).
  ENDMETHOD.

  METHOD a_transaction_is_a_third_kind.
    DATA(ls_node) = zcl_osd_webgui=>resolve( 'ZABAPGIT' ).
    cl_abap_unit_assert=>assert_equals( act = ls_node-kind exp = zcl_osd_webgui=>gc_kind-transaction ).
* a transaction is run, not linked to, so it carries no URL at all
    cl_abap_unit_assert=>assert_initial( ls_node-url ).
  ENDMETHOD.

  METHOD slash_n_and_case_are_stripped.
    cl_abap_unit_assert=>assert_equals(
      act = zcl_osd_webgui=>resolve( '/nzabapgit' )-name
      exp = 'ZABAPGIT' ).
    cl_abap_unit_assert=>assert_equals(
      act = zcl_osd_webgui=>resolve( '  /OZABAPGIT ' )-name
      exp = 'ZABAPGIT' ).
* the name a node is called by, not only its technical name
    cl_abap_unit_assert=>assert_equals(
      act = zcl_osd_webgui=>resolve( 'Fiori launchpad' )-url
      exp = '/app/flp.html' ).
  ENDMETHOD.

  METHOD a_folder_is_not_an_okcode.
    cl_abap_unit_assert=>assert_initial( zcl_osd_webgui=>resolve( 'FAVORITES' )-kind ).
  ENDMETHOD.

  METHOD an_unknown_code_is_nothing.
    cl_abap_unit_assert=>assert_initial( zcl_osd_webgui=>resolve( 'ZNOPE' )-kind ).
    cl_abap_unit_assert=>assert_initial( zcl_osd_webgui=>resolve( '' )-kind ).
  ENDMETHOD.

ENDCLASS.


CLASS ltcl_identity DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
* The status bar, and the four identities it used to choose between.
*
* The screen printed "OSG (1) 100": a session number and a client that
* existed nowhere else in the system. What it prints now is sy -- which the
* boot sets from tools/osd-identity.mjs, the one place this tree says who it
* is -- so the test asserts against sy rather than against a string, and a
* renamed system renames the bar with it.
  PRIVATE SECTION.
    METHODS the_bar_is_sy FOR TESTING RAISING cx_static_check.
    METHODS nothing_is_invented FOR TESTING RAISING cx_static_check.
    METHODS the_bar_names_the_process FOR TESTING RAISING cx_static_check.
    METHODS the_menu_reuses_the_nodes FOR TESTING RAISING cx_static_check.
ENDCLASS.

CLASS ltcl_identity IMPLEMENTATION.

  METHOD the_bar_is_sy.
    DATA(ls_ident) = zcl_osd_webgui=>identity( ).
    cl_abap_unit_assert=>assert_equals( act = ls_ident-sid    exp = CONV string( sy-sysid ) ).
    cl_abap_unit_assert=>assert_equals( act = ls_ident-client exp = CONV string( sy-mandt ) ).
    cl_abap_unit_assert=>assert_equals( act = ls_ident-user   exp = CONV string( sy-uname ) ).
* and the boot set them: the runtime's own constants are ABC / 123 /
* USERNAME, and a system that still said ABC would mean the boot never ran
    cl_abap_unit_assert=>assert_differs( act = ls_ident-sid  exp = 'ABC' ).
    cl_abap_unit_assert=>assert_differs( act = ls_ident-user exp = 'USERNAME' ).
  ENDMETHOD.

  METHOD nothing_is_invented.
    DATA(lv_info) = zcl_osd_webgui=>identity( )-info.
    cl_abap_unit_assert=>assert_true( act = xsdbool( lv_info CS sy-sysid ) ).
    cl_abap_unit_assert=>assert_true( act = xsdbool( lv_info CS sy-mandt ) ).
    cl_abap_unit_assert=>assert_false( act = xsdbool( lv_info CS '(1)' ) ).
  ENDMETHOD.

  METHOD the_bar_names_the_process.
* the work process goes where SAP GUI puts the session number, and it comes
* out of the status tables rather than out of this class
    DATA ls_sys TYPE zosd_sys.

    DELETE FROM zosd_sys WHERE sid <> ''.
    ls_sys-sid       = sy-sysid.
    ls_sys-host_kind = 'node'.
    ls_sys-pid       = 4711.
    INSERT zosd_sys FROM ls_sys.

    DATA(ls_ident) = zcl_osd_webgui=>identity( ).
    cl_abap_unit_assert=>assert_equals( act = ls_ident-pid exp = '4711' ).
    cl_abap_unit_assert=>assert_true( act = xsdbool( ls_ident-info CS '(4711)' ) ).

* a deployment with no process number says nothing rather than printing a
* zero that looks like a session: the browser one has none
    DELETE FROM zosd_sys WHERE sid <> ''.
    ls_sys-pid = 0.
    INSERT zosd_sys FROM ls_sys.
    cl_abap_unit_assert=>assert_initial( zcl_osd_webgui=>identity( )-pid ).
    cl_abap_unit_assert=>assert_false( act = xsdbool( zcl_osd_webgui=>identity( )-info CS '(' ) ).

    DELETE FROM zosd_sys WHERE sid <> ''.
  ENDMETHOD.

  METHOD the_menu_reuses_the_nodes.
* System > Status and System > Log off are the targets of nodes the tree
* already draws; the bar must not carry a second copy of either
    DATA(lt_nodes) = zcl_osd_webgui=>menu( ).
    READ TABLE lt_nodes INTO DATA(ls_status) WITH KEY name = 'SM50'.
    cl_abap_unit_assert=>assert_subrc( ).
    cl_abap_unit_assert=>assert_equals(
      act = zcl_osd_webgui=>target( it_nodes = lt_nodes iv_name = 'SM50' )
      exp = ls_status-url ).
    cl_abap_unit_assert=>assert_equals(
      act = zcl_osd_webgui=>target( it_nodes = lt_nodes iv_name = 'FLP' )
      exp = '/app/flp.html' ).
* a name no node has points nowhere, and the item that asks for it is drawn
* as disabled rather than as a link to nothing
    cl_abap_unit_assert=>assert_initial( zcl_osd_webgui=>target( it_nodes = lt_nodes iv_name = 'ZNOPE' ) ).
  ENDMETHOD.

ENDCLASS.


CLASS ltcl_substrate DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
* The GUI substitutes, as a library of this tree.
*
* open-abap-gui is wired in as a lib (abap_transpile.json, docs/webgui.md) for
* the sake of what comes after this screen, and a library nothing calls is a
* library nobody notices has stopped building. The screen calls one method of
* it for real -- cl_gui_control=>escape_html -- and the rest of this class is
* the smallest honest probe of the machinery the next step needs: a document
* in an HTML viewer whose sapevent anchor comes back as a form that posts to
* a URL of ours.
*
* What this does NOT show is that the same happens to abapGit's own HTML.
* That is the first task of the next step and it is deliberately not started
* here (docs/webgui.md, "Out of scope").
  PRIVATE SECTION.
    METHODS escaping_is_the_librarys FOR TESTING RAISING cx_static_check.
    METHODS sapevent_becomes_a_form FOR TESTING RAISING cx_static_check.
ENDCLASS.

CLASS ltcl_substrate IMPLEMENTATION.

  METHOD escaping_is_the_librarys.
    cl_abap_unit_assert=>assert_equals(
      act = cl_gui_control=>escape_html( '<a href="x">&</a>' )
      exp = '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;' ).
  ENDMETHOD.

  METHOD sapevent_becomes_a_form.
    TYPES tt_line TYPE STANDARD TABLE OF string WITH DEFAULT KEY.
    DATA lt_document TYPE tt_line.
    DATA ls_sapevent TYPE cl_gui_control=>ty_sapevent.
    DATA ls_field    TYPE cl_gui_control=>ty_field.

    cl_gui_control=>clear( ).
    DATA(lo_container) = NEW cl_gui_custom_container( container_name = 'OSD_WEBGUI_PROBE' ).
    DATA(lo_viewer) = NEW cl_gui_html_viewer( parent = lo_container ).
    lo_viewer->set_registered_events( VALUE cntl_simple_events( ) ).

    APPEND '<a href="sapevent:stage">Stage</a>' TO lt_document.
    lo_viewer->load_data( EXPORTING url = 'about:probe' CHANGING data_table = lt_document ).

    ls_sapevent-url = '/sap/bc/gui/sap/its/webgui/'.
    ls_sapevent-action_field = 'sapevent'.
    ls_field-name = 'okcode'.
    ls_field-value = 'ZABAPGIT'.
    APPEND ls_field TO ls_sapevent-fields.

    DATA(lv_html) = cl_gui_control=>render_html( iv_document = abap_false
                                                 is_sapevent = ls_sapevent ).
* the anchor is gone and a form that posts to us is in its place, with the
* anchor's own action carried under action_field
    cl_abap_unit_assert=>assert_true( act = xsdbool( lv_html CS 'gg-sapevent' ) ).
    cl_abap_unit_assert=>assert_true( act = xsdbool( lv_html CS 'name=&quot;sapevent&quot; value=&quot;stage&quot;' ) ).
    cl_abap_unit_assert=>assert_true( act = xsdbool( lv_html CS 'ZABAPGIT' ) ).
    cl_abap_unit_assert=>assert_false( act = xsdbool( lv_html CS 'href=&quot;sapevent:' ) ).
    cl_gui_control=>clear( ).
  ENDMETHOD.

ENDCLASS.
