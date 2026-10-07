CLASS ltcl_values DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.
  PRIVATE SECTION.
    METHODS i_neg FOR TESTING.
    METHODS i_zero FOR TESTING.
    METHODS i_pos FOR TESTING.
    METHODS p_dec FOR TESTING.
    METHODS f_flt FOR TESTING.
    METHODS decf FOR TESTING.
    METHODS c_txt FOR TESTING.
    METHODS s_txt FOR TESTING.
    METHODS n_num FOR TESTING.
    METHODS int8 FOR TESTING.
ENDCLASS.
CLASS ltcl_values IMPLEMENTATION.
  METHOD i_neg.
    DATA act TYPE i.
    DATA exp TYPE i.
    act = -1.
    exp = 5.
    cl_abap_unit_assert=>assert_equals( act = act exp = exp ).
  ENDMETHOD.
  METHOD i_zero.
    DATA act TYPE i.
    DATA exp TYPE i.
    act = 0.
    exp = 1.
    cl_abap_unit_assert=>assert_equals( act = act exp = exp ).
  ENDMETHOD.
  METHOD i_pos.
    DATA act TYPE i.
    DATA exp TYPE i.
    act = 3.
    exp = -4.
    cl_abap_unit_assert=>assert_equals( act = act exp = exp ).
  ENDMETHOD.
  METHOD p_dec.
    DATA act TYPE p LENGTH 8 DECIMALS 2.
    DATA exp TYPE p LENGTH 8 DECIMALS 2.
    act = '-1.50'.
    exp = '2.25'.
    cl_abap_unit_assert=>assert_equals( act = act exp = exp ).
  ENDMETHOD.
  METHOD f_flt.
    DATA act TYPE f.
    DATA exp TYPE f.
    act = '-1.5'.
    exp = 2.
    cl_abap_unit_assert=>assert_equals( act = act exp = exp ).
  ENDMETHOD.
  METHOD decf.
    DATA act TYPE decfloat34.
    DATA exp TYPE decfloat34.
    act = '-1.5'.
    exp = 2.
    cl_abap_unit_assert=>assert_equals( act = act exp = exp ).
  ENDMETHOD.
  METHOD c_txt.
    DATA act TYPE c LENGTH 5.
    DATA exp TYPE c LENGTH 5.
    act = '-1'.
    exp = '-2'.
    cl_abap_unit_assert=>assert_equals( act = act exp = exp ).
  ENDMETHOD.
  METHOD s_txt.
    DATA act TYPE string.
    DATA exp TYPE string.
    act = '-1'.
    exp = '-2'.
    cl_abap_unit_assert=>assert_equals( act = act exp = exp ).
  ENDMETHOD.
  METHOD n_num.
    DATA act TYPE n LENGTH 4.
    DATA exp TYPE n LENGTH 4.
    act = '0012'.
    exp = '0034'.
    cl_abap_unit_assert=>assert_equals( act = act exp = exp ).
  ENDMETHOD.
  METHOD int8.
    DATA act TYPE int8.
    DATA exp TYPE int8.
    act = -7.
    exp = 7.
    cl_abap_unit_assert=>assert_equals( act = act exp = exp ).
  ENDMETHOD.
ENDCLASS.
