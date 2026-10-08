CLASS zcl_gogen_t_msginitial DEFINITION PUBLIC FINAL CREATE PUBLIC.
 PUBLIC SECTION.
 CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.
CLASS zcl_gogen_t_msginitial IMPLEMENTATION.
 METHOD run.
 rv = |{ sy-msgno }/{ sy-msgid }/{ sy-msgty }/{ sy-msgv1 }/{ sy-msgv2 }/{ sy-msgv3 }/{ sy-msgv4 }|.
 ENDMETHOD.
ENDCLASS.
