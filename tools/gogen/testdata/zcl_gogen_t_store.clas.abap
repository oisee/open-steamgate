* CALL FUNCTION 'ZOSD_STORE' DESTINATION 'STORE': the object store over the
* files of a tree (go/abap/store.go), here over testdata-store/tree, which
* semantics.mjs copies before each run because a WRITE lands in it. Not A4H
* values: A4H has no destination STORE. What this pins is parity with the
* Node host's destination (tools/osd-store-destination.mjs) over the same
* fixture, answer for answer (tools/gogen/storecmp.mjs --root on the copy),
* and the Go host's honest refusal of CHECK and ACTIVATE.
CLASS zcl_gogen_t_store DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_object,
             type       TYPE c LENGTH 4,
             name       TYPE c LENGTH 40,
             package    TYPE c LENGTH 30,
             file       TYPE string,
             writable   TYPE c LENGTH 1,
             version    TYPE c LENGTH 10,
             changed_at TYPE c LENGTH 20,
           END OF ty_object.
    TYPES tt_object TYPE STANDARD TABLE OF ty_object WITH DEFAULT KEY.
    TYPES: BEGIN OF ty_issue,
             obj_type TYPE c LENGTH 4,
             obj_name TYPE c LENGTH 40,
             line     TYPE i,
             col      TYPE i,
             rule     TYPE c LENGTH 40,
             message  TYPE string,
           END OF ty_issue.
    TYPES tt_issue TYPE STANDARD TABLE OF ty_issue WITH DEFAULT KEY.
    TYPES: BEGIN OF ty_type,
             type  TYPE c LENGTH 4,
             count TYPE i,
           END OF ty_type.
    TYPES tt_type TYPE STANDARD TABLE OF ty_type WITH DEFAULT KEY.
    TYPES: BEGIN OF ty_token,
             line TYPE i,
             col  TYPE i,
             len  TYPE i,
             kind TYPE c LENGTH 10,
           END OF ty_token.
    TYPES tt_token TYPE STANDARD TABLE OF ty_token WITH DEFAULT KEY.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    CLASS-METHODS call
      IMPORTING iv_command TYPE string
                iv_type    TYPE string OPTIONAL
                iv_name    TYPE string OPTIONAL
                iv_include TYPE string OPTIONAL
                iv_source  TYPE string OPTIONAL
                iv_filter  TYPE string OPTIONAL
      RETURNING VALUE(rv)  TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_store IMPLEMENTATION.
  METHOD call.
    DATA lv_source   TYPE string.
    DATA lv_file     TYPE string.
    DATA lv_package  TYPE string.
    DATA lv_version  TYPE string.
    DATA lv_writable TYPE string.
    DATA lv_active   TYPE string.
    DATA lv_count    TYPE string.
    DATA lv_error    TYPE string.
    DATA lt_object   TYPE tt_object.
    DATA ls_object   TYPE ty_object.
    DATA lt_issue    TYPE tt_issue.
    DATA ls_issue    TYPE ty_issue.
    DATA lt_type     TYPE tt_type.
    DATA ls_type     TYPE ty_type.
    DATA lt_token    TYPE tt_token.

    CALL FUNCTION 'ZOSD_STORE' DESTINATION 'STORE'
      EXPORTING iv_command  = iv_command
                iv_type     = iv_type
                iv_name     = iv_name
                iv_include  = iv_include
                iv_source   = iv_source
                iv_filter   = iv_filter
      IMPORTING ev_source   = lv_source
                ev_file     = lv_file
                ev_package  = lv_package
                ev_version  = lv_version
                ev_writable = lv_writable
                ev_active   = lv_active
                ev_count    = lv_count
                ev_error    = lv_error
      TABLES    et_object   = lt_object
                et_issue    = lt_issue
                et_type     = lt_type
                et_token    = lt_token.
    rv = |{ iv_command }|.
    IF lv_error IS NOT INITIAL.
      rv = |{ rv } err[{ lv_error }]|.
    ENDIF.
    IF lv_source IS NOT INITIAL.
      rv = |{ rv } src[{ strlen( lv_source ) }]|.
    ENDIF.
    IF lv_file IS NOT INITIAL OR lv_version IS NOT INITIAL.
      rv = |{ rv } { lv_file } { lv_package } { lv_version } w{ lv_writable }|.
    ENDIF.
    rv = |{ rv } n{ lv_count } a{ lv_active }|.
    LOOP AT lt_object INTO ls_object.
      rv = |{ rv } { ls_object-type }:{ ls_object-name }:{ ls_object-package }:{ ls_object-file }:{ ls_object-writable }:{ ls_object-version }|.
    ENDLOOP.
    LOOP AT lt_type INTO ls_type.
      rv = |{ rv } #{ ls_type-type }={ ls_type-count }|.
    ENDLOOP.
    LOOP AT lt_issue INTO ls_issue.
      rv = |{ rv } !{ ls_issue-obj_type }:{ ls_issue-obj_name }:{ ls_issue-line }:{ ls_issue-rule }|.
    ENDLOOP.
    rv = |{ rv } t{ lines( lt_token ) };|.
  ENDMETHOD.

  METHOD run.
    DATA lv_new TYPE string.
    rv = call( iv_command = `LIST` ).
    rv = rv && call( iv_command = `list` iv_filter = `st_` iv_type = `clas` ).
    rv = rv && call( iv_command = `READ` iv_type = `CLAS` iv_name = `zcl_st_a` ).
    rv = rv && call( iv_command = `READ` iv_type = `CLAS` iv_name = `ZCL_ST_A` iv_include = `implementations` ).
    rv = rv && call( iv_command = `READ` iv_type = `CLAS` iv_name = `ZCL_ST_A` iv_include = `testclasses` ).
    rv = rv && call( iv_command = `READ` iv_type = `CLAS` iv_name = `ZCL_ST_SKIP` ).
    lv_new = |* changed{ cl_abap_char_utilities=>cr_lf }REPORT zst_prog.{ cl_abap_char_utilities=>newline }|.
    rv = rv && call( iv_command = `WRITE` iv_type = `PROG` iv_name = `ZST_PROG` iv_source = lv_new ).
    rv = rv && call( iv_command = `READ` iv_type = `PROG` iv_name = `ZST_PROG` ).
    rv = rv && call( iv_command = `WRITE` iv_type = `CLAS` iv_name = `CL_ST_LIB` iv_source = `x` ).
    rv = rv && call( iv_command = `WRITE` iv_type = `CLAS` iv_name = `ZCL_ST_GEN` iv_source = `x` ).
    rv = rv && call( iv_command = `WRITE` iv_type = `PROG` iv_name = `ZST_NEW` iv_source = `REPORT zst_new.` ).
    rv = rv && call( iv_command = `CHECK` iv_type = `PROG` iv_name = `ZST_PROG` iv_source = lv_new ).
    rv = rv && call( iv_command = `ACTIVATE` iv_type = `PROG` iv_name = `ZST_PROG` ).
    rv = rv && call( iv_command = `TOKENS` iv_type = `PROG` iv_name = `ZST_PROG` ).
    rv = rv && call( iv_command = `NOPE` ).
  ENDMETHOD.
ENDCLASS.
