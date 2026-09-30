* The versions of ZCL_OSD_VERSIONS itself, out of the checkout this runs in.
* A checkout is a git worktree (CI's too, even a shallow one: its one
* commit adds the file), so there is a history; the source at its newest
* version is this class as committed. A host without an object store (the
* Go unit binary, like a system without the STORE destination) raises
* "no object store here", which these tests accept as that answer.
CLASS ltcl_versions DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS own_history FOR TESTING RAISING cx_static_check.
    METHODS source_at_a_version FOR TESTING RAISING cx_static_check.
    METHODS a_revision_that_is_no_version FOR TESTING RAISING cx_static_check.
    METHODS an_unknown_object FOR TESTING RAISING cx_static_check.
ENDCLASS.

CLASS ltcl_versions IMPLEMENTATION.
  METHOD own_history.
    DATA lt_revision TYPE zcl_osd_versions=>tt_revision.
    DATA ls_revision TYPE zosd_revision_s.
    DATA lv_file TYPE string.
    DATA lv_none TYPE string.
    DATA lx_error TYPE REF TO zcx_osd_versions.
    TRY.
        zcl_osd_versions=>history( EXPORTING iv_type = `CLAS` iv_name = `ZCL_OSD_VERSIONS`
                                   IMPORTING et_revision = lt_revision ev_file = lv_file ev_no_history = lv_none ).
      CATCH zcx_osd_versions INTO lx_error.
        cl_abap_unit_assert=>assert_char_cp( act = lx_error->reason exp = 'no object store here*' ).
        RETURN.
    ENDTRY.
    cl_abap_unit_assert=>assert_char_cp( act = lv_file exp = '*zcl_osd_versions.clas.abap' ).
    IF lv_none IS NOT INITIAL.
      " a checkout that is no worktree answers with its reason, never an empty list alone
      cl_abap_unit_assert=>assert_char_cp( act = lv_none exp = 'no history: *' ).
      RETURN.
    ENDIF.
    cl_abap_unit_assert=>assert_true( boolc( lines( lt_revision ) >= 1 ) ).
    READ TABLE lt_revision INTO ls_revision INDEX 1.
    cl_abap_unit_assert=>assert_equals( act = strlen( ls_revision-revision ) exp = 40 ).
    cl_abap_unit_assert=>assert_equals( act = ls_revision-short exp = ls_revision-revision(12) ).
    cl_abap_unit_assert=>assert_char_np( act = ls_revision-author exp = '*@*' ).
    cl_abap_unit_assert=>assert_differs( act = ls_revision-date exp = '00000000' ).
  ENDMETHOD.

  METHOD source_at_a_version.
    DATA lt_revision TYPE zcl_osd_versions=>tt_revision.
    DATA ls_revision TYPE zosd_revision_s.
    DATA lv_none TYPE string.
    DATA lv_source TYPE string.
    DATA lv_revision TYPE string.
    DATA lx_error TYPE REF TO zcx_osd_versions.
    TRY.
        zcl_osd_versions=>history( EXPORTING iv_type = `CLAS` iv_name = `ZCL_OSD_VERSIONS`
                                   IMPORTING et_revision = lt_revision ev_no_history = lv_none ).
      CATCH zcx_osd_versions INTO lx_error.
        cl_abap_unit_assert=>assert_char_cp( act = lx_error->reason exp = 'no object store here*' ).
        RETURN.
    ENDTRY.
    IF lv_none IS NOT INITIAL.
      RETURN.
    ENDIF.
    READ TABLE lt_revision INTO ls_revision INDEX 1.
    lv_revision = ls_revision-revision.
    lv_source = zcl_osd_versions=>source_at( iv_type = `CLAS` iv_name = `ZCL_OSD_VERSIONS` iv_revision = lv_revision ).
    cl_abap_unit_assert=>assert_char_cp( act = lv_source exp = '*CLASS zcl_osd_versions DEFINITION*' ).
  ENDMETHOD.

  METHOD a_revision_that_is_no_version.
    DATA lx_error TYPE REF TO zcx_osd_versions.
    TRY.
        zcl_osd_versions=>source_at( iv_type = `CLAS` iv_name = `ZCL_OSD_VERSIONS`
                                     iv_revision = `0000000000000000000000000000000000000000` ).
        cl_abap_unit_assert=>fail( 'a commit that did not change the file is no version of it' ).
      CATCH zcx_osd_versions INTO lx_error.
        cl_abap_unit_assert=>assert_differs( act = lx_error->reason exp = `` ).
    ENDTRY.
  ENDMETHOD.

  METHOD an_unknown_object.
    DATA lt_revision TYPE zcl_osd_versions=>tt_revision.
    TRY.
        zcl_osd_versions=>history( EXPORTING iv_type = `CLAS` iv_name = `ZCL_OSD_NO_SUCH_CLASS`
                                   IMPORTING et_revision = lt_revision ).
        cl_abap_unit_assert=>fail( 'an object the store does not hold has no versions to list' ).
      CATCH zcx_osd_versions.
    ENDTRY.
  ENDMETHOD.
ENDCLASS.
