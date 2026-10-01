CLASS zcl_osd_batch_runner_test DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS invalid_with
      RETURNING VALUE(rv_caught) TYPE abap_bool.
    CLASS-METHODS empty_range_with.
    CLASS-METHODS scalar_empty_with.
ENDCLASS.

CLASS zcl_osd_batch_runner_test IMPLEMENTATION.
  METHOD invalid_with.
    TRY.
        SUBMIT zosd_sub_sem WITH p_num = 'abc' AND RETURN.
      CATCH cx_root.
        rv_caught = abap_true.
    ENDTRY.
  ENDMETHOD.
  METHOD empty_range_with.
    TYPES ty_text TYPE c LENGTH 8.
    DATA lt_empty TYPE RANGE OF ty_text.
    SUBMIT zosd_sub_sem WITH s_text IN lt_empty AND RETURN.
  ENDMETHOD.
  METHOD scalar_empty_with.
    SUBMIT zosd_sub_sem WITH s_text = '' AND RETURN.
  ENDMETHOD.
ENDCLASS.
