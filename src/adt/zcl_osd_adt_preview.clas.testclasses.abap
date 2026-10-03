CLASS ltcl_model DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS ordered FOR TESTING RAISING cx_static_check.
    METHODS empty FOR TESTING RAISING cx_static_check.
ENDCLASS.
CLASS ltcl_model IMPLEMENTATION.
  METHOD ordered.
    DATA lt_fields TYPE zcl_osd_adt_tabledata=>tt_field.
    DATA ls_field TYPE zcl_osd_adt_tabledata=>ty_field.
    DATA lo_json TYPE REF TO zcl_ajson.
    ls_field-name = `Z`.
    APPEND ls_field TO lt_fields.
    ls_field-name = `A`.
    APPEND ls_field TO lt_fields.
    lo_json = zcl_osd_adt_preview=>metadata( lt_fields ).
    cl_abap_unit_assert=>assert_equals( act = lo_json->get_string( `/columns/1/upper` ) exp = `Z` ).
    cl_abap_unit_assert=>assert_equals( act = lo_json->get_string( `/columns/2/upper` ) exp = `A` ).
  ENDMETHOD.
  METHOD empty.
    DATA lt_fields TYPE zcl_osd_adt_tabledata=>tt_field.
    DATA lo_json TYPE REF TO zcl_ajson.
    DATA lt_members TYPE string_table.
    lo_json = zcl_osd_adt_preview=>metadata( lt_fields ).
    lt_members = lo_json->members( `/columns` ).
    cl_abap_unit_assert=>assert_initial( lt_members ).
  ENDMETHOD.
ENDCLASS.
