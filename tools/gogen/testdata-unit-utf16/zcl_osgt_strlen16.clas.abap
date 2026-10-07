CLASS zcl_osgt_strlen16 DEFINITION PUBLIC FINAL CREATE PUBLIC.
PUBLIC SECTION.
CLASS-METHODS emoji RETURNING VALUE(rv) TYPE string.
ENDCLASS.
CLASS zcl_osgt_strlen16 IMPLEMENTATION.
METHOD emoji.
rv = cl_abap_codepage=>convert_from( source = CONV xstring( 'F09F988041' ) codepage = `UTF-8` ).
ENDMETHOD.
ENDCLASS.
