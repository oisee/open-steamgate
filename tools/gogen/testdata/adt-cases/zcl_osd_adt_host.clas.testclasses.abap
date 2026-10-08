CLASS ltcl_probe DEFINITION FOR TESTING RISK LEVEL HARMLESS DURATION SHORT.
 PRIVATE SECTION.
 METHODS one_runtime FOR TESTING.
ENDCLASS.
CLASS ltcl_probe IMPLEMENTATION.
 METHOD one_runtime.
 cl_abap_unit_assert=>assert_equals( act = zcl_osd_adt_host=>one_runtime( ) exp = abap_false ).
 ENDMETHOD.
ENDCLASS.
