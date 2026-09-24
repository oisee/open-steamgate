* An aggregate without AS, INTO CORRESPONDING FIELDS OF TABLE: which
* component it would go to was not measured on A4H, so it is refused
* (NOT_COMPILED) rather than dropped; with AS it compiles (ZCL_GOGEN_T_GRPBY).
CLASS zcl_gogen_t_grpcor DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_grpcor IMPLEMENTATION.
  METHOD run.
    TYPES: BEGIN OF ty, val TYPE zgogen_t_dbw-val, id TYPE zgogen_t_dbw-id, END OF ty.
    DATA lt TYPE STANDARD TABLE OF ty WITH DEFAULT KEY.
    SELECT val MAX( id ) FROM zgogen_t_dbw INTO CORRESPONDING FIELDS OF TABLE lt GROUP BY val.
    rv = |{ lines( lt ) }|.
  ENDMETHOD.
ENDCLASS.
