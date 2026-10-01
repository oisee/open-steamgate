CLASS zcl_gogen_t_defaults DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_gogen_t_defaults.
    ALIASES alias_value FOR zif_gogen_t_defaults~c_alias.
    CONSTANTS c_own TYPE i VALUE 7.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS own IMPORTING iv TYPE i DEFAULT c_own RETURNING VALUE(rv) TYPE i.
    CLASS-METHODS other IMPORTING iv TYPE i DEFAULT zcl_gogen_t_default_owner=>c_other RETURNING VALUE(rv) TYPE i.
    CLASS-METHODS from_interface IMPORTING iv TYPE i DEFAULT zif_gogen_t_defaults=>c_interface RETURNING VALUE(rv) TYPE i.
    CLASS-METHODS from_alias IMPORTING iv TYPE i DEFAULT alias_value RETURNING VALUE(rv) TYPE i.
ENDCLASS.
CLASS zcl_gogen_t_defaults IMPLEMENTATION.
  METHOD own.
    rv = iv.
  ENDMETHOD.
  METHOD other.
    rv = iv.
  ENDMETHOD.
  METHOD from_interface.
    rv = iv.
  ENDMETHOD.
  METHOD from_alias.
    rv = iv.
  ENDMETHOD.
  METHOD run.
    rv = |{ own( ) }/{ other( ) }/{ from_interface( ) }/{ from_alias( ) }|.
  ENDMETHOD.
ENDCLASS.
