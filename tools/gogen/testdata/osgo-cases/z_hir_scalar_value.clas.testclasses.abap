CLASS ltcl_test DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.
PRIVATE SECTION.
METHODS check FOR TESTING.
ENDCLASS.
CLASS ltcl_test IMPLEMENTATION.
METHOD check.
DATA(integer) = VALUE i( ).
DATA(int8) = VALUE int8( ).
DATA(float) = VALUE f( ).
DATA(packed) = VALUE p( ).
DATA(string) = VALUE string( ).
DATA(xstring) = VALUE xstring( ).
DATA(character) = VALUE c( ).
DATA(numeric) = VALUE n( ).
DATA(date) = VALUE d( ).
DATA(time) = VALUE t( ).
DATA(flag) = VALUE abap_bool( ).
cl_abap_unit_assert=>assert_equals( act = integer exp = 0 ).
cl_abap_unit_assert=>assert_equals( act = int8 exp = 0 ).
cl_abap_unit_assert=>assert_equals( act = float exp = 0 ).
cl_abap_unit_assert=>assert_equals( act = packed exp = 0 ).
cl_abap_unit_assert=>assert_equals( act = string exp = `` ).
cl_abap_unit_assert=>assert_equals( act = xstring exp = `` ).
cl_abap_unit_assert=>assert_equals( act = character exp = `` ).
cl_abap_unit_assert=>assert_equals( act = numeric exp = `0` ).
cl_abap_unit_assert=>assert_equals( act = date exp = `00000000` ).
cl_abap_unit_assert=>assert_equals( act = time exp = `000000` ).
cl_abap_unit_assert=>assert_equals( act = flag exp = abap_false ).
ENDMETHOD.
ENDCLASS.
