CLASS zcl_sample_constants DEFINITION PUBLIC INHERITING FROM zcl_sample_base.
  PUBLIC SECTION.
    INTERFACES zif_sample_shape.
    TYPES ty_code TYPE c LENGTH 8.
    CONSTANTS c_char TYPE c LENGTH 3 VALUE 'xyz'.
    CONSTANTS c_count TYPE i VALUE 42.
    CONSTANTS c_name TYPE string VALUE `sample`.
    CONSTANTS c_price TYPE p LENGTH 8 DECIMALS 2 VALUE '12.34'.
    CONSTANTS c_alias TYPE i VALUE c_count.
    CONSTANTS c_float TYPE f VALUE '1.0'.
    DATA mv_code TYPE ty_code.
    METHODS run
      IMPORTING iv_label TYPE ty_code DEFAULT 'A'
                iv_limit TYPE i DEFAULT c_count
                iv_item TYPE zfx_missing OPTIONAL
      EXPORTING ev_count TYPE i
      CHANGING cv_code TYPE ty_code
      RETURNING VALUE(rv_text) TYPE string.
    METHODS make IMPORTING iv_flag TYPE abap_bool DEFAULT abap_true iv_ratio TYPE f DEFAULT '1.5'.
  PROTECTED SECTION.
    METHODS hidden.
ENDCLASS.
CLASS zcl_sample_constants IMPLEMENTATION.
  METHOD run.
  ENDMETHOD.
  METHOD make.
  ENDMETHOD.
  METHOD hidden.
  ENDMETHOD.
  METHOD zif_sample_shape~area.
  ENDMETHOD.
ENDCLASS.
