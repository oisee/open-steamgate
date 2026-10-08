CLASS ltcl_test DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.
PRIVATE SECTION.
METHODS check FOR TESTING.
ENDCLASS.
CLASS ltcl_test IMPLEMENTATION.
METHOD check.
DATA implemented TYPE REF TO zcl_osgt_declared_impl.
DATA child TYPE REF TO zcl_osgt_declared_child.
DATA other TYPE REF TO zcl_osgt_declared_other.
DATA interface TYPE REF TO zif_osgt_declared.
implemented = NEW zcl_osgt_declared_impl( ).
child = NEW zcl_osgt_declared_child( ).
other = NEW zcl_osgt_declared_other( ).
cl_abap_unit_assert=>assert_equals( act = xsdbool( implemented IS INSTANCE OF zif_osgt_declared ) exp = abap_true ).
cl_abap_unit_assert=>assert_equals( act = xsdbool( child IS INSTANCE OF zif_osgt_declared ) exp = abap_true ).
cl_abap_unit_assert=>assert_equals( act = xsdbool( other IS INSTANCE OF zif_osgt_declared ) exp = abap_false ).
TRY.
  interface ?= implemented.
  interface ?= child.
CATCH cx_sy_move_cast_error.
  cl_abap_unit_assert=>fail( ).
ENDTRY.
TRY.
  interface ?= other.
  cl_abap_unit_assert=>fail( ).
CATCH cx_sy_move_cast_error.
ENDTRY.
ENDMETHOD.
ENDCLASS.
