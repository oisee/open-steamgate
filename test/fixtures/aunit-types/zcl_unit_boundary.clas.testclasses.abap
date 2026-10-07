CLASS ltcl_boundary DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.
  PRIVATE SECTION.
    METHODS string_spaces FOR TESTING.
    METHODS c_spaces FOR TESTING.
    METHODS char_cp FOR TESTING.
    METHODS true_default FOR TESTING.
ENDCLASS.
CLASS ltcl_boundary IMPLEMENTATION.
  METHOD string_spaces.
    DATA act TYPE string.
    DATA exp TYPE string.
    act = `-1  `.
    exp = `-2  `.
    cl_abap_unit_assert=>assert_equals( act = act exp = exp ).
  ENDMETHOD.
  METHOD c_spaces.
    DATA act TYPE c LENGTH 4.
    DATA exp TYPE c LENGTH 4.
    act = '-1  '.
    exp = '-2  '.
    cl_abap_unit_assert=>assert_equals( act = act exp = exp ).
  ENDMETHOD.
  METHOD char_cp.
    cl_abap_unit_assert=>assert_char_cp( act = 'abc' exp = 'z*' ).
  ENDMETHOD.
  METHOD true_default.
    cl_abap_unit_assert=>assert_true( act = abap_false ).
  ENDMETHOD.
ENDCLASS.
