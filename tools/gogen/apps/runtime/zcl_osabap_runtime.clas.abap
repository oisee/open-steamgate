CLASS zcl_osabap_runtime DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS getenv
      IMPORTING name TYPE string
      RETURNING VALUE(result) TYPE string.
ENDCLASS.

CLASS zcl_osabap_runtime IMPLEMENTATION.
  METHOD getenv.
* Replaced by the native command host. The inert body keeps this source valid
* in hosts which do not expose the process environment.
    CLEAR result.
  ENDMETHOD.
ENDCLASS.
