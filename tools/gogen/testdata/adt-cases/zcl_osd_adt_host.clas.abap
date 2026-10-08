" Minimal copy of the production ONE_RUNTIME method for its host contract.
CLASS zcl_osd_adt_host DEFINITION PUBLIC FINAL CREATE PUBLIC.
 PUBLIC SECTION.
 CLASS-METHODS one_runtime RETURNING VALUE(rv_on) TYPE abap_bool.
ENDCLASS.
CLASS zcl_osd_adt_host IMPLEMENTATION.
 METHOD one_runtime.
 WRITE '@KERNEL rv_on.set(abap.context.RFCDestinations.STORE?.localSystem ? "X" : "");'.
 ENDMETHOD.
ENDCLASS.
