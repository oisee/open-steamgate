CLASS ltcl_tree DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS node_keys FOR TESTING.
    METHODS flat FOR TESTING.
ENDCLASS.
CLASS ltcl_tree IMPLEMENTATION.
  METHOD node_keys.
    DATA lt_nodes TYPE zcl_osd_adt_tree=>tt_node.
    DATA ls_node TYPE zcl_osd_adt_tree=>ty_node.
    DATA lt_keys TYPE string_table.
    DATA lv_body TYPE string.
    ls_node-type = `CLAS/OC`.
    ls_node-name = `ZCL_A`.
    APPEND ls_node TO lt_nodes.
    ls_node-type = `PROG/P`.
    ls_node-name = `ZA`.
    APPEND ls_node TO lt_nodes.
    APPEND `000002` TO lt_keys.
    lv_body = zcl_osd_adt_tree=>document( it_nodes = lt_nodes it_keys = lt_keys ).
    cl_abap_unit_assert=>assert_char_cp( act = lv_body exp = `*<OBJECT_NAME>ZA</OBJECT_NAME>*` ).
    cl_abap_unit_assert=>assert_equals( act = boolc( lv_body NS `ZCL_A` ) exp = abap_true ).
    cl_abap_unit_assert=>assert_char_cp( act = lv_body exp = `*<NODE_ID>000001</NODE_ID>*` ).
  ENDMETHOD.
  METHOD flat.
    DATA lt_nodes TYPE zcl_osd_adt_tree=>tt_node.
    DATA ls_node TYPE zcl_osd_adt_tree=>ty_node.
    DATA lv_body TYPE string.
    ls_node-type = `DEVC/K`.
    ls_node-name = `$PKG`.
    ls_node-uri = `/sap/bc/adt/packages/%24pkg`.
    APPEND ls_node TO lt_nodes.
    lv_body = zcl_osd_adt_tree=>document( it_nodes = lt_nodes iv_flat = abap_true ).
    cl_abap_unit_assert=>assert_equals( act = boolc( lv_body NS `CATEGORIES` AND lv_body NS `NODE_ID` AND lv_body NS `<VERSION>` ) exp = abap_true ).
    cl_abap_unit_assert=>assert_char_cp( act = lv_body exp = `*<OBJECT_URI>/sap/bc/adt/packages/%24pkg</OBJECT_URI>*` ).
  ENDMETHOD.
ENDCLASS.
