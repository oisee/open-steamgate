CLASS zcx_stg_error DEFINITION PUBLIC INHERITING FROM cx_static_check CREATE PUBLIC.
* Carries an HTTP status and an OData error code through the dispatcher.
  PUBLIC SECTION.
    DATA status  TYPE i READ-ONLY.
    DATA code    TYPE string READ-ONLY.
    DATA message TYPE string READ-ONLY.

    METHODS constructor
      IMPORTING
        status   TYPE i
        code     TYPE string
        message  TYPE string
        previous LIKE previous OPTIONAL.
ENDCLASS.

CLASS zcx_stg_error IMPLEMENTATION.

  METHOD constructor.
    super->constructor( previous = previous ).
    me->status  = status.
    me->code    = code.
    me->message = message.
  ENDMETHOD.

ENDCLASS.
