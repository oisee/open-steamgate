CLASS zcl_gogen_t_rngimpl DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_gogen_t_rng.
ENDCLASS.

CLASS zcl_gogen_t_rngimpl IMPLEMENTATION.
  METHOD zif_gogen_t_rng~read.
    DATA lt_all TYPE zif_gogen_t_rng=>tt_keys.
    DATA lv_key TYPE zif_gogen_t_rng=>ty_key.
    DATA ls_range LIKE LINE OF it_range.
    APPEND 'A' TO lt_all.
    APPEND 'B' TO lt_all.
    APPEND 'C' TO lt_all.
    READ TABLE it_range INDEX 1 INTO ls_range.
    LOOP AT lt_all INTO lv_key.
      IF it_range IS INITIAL OR lv_key = ls_range-low.
        APPEND lv_key TO rt_keys.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.
ENDCLASS.
