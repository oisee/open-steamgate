* A constant of a superclass named through the subclass (ultra/zvdb: the
* generated DPCs raise /iwbep/cx_mgw_not_impl_exc with textid =
* /iwbep/cx_mgw_not_impl_exc=>method_not_implemented, declared by its
* superclass). Run on A4H 2026-09-24 in $ZOSG_TMP_0300 as written here.
CLASS zcl_gogen_t_inhconst DEFINITION PUBLIC INHERITING FROM zcl_gogen_t_icsup FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_inhconst IMPLEMENTATION.
  METHOD run.
    DATA ls LIKE zcl_gogen_t_inhconst=>c_key.
    ls = zcl_gogen_t_inhconst=>c_key.
    rv = |{ zcl_gogen_t_inhconst=>c_k }/{ ls-msgid }/{ ls-msgno }/{ zcl_gogen_t_icsup=>c_k }|.
  ENDMETHOD.
ENDCLASS.
