* ultra/httpc: sy-subrc written by the ABAP (open-abap-core's cl_http_client
* sets it after SEND, RECEIVE and CREATE_BY_URL) and concat_lines_of( ) over
* a table of strings (cl_http_utility=>fields_to_string)
CLASS zcl_gogen_t_subrcw DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run
      RETURNING
        VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_subrcw IMPLEMENTATION.

  METHOD run.
    DATA lt TYPE STANDARD TABLE OF string WITH DEFAULT KEY.
    sy-subrc = 7.
    rv = |subrc:{ sy-subrc }|.
    sy-subrc = 0.
    rv = |{ rv },{ sy-subrc }|.
    rv = |{ rv } empty:[{ concat_lines_of( table = lt sep = '&' ) }]|.
    APPEND `a` TO lt.
    APPEND `` TO lt.
    APPEND `b c` TO lt.
    rv = |{ rv } cat:[{ concat_lines_of( table = lt sep = '&' ) }][{ concat_lines_of( lt ) }][{ concat_lines_of( table = lt sep = `, ` ) }]|.
  ENDMETHOD.

ENDCLASS.
