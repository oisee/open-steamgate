* APPEND of a row that repeats a unique sorted secondary key's value. A4H
* 2026-09-24 ($ZOSG_TMP_0422) raises the catchable CX_SY_ITAB_DUPLICATE_KEY
* ("A row was to be added that would have produced a duplicate of the key
* K_U."), so this method answers "caught" there; the transpiler appends the
* row (ANORMALIES secondary-key-unique-duplicate). Go and JS refuse.
CLASS zcl_gogen_t_seckeydup DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    TYPES: BEGIN OF ty_row,
             u TYPE string,
             n TYPE i,
           END OF ty_row.
    TYPES ty_tab TYPE STANDARD TABLE OF ty_row WITH DEFAULT KEY
      WITH UNIQUE SORTED KEY k_u COMPONENTS u.
ENDCLASS.

CLASS zcl_gogen_t_seckeydup IMPLEMENTATION.
  METHOD run.
    DATA lt TYPE ty_tab.
    DATA ls TYPE ty_row.
    ls-u = 'u1'. ls-n = 1. APPEND ls TO lt.
    ls-n = 2.
    TRY.
        APPEND ls TO lt.
        rv = |appended:{ lines( lt ) }|.
      CATCH cx_sy_itab_duplicate_key.
        rv = 'caught'.
    ENDTRY.
  ENDMETHOD.
ENDCLASS.
