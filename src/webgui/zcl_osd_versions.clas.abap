"! The versions of an object, read out of git through the host's object
"! store (ZOSD_STORE DESTINATION 'STORE', commands HISTORY and REVISION).
"! Versions are stored nowhere: a version is a commit that changed the
"! object's file, newest first, followed across renames; the author is a
"! SAP-style user name, the date and time are UTC. Outside git -- a pack
"! fetched without its .git, the browser preview -- there is no history,
"! and EV_NO_HISTORY says why instead of an empty list that would read as
"! "never changed". On a system there is no STORE destination at all; the
"! call then raises ZCX_OSD_VERSIONS with the RFC message.
"!
"! A thin reader on purpose (docs/backlog/adt.md, "Versions of an object,
"! read out of git"): the VRSD-shaped substitutes for SVRS_* come later on
"! the same host service.
CLASS zcl_osd_versions DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES tt_revision TYPE STANDARD TABLE OF zosd_revision_s WITH DEFAULT KEY.

    CLASS-METHODS history
      IMPORTING iv_type       TYPE string
                iv_name       TYPE string
                iv_limit      TYPE i DEFAULT 50
      EXPORTING et_revision   TYPE tt_revision
                ev_file       TYPE string
                ev_no_history TYPE string
      RAISING   zcx_osd_versions.

    "! The object's source at one version (a full commit SHA from HISTORY)
    CLASS-METHODS source_at
      IMPORTING iv_type          TYPE string
                iv_name          TYPE string
                iv_revision      TYPE string
      RETURNING VALUE(rv_source) TYPE string
      RAISING   zcx_osd_versions.
ENDCLASS.


CLASS zcl_osd_versions IMPLEMENTATION.

  METHOD history.
    DATA lv_limit TYPE string.
    DATA lv_note TYPE string.
    DATA lv_error TYPE string.
    DATA lv_msg TYPE c LENGTH 255.

    CLEAR: et_revision, ev_file, ev_no_history.
    lv_limit = iv_limit.
    CONDENSE lv_limit.
    CALL FUNCTION 'ZOSD_STORE' DESTINATION 'STORE'
      EXPORTING iv_command = `HISTORY`
                iv_type    = iv_type
                iv_name    = iv_name
                iv_limit   = lv_limit
      IMPORTING ev_file    = ev_file
                ev_note    = lv_note
                ev_error   = lv_error
      TABLES    et_revision = et_revision
      EXCEPTIONS
                system_failure        = 1 MESSAGE lv_msg
                communication_failure = 2 MESSAGE lv_msg
                OTHERS                = 3.
    IF sy-subrc <> 0.
      lv_error = |no object store here: { lv_msg }|.
    ENDIF.
    IF lv_error IS NOT INITIAL.
      RAISE EXCEPTION TYPE zcx_osd_versions EXPORTING iv_reason = lv_error.
    ENDIF.
    IF lv_note CP 'no history*'.
      ev_no_history = lv_note.
    ENDIF.
  ENDMETHOD.

  METHOD source_at.
    DATA lv_error TYPE string.
    DATA lv_msg TYPE c LENGTH 255.

    CALL FUNCTION 'ZOSD_STORE' DESTINATION 'STORE'
      EXPORTING iv_command  = `REVISION`
                iv_type     = iv_type
                iv_name     = iv_name
                iv_revision = iv_revision
      IMPORTING ev_source   = rv_source
                ev_error    = lv_error
      EXCEPTIONS
                system_failure        = 1 MESSAGE lv_msg
                communication_failure = 2 MESSAGE lv_msg
                OTHERS                = 3.
    IF sy-subrc <> 0.
      lv_error = |no object store here: { lv_msg }|.
    ENDIF.
    IF lv_error IS NOT INITIAL.
      RAISE EXCEPTION TYPE zcx_osd_versions EXPORTING iv_reason = lv_error.
    ENDIF.
  ENDMETHOD.

ENDCLASS.
