CLASS zcl_adt_store DEFINITION PUBLIC FINAL CREATE PUBLIC.
 PUBLIC SECTION.
 CLASS-METHODS run.
ENDCLASS.
CLASS zcl_adt_store IMPLEMENTATION.
 METHOD run.
 DATA json TYPE string.
 DATA state TYPE string.
 CALL FUNCTION 'ZOSD_STORE' DESTINATION 'STORE'
 EXPORTING iv_command = 'COMMANDS' iv_json = '{}'
 IMPORTING ev_json = json ev_state = state.
 cl_abap_unit_assert=>assert_not_initial( act = json ).
 ENDMETHOD.
ENDCLASS.
