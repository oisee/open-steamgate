CLASS zcx_osd_tpl DEFINITION PUBLIC INHERITING FROM cx_static_check CREATE PUBLIC.
* A template that does not parse or render: the message names template and line.
  PUBLIC SECTION.
    DATA text TYPE string READ-ONLY.

    METHODS constructor
      IMPORTING
        text     TYPE string
        previous LIKE previous OPTIONAL.

    METHODS get_text REDEFINITION.
ENDCLASS.

CLASS zcx_osd_tpl IMPLEMENTATION.

  METHOD constructor.
    super->constructor( previous = previous ).
    me->text = text.
  ENDMETHOD.

  METHOD get_text.
    result = text.
  ENDMETHOD.

ENDCLASS.
