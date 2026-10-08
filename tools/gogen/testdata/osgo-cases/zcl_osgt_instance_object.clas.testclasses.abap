CLASS ltcl_test DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.
PRIVATE SECTION.
METHODS check FOR TESTING.
ENDCLASS.
CLASS ltcl_test IMPLEMENTATION.
METHOD check.
DATA concrete TYPE REF TO zcl_osgt_instance_object.
DATA generic TYPE REF TO object.
DATA intf TYPE REF TO zif_osgt_declared.
concrete = NEW zcl_osgt_instance_object( ).
generic = concrete.
intf = concrete.
cl_abap_unit_assert=>assert_equals( act = xsdbool( concrete IS INSTANCE OF object ) exp = abap_true ).
cl_abap_unit_assert=>assert_equals( act = xsdbool( generic IS INSTANCE OF object ) exp = abap_true ).
cl_abap_unit_assert=>assert_equals( act = xsdbool( intf IS INSTANCE OF object ) exp = abap_true ).
cl_abap_unit_assert=>assert_equals( act = xsdbool( generic IS NOT INSTANCE OF object ) exp = abap_false ).
IF generic IS INSTANCE OF object.
ELSE.
cl_abap_unit_assert=>fail( ).
ENDIF.
ENDMETHOD.
ENDCLASS.
