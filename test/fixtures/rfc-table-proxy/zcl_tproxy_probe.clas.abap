CLASS zcl_tproxy_probe DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_a,
             mandt TYPE c LENGTH 3,
             id    TYPE c LENGTH 4,
             txt   TYPE c LENGTH 20,
             amt   TYPE p LENGTH 8 DECIMALS 2,
           END OF ty_a.
    TYPES ty_a_tab TYPE STANDARD TABLE OF ty_a WITH DEFAULT KEY.
    CLASS-METHODS read_a RETURNING VALUE(rv_text) TYPE string.
    CLASS-METHODS read_c RETURNING VALUE(rv_text) TYPE string.
    CLASS-METHODS read_join RETURNING VALUE(rv_text) TYPE string.
    CLASS-METHODS read_w RETURNING VALUE(rv_text) TYPE string.
    CLASS-METHODS write_a IMPORTING iv_id TYPE c.
    CLASS-METHODS client RETURNING VALUE(rv_text) TYPE string.
ENDCLASS.

CLASS zcl_tproxy_probe IMPLEMENTATION.
  METHOD read_a.
    DATA lt_a TYPE ty_a_tab.
    DATA ls_a TYPE ty_a.
    SELECT * FROM ztproxy_a INTO CORRESPONDING FIELDS OF TABLE lt_a.
    LOOP AT lt_a INTO ls_a.
      rv_text = |{ rv_text }{ ls_a-mandt }/{ ls_a-id }/{ ls_a-txt }/{ ls_a-amt };|.
    ENDLOOP.
  ENDMETHOD.

  METHOD read_c.
    DATA lt_a TYPE ty_a_tab.
    DATA ls_a TYPE ty_a.
    SELECT * FROM ztproxy_c INTO CORRESPONDING FIELDS OF TABLE lt_a.
    LOOP AT lt_a INTO ls_a.
      rv_text = |{ rv_text }{ ls_a-id };|.
    ENDLOOP.
    rv_text = |{ lines( lt_a ) }:{ rv_text }|.
  ENDMETHOD.

  METHOD read_w.
    DATA lt_w TYPE STANDARD TABLE OF ztproxy_w WITH DEFAULT KEY.
    SELECT * FROM ztproxy_w INTO TABLE lt_w.
    rv_text = |{ lines( lt_w ) }|.
  ENDMETHOD.

  METHOD read_join.
    TYPES: BEGIN OF ty_j,
             id   TYPE c LENGTH 4,
             note TYPE c LENGTH 10,
           END OF ty_j.
    DATA lt_j TYPE STANDARD TABLE OF ty_j WITH DEFAULT KEY.
    DATA ls_j TYPE ty_j.
    SELECT a~id AS id, b~note AS note FROM ztproxy_a AS a INNER JOIN ztproxy_b AS b ON a~id = b~id
      INTO CORRESPONDING FIELDS OF TABLE @lt_j.
    LOOP AT lt_j INTO ls_j.
      rv_text = |{ rv_text }{ ls_j-id }/{ ls_j-note };|.
    ENDLOOP.
  ENDMETHOD.

  METHOD write_a.
    DATA ls_a TYPE ty_a.
    ls_a-mandt = '123'.
    ls_a-id = iv_id.
    ls_a-txt = 'local'.
    INSERT ztproxy_a FROM ls_a.
  ENDMETHOD.

  METHOD client.
    rv_text = sy-mandt.
  ENDMETHOD.
ENDCLASS.
