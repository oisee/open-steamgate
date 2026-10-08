// Synthetic class with the measured 7.58 probe's layout; no captured XML.
export const name = "ZCL_OUTLINE_PARITY_FIX";
export const main = `"! Outline coordinate fixture
CLASS zcl_outline_parity_fix DEFINITION
  PUBLIC
  CREATE PUBLIC.

  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.

    ALIASES run FOR if_oo_adt_classrun~main.

    " an instance method
    METHODS greet
      IMPORTING iv_name        TYPE string
      RETURNING VALUE(rv_text) TYPE string.

    "! a static method
    CLASS-METHODS twice
      IMPORTING iv_value        TYPE i
      RETURNING VALUE(rv_value) TYPE i.

    " a long signature over several lines
    METHODS long_signature
      IMPORTING
        iv_first  TYPE string
        iv_second TYPE i DEFAULT 0
        it_lines  TYPE string_table OPTIONAL
      EXPORTING
        ev_count  TYPE i
      CHANGING
        cv_state  TYPE string.

  PROTECTED SECTION.

    METHODS prot_helper
      RETURNING VALUE(rv_n) TYPE i.

  PRIVATE SECTION.
    DATA mv_count TYPE i.

    " a private method
    METHODS priv_helper
      IMPORTING iv_n TYPE i.
ENDCLASS.



CLASS zcl_outline_parity_fix IMPLEMENTATION.

  METHOD if_oo_adt_classrun~main.
    out->write( greet( \`world\` ) ).
  ENDMETHOD.



  METHOD greet.
    " greet says hello
    rv_text = |Hello { iv_name }|.
  ENDMETHOD.

  METHOD twice.
    rv_value = lcl_helper=>double( iv_value ).
  ENDMETHOD.


  METHOD long_signature.
* a star comment inside the long one
    DATA lv_line TYPE string.
    ev_count = lines( it_lines ).
    LOOP AT it_lines INTO lv_line.
      cv_state = cv_state && lv_line.
    ENDLOOP.
    cv_state = cv_state && iv_first && iv_second.
  ENDMETHOD.



  METHOD prot_helper.
    rv_n = mv_count.
  ENDMETHOD.

  METHOD priv_helper.
    mv_count = mv_count + iv_n.
  ENDMETHOD.
ENDCLASS.
`;
export const implementations = `*"* Local helper definitions and implementations
*"* Keep three comment lines to exercise include coordinates
*"* independently of the main source

CLASS lcl_helper DEFINITION.
  PUBLIC SECTION.
    CLASS-METHODS double
      IMPORTING iv        TYPE i
      RETURNING VALUE(rv) TYPE i.
ENDCLASS.


CLASS lcl_helper IMPLEMENTATION.

  METHOD double.
    rv = iv * 2.
  ENDMETHOD.
ENDCLASS.
`;
export const testclasses = `*"* Synthetic ABAP unit tests

CLASS ltcl_probe DEFINITION FINAL FOR TESTING
  RISK LEVEL HARMLESS
  DURATION SHORT.

  PRIVATE SECTION.
    METHODS first_test FOR TESTING.

    METHODS second_test FOR TESTING.
ENDCLASS.


CLASS ltcl_probe IMPLEMENTATION.

  METHOD first_test.
    cl_abap_unit_assert=>assert_equals( act = zcl_outline_parity_fix=>twice( 2 ) exp = 4 ).
  ENDMETHOD.


  METHOD second_test.
    DATA lo_cut TYPE REF TO zcl_outline_parity_fix.
    CREATE OBJECT lo_cut.
    cl_abap_unit_assert=>assert_equals( act = lo_cut->greet( \`x\` ) exp = \`Hello x\` ).
  ENDMETHOD.
ENDCLASS.
`;
export const files = {
  "zcl_outline_parity_fix.clas.abap": main,
  "zcl_outline_parity_fix.clas.locals_imp.abap": implementations,
  "zcl_outline_parity_fix.clas.testclasses.abap": testclasses,
};
