REPORT zbuffer.
CLASS lcl_parameters DEFINITION.
  PUBLIC SECTION.
    CLASS-METHODS by_value IMPORTING VALUE(bytes) TYPE xstring RETURNING VALUE(result) TYPE xstring.
    CLASS-METHODS by_reference CHANGING bytes TYPE xstring.
ENDCLASS.
CLASS lcl_parameters IMPLEMENTATION.
  METHOD by_value.
    REPLACE SECTION OFFSET 0 LENGTH 1 OF bytes WITH '43' IN BYTE MODE.
    result = bytes.
  ENDMETHOD.
  METHOD by_reference.
    REPLACE SECTION OFFSET 0 LENGTH 1 OF bytes WITH '44' IN BYTE MODE.
  ENDMETHOD.
ENDCLASS.
DATA bytes TYPE xstring.
DATA copy TYPE xstring.
DATA returned TYPE xstring.
DATA fixed TYPE x LENGTH 2.
DATA text TYPE string.
DATA found TYPE i.
DATA zeros TYPE x LENGTH 65536.
DATA rows TYPE STANDARD TABLE OF xstring WITH DEFAULT KEY.
bytes = zeros.
REPLACE SECTION OFFSET 0 LENGTH 1 OF bytes WITH '41' IN BYTE MODE.
copy = bytes.
returned = lcl_parameters=>by_value( bytes ).
WRITE bytes(2). WRITE copy(2). WRITE returned(2).
lcl_parameters=>by_reference( CHANGING bytes = bytes ).
WRITE bytes(2).
APPEND bytes TO rows.
REPLACE SECTION OFFSET 0 LENGTH 1 OF bytes WITH '42' IN BYTE MODE.
APPEND bytes TO rows.
MODIFY rows FROM returned INDEX 1.
SORT rows.
READ TABLE rows INTO copy INDEX 1.
WRITE copy(2).
REPLACE SECTION OFFSET 0 LENGTH 1 OF copy WITH '45' IN BYTE MODE.
READ TABLE rows INTO copy INDEX 1.
WRITE copy(2).
CONCATENATE bytes returned INTO copy IN BYTE MODE.
WRITE copy(2). WRITE xstrlen( copy ).
FIND '42' IN bytes IN BYTE MODE MATCH OFFSET found.
WRITE sy-subrc. WRITE found.
REPLACE '42' IN bytes WITH '46' IN BYTE MODE.
WRITE bytes(2).
text = bytes.
returned = text.
fixed = returned.
returned = fixed.
WRITE returned.
returned = 'ABCD'.
WRITE returned+1(1).
