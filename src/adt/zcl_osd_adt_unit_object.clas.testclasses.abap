CLASS ltcl_discovery DEFINITION FINAL FOR TESTING RISK LEVEL HARMLESS DURATION SHORT.
  PRIVATE SECTION.
    METHODS projection FOR TESTING RAISING zcx_ajson_error.
    METHODS metadata FOR TESTING.
ENDCLASS.
CLASS ltcl_discovery IMPLEMENTATION.
  METHOD projection.
    DATA lo_plan TYPE REF TO zcl_ajson.
    lo_plan = zcl_ajson=>parse( iv_json = `{"object":{"name":"ZCL_X","type":"CLAS","private":"omit"},"classes":[],"writes":[],"writesTotal":0}` iv_keep_item_order = abap_true ).
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_adt_unit_object=>document( lo_plan )
      exp = `{"object":{"type":"CLAS","name":"ZCL_X"},"writes":[],"writesTotal":0,"classes":[]}` ).
  ENDMETHOD.
  METHOD metadata.
    DATA lv_xml TYPE string.
    lv_xml = zcl_osd_adt_unit_object=>metadata( ).
    cl_abap_unit_assert=>assert_char_cp( act = lv_xml exp = `*globalWorkbenchType="PROG/P"*` ).
  ENDMETHOD.
ENDCLASS.
