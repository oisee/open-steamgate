CLASS zcx_osd_not_activated DEFINITION PUBLIC INHERITING FROM cx_no_check FINAL CREATE PUBLIC.
* Lazy activation (H5c round 3): a class compiles as a whole or not at all,
* so the island's closure had to cover every name a class MENTIONS even in
* methods no request will ever run. The iterator now replaces such a
* method's body with a raise of this class -- the service activates with
* what resolves, and the island grows only on a real miss: the text names
* what the method still waits for, which is the signal to run the iterator
* again. cx_no_check, so the stub carries no RAISING clause: the raise is
* legal in a body whose signature the dump wrote, not this tree's.
  PUBLIC SECTION.
    DATA missing TYPE string READ-ONLY.
    METHODS constructor
      IMPORTING
        textid   LIKE textid OPTIONAL
        previous LIKE previous OPTIONAL
        missing  TYPE string DEFAULT ''.
    METHODS if_message~get_text REDEFINITION.
ENDCLASS.

CLASS zcx_osd_not_activated IMPLEMENTATION.

  METHOD constructor.
    super->constructor( textid = textid previous = previous ).
    me->missing = missing.
  ENDMETHOD.

  METHOD if_message~get_text.
    result = |not activated here: needs { missing }|.
  ENDMETHOD.

ENDCLASS.
