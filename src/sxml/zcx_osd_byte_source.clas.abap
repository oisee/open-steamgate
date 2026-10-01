"! A byte source that cannot go on: it could not be opened, read or was
"! refused. Unchecked, because ZIF_OSD_BYTE_SOURCE~NEXT declares nothing;
"! a reader lets it pass as it is, so the cause is not hidden behind a
"! parse error at a premature end of the stream.
CLASS zcx_osd_byte_source DEFINITION PUBLIC INHERITING FROM cx_no_check CREATE PUBLIC.
  PUBLIC SECTION.
    DATA reason TYPE string READ-ONLY.
    METHODS constructor
      IMPORTING iv_reason TYPE string OPTIONAL
                previous  LIKE previous OPTIONAL.
    METHODS get_text REDEFINITION.
ENDCLASS.


CLASS zcx_osd_byte_source IMPLEMENTATION.

  METHOD constructor.
    super->constructor( previous = previous ).
    reason = iv_reason.
  ENDMETHOD.

  METHOD get_text.
    result = reason.
  ENDMETHOD.

ENDCLASS.
