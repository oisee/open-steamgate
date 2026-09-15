INTERFACE zif_ztest_greeter PUBLIC.

  CONSTANTS co_unknown TYPE string VALUE 'unknown'.

  METHODS greet
    IMPORTING
      iv_name        TYPE string
    RETURNING
      VALUE(rv_text) TYPE string.

ENDINTERFACE.
