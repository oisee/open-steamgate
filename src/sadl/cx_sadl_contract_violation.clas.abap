CLASS cx_sadl_contract_violation DEFINITION PUBLIC INHERITING FROM cx_static_check CREATE PUBLIC.
* What a SADL exit raises when it cannot keep its side of the contract.
* Clean-room: the name and the static-check kind are the contract, the text is
* ours.
  PUBLIC SECTION.
    METHODS constructor
      IMPORTING
        textid   LIKE textid OPTIONAL
        previous LIKE previous OPTIONAL
        message  TYPE string OPTIONAL.

    DATA message TYPE string READ-ONLY.

    METHODS get_text REDEFINITION.
ENDCLASS.

CLASS cx_sadl_contract_violation IMPLEMENTATION.

  METHOD constructor.
    super->constructor( textid   = textid
                        previous = previous ).
    me->message = message.
  ENDMETHOD.

  METHOD get_text.
    result = message.
  ENDMETHOD.

ENDCLASS.
