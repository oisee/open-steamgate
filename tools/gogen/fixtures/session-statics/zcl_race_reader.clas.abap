CLASS zcl_race_reader DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS read RETURNING VALUE(result) TYPE i.
    CLASS-METHODS initial RETURNING VALUE(result) TYPE i.
    CLASS-METHODS owned RETURNING VALUE(result) TYPE i.
ENDCLASS.
CLASS zcl_race_reader IMPLEMENTATION.
  METHOD read.
    result = zcl_race_child=>total.
  ENDMETHOD.
  METHOD owned.
    result = zcl_race_base=>owned( ).
  ENDMETHOD.
  METHOD initial.
    IF zcl_race_base=>stamp = '00000000' AND zcl_race_base=>digits = '000' AND zcl_race_base=>raw = '0000'.
      result = 1.
    ENDIF.
  ENDMETHOD.
ENDCLASS.
