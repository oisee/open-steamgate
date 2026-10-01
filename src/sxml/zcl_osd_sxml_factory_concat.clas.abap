"! The reference factory: drain the source into one xstring and hand it to
"! CL_SXML_STRING_READER. Every split gives the same bytes, so it passes the
"! split half of the contract by construction; it is the baseline and the
"! shape a streaming factory replaces.
CLASS zcl_osd_sxml_factory_concat DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_osd_sxml_factory.
    CLASS-METHODS drain
      IMPORTING io_source TYPE REF TO zif_osd_byte_source
      RETURNING VALUE(rv) TYPE xstring.
ENDCLASS.


CLASS zcl_osd_sxml_factory_concat IMPLEMENTATION.

  METHOD drain.
    DATA lv_chunk TYPE xstring.
    DO.
      lv_chunk = io_source->next( ).
      IF xstrlen( lv_chunk ) = 0.
        EXIT.
      ENDIF.
      CONCATENATE rv lv_chunk INTO rv IN BYTE MODE.
    ENDDO.
  ENDMETHOD.

  METHOD zif_osd_sxml_factory~create.
    ri = cl_sxml_string_reader=>create( drain( io_source ) ).
  ENDMETHOD.

ENDCLASS.
