* The EML statements are written as the ZCL_OSD_RAP_EML calls they lower
* to, each with its statement in a comment above it. The rows each test
* makes are deleted again in teardown, so the seeded ones stay as they are.
CLASS ltcl_interface DEFINITION FOR TESTING DURATION SHORT RISK LEVEL DANGEROUS FINAL.
* /DMO/I_AgencyTP: `interface; use draft;` over /DMO/R_AgencyTP, every
* operation and draft action used
  PRIVATE SECTION.
    CONSTANTS co_bdef TYPE string VALUE '/DMO/I_AGENCYTP'.
    TYPES tt_create   TYPE TABLE FOR CREATE /dmo/i_agencytp.
    TYPES tt_update   TYPE TABLE FOR UPDATE /dmo/i_agencytp.
    TYPES tt_delete   TYPE TABLE FOR DELETE /dmo/i_agencytp.
    TYPES tt_keys     TYPE TABLE FOR READ IMPORT /dmo/i_agencytp.
    TYPES tt_rows     TYPE TABLE FOR READ RESULT /dmo/i_agencytp.
    TYPES tt_activate TYPE TABLE FOR ACTION IMPORT /dmo/i_agencytp~activate.
    TYPES tt_active   TYPE TABLE FOR ACTION RESULT /dmo/i_agencytp~activate.
    TYPES ty_mapped   TYPE RESPONSE FOR MAPPED EARLY /dmo/i_agencytp.
    TYPES ty_mapped_line TYPE STRUCTURE FOR MAPPED EARLY /dmo/i_agencytp.
    TYPES ty_failed   TYPE RESPONSE FOR FAILED EARLY /dmo/i_agencytp.
    TYPES ty_reported TYPE RESPONSE FOR REPORTED EARLY /dmo/i_agencytp.
    TYPES tt_base_keys TYPE TABLE FOR READ IMPORT /dmo/r_agencytp.
    TYPES tt_base_rows TYPE TABLE FOR READ RESULT /dmo/r_agencytp.
    TYPES ty_base_failed TYPE RESPONSE FOR FAILED EARLY /dmo/r_agencytp.
    DATA ms_failed   TYPE ty_failed.
    DATA ms_reported TYPE ty_reported.
    DATA mv_max      TYPE /dmo/agency_id.
    DATA mv_country  TYPE land1.
    METHODS setup.
    METHODS teardown.
    METHODS commit
      RETURNING
        VALUE(rv_saved) TYPE abap_bool.
    METHODS create
      IMPORTING
        iv_draft     TYPE abap_bool
        iv_name      TYPE csequence DEFAULT 'R11 agency'
      RETURNING
        VALUE(rs_line) TYPE ty_mapped_line.
    METHODS draft_activates_to_a_final_key FOR TESTING RAISING cx_static_check.
    METHODS update_and_delete FOR TESTING RAISING cx_static_check.
    METHODS shares_the_base_transaction FOR TESTING RAISING cx_static_check.
    METHODS refuses_what_it_cannot_route FOR TESTING RAISING cx_static_check.
ENDCLASS.

CLASS ltcl_interface IMPLEMENTATION.

  METHOD setup.
    zcl_osd_rap_eml=>reset( ).
    CLEAR: ms_failed, ms_reported.
    SELECT MAX( agency_id ) FROM /dmo/agency WHERE agency_id < '999000' INTO @mv_max.
    SELECT SINGLE country FROM i_country INTO @mv_country.
  ENDMETHOD.

  METHOD teardown.
    zcl_osd_rap_eml=>rollback( ).
    zcl_osd_rap_eml=>reset( ).
    DELETE FROM /dmo/agency WHERE name LIKE 'R11 %'.
    DELETE FROM /dmo/agency_d WHERE name LIKE 'R11 %'.
    COMMIT WORK.
  ENDMETHOD.

  METHOD commit.
* COMMIT ENTITIES RESPONSE OF /dmo/i_agencytp FAILED f REPORTED r
    DATA lx_error TYPE REF TO zcx_osd_rap.
    TRY.
        zcl_osd_rap_eml=>commit( EXPORTING iv_bdef = co_bdef
                                 IMPORTING ev_saved = rv_saved
                                 CHANGING cs_failed = ms_failed cs_reported = ms_reported ).
      CATCH zcx_osd_rap INTO lx_error.
        cl_abap_unit_assert=>fail( lx_error->get_text( ) ).
    ENDTRY.
  ENDMETHOD.

  METHOD create.
* MODIFY ENTITIES OF /dmo/i_agencytp ENTITY /dmo/agency
*   CREATE FIELDS ( name countrycode emailaddress ) WITH VALUE #( ( %cid = 'I1' ... ) )
*   MAPPED DATA(mapped)
    DATA lt_create TYPE tt_create.
    DATA ls_create LIKE LINE OF lt_create.
    DATA ls_mapped TYPE ty_mapped.

    ls_create-%cid = 'I1'.
    IF iv_draft = abap_true.
      ls_create-%is_draft = if_abap_behv=>mk-on.
    ENDIF.
    ls_create-name = iv_name.
    ls_create-countrycode = mv_country.
    ls_create-emailaddress = 'r11@agency.example'.
    APPEND ls_create TO lt_create.
    zcl_osd_rap_eml=>modify( EXPORTING iv_bdef = co_bdef iv_entity = '/dmo/agency' iv_operation = 'CREATE'
                                       it_rows = lt_create iv_fields = 'name, countrycode, emailaddress'
                             CHANGING cs_mapped = ls_mapped cs_failed = ms_failed cs_reported = ms_reported ).
    cl_abap_unit_assert=>assert_initial( act = ms_failed msg = 'the create is accepted' ).
    READ TABLE ls_mapped-/dmo/agency INDEX 1 INTO rs_line.
    cl_abap_unit_assert=>assert_subrc( act = sy-subrc msg = 'MAPPED of the interface' ).
  ENDMETHOD.

  METHOD draft_activates_to_a_final_key.
* a draft through the interface: %pid and a preliminary key in the
* interface's MAPPED; Activate (used by the interface) draws the final key
    DATA ls_line   TYPE ty_mapped_line.
    DATA lt_import TYPE tt_activate.
    DATA ls_import LIKE LINE OF lt_import.
    DATA lt_result TYPE tt_active.
    DATA lv_next   TYPE /dmo/agency_id.
    DATA lv_count  TYPE i.

    ls_line = create( abap_true ).
    cl_abap_unit_assert=>assert_not_initial( act = ls_line-%pid msg = '%pid through the interface' ).
    cl_abap_unit_assert=>assert_char_cp( act = ls_line-agencyid exp = '99999+' ).
    cl_abap_unit_assert=>assert_true( act = commit( ) ).
* MODIFY ENTITIES OF /dmo/i_agencytp ENTITY /dmo/agency
*   EXECUTE Activate FROM VALUE #( ( %key-agencyid = ... %is_draft = if_abap_behv=>mk-on ) )
    ls_import-agencyid = ls_line-agencyid.
    ls_import-%is_draft = if_abap_behv=>mk-on.
    APPEND ls_import TO lt_import.
    zcl_osd_rap_eml=>execute( EXPORTING iv_bdef = co_bdef iv_entity = '/dmo/agency' iv_action = 'Activate' it_rows = lt_import
                              CHANGING ct_result = lt_result cs_failed = ms_failed cs_reported = ms_reported ).
    cl_abap_unit_assert=>assert_equals( act = lines( lt_result ) exp = 1 ).
    cl_abap_unit_assert=>assert_true( act = commit( ) ).
    lv_next = mv_max + 1.
    SELECT COUNT(*) FROM /dmo/agency INTO @lv_count WHERE agency_id = @lv_next AND name = 'R11 agency'.
    cl_abap_unit_assert=>assert_equals( act = lv_count exp = 1 msg = 'saved under the final key' ).
    SELECT COUNT(*) FROM /dmo/agency_d INTO @lv_count WHERE agencyid = @ls_line-agencyid.
    cl_abap_unit_assert=>assert_equals( act = lv_count exp = 0 msg = 'the draft is gone' ).
  ENDMETHOD.

  METHOD update_and_delete.
* an active agency created, changed and deleted through the interface; READ
* ENTITIES OF /dmo/i_agencytp answers the interface's row type
    DATA lv_id     TYPE /dmo/agency_id.
    DATA lt_update TYPE tt_update.
    DATA ls_update LIKE LINE OF lt_update.
    DATA lt_delete TYPE tt_delete.
    DATA ls_delete LIKE LINE OF lt_delete.
    DATA lt_keys   TYPE tt_keys.
    DATA ls_key    LIKE LINE OF lt_keys.
    DATA lt_rows   TYPE tt_rows.
    DATA ls_row    LIKE LINE OF lt_rows.
    DATA ls_mapped TYPE ty_mapped.
    DATA lv_count  TYPE i.

    create( abap_false ).
    cl_abap_unit_assert=>assert_true( act = commit( ) ).
    lv_id = mv_max + 1.
* MODIFY ENTITIES OF /dmo/i_agencytp ENTITY /dmo/agency
*   UPDATE FIELDS ( city ) WITH VALUE #( ( agencyid = lv_id city = 'Interface City' ) )
    ls_update-agencyid = lv_id.
    ls_update-city = 'Interface City'.
    APPEND ls_update TO lt_update.
    zcl_osd_rap_eml=>modify( EXPORTING iv_bdef = co_bdef iv_entity = '/dmo/agency' iv_operation = 'UPDATE'
                                       it_rows = lt_update iv_fields = 'city'
                             CHANGING cs_mapped = ls_mapped cs_failed = ms_failed cs_reported = ms_reported ).
    cl_abap_unit_assert=>assert_initial( act = ms_failed ).
* READ ENTITIES OF /dmo/i_agencytp ENTITY /dmo/agency
*   FIELDS ( name city ) WITH VALUE #( ( agencyid = lv_id ) ) RESULT DATA(rows)
    ls_key-agencyid = lv_id.
    APPEND ls_key TO lt_keys.
    zcl_osd_rap_eml=>read( EXPORTING iv_bdef = co_bdef iv_entity = '/dmo/agency' it_keys = lt_keys iv_fields = 'name, city'
                           CHANGING ct_result = lt_rows cs_failed = ms_failed ).
    READ TABLE lt_rows INDEX 1 INTO ls_row.
    cl_abap_unit_assert=>assert_equals( act = ls_row-city exp = 'Interface City' msg = 'the buffer, read through the interface' ).
    cl_abap_unit_assert=>assert_equals( act = ls_row-name exp = 'R11 agency' ).
    cl_abap_unit_assert=>assert_initial( act = ls_row-emailaddress msg = 'a field not read is initial' ).
    cl_abap_unit_assert=>assert_true( act = commit( ) ).
    SELECT COUNT(*) FROM /dmo/agency INTO @lv_count WHERE agency_id = @lv_id AND city = 'Interface City'.
    cl_abap_unit_assert=>assert_equals( act = lv_count exp = 1 ).
* MODIFY ENTITIES OF /dmo/i_agencytp ENTITY /dmo/agency DELETE FROM VALUE #( ( agencyid = lv_id ) )
    ls_delete-agencyid = lv_id.
    APPEND ls_delete TO lt_delete.
    zcl_osd_rap_eml=>modify( EXPORTING iv_bdef = co_bdef iv_entity = '/dmo/agency' iv_operation = 'DELETE'
                                       it_rows = lt_delete
                             CHANGING cs_mapped = ls_mapped cs_failed = ms_failed cs_reported = ms_reported ).
    cl_abap_unit_assert=>assert_true( act = commit( ) ).
    SELECT COUNT(*) FROM /dmo/agency INTO @lv_count WHERE agency_id = @lv_id.
    cl_abap_unit_assert=>assert_equals( act = lv_count exp = 0 ).
  ENDMETHOD.

  METHOD shares_the_base_transaction.
* the interface and its base are one business object: a create through the
* interface is in the base's buffer before the save, and one COMMIT
* ENTITIES saves it
    DATA ls_line      TYPE ty_mapped_line.
    DATA lt_keys      TYPE tt_base_keys.
    DATA ls_key       LIKE LINE OF lt_keys.
    DATA lt_rows      TYPE tt_base_rows.
    DATA ls_row       LIKE LINE OF lt_rows.
    DATA ls_failed    TYPE ty_base_failed.
    DATA lt_sessions  TYPE string_table.

    ls_line = create( iv_draft = abap_false iv_name = 'R11 shared' ).
* READ ENTITIES OF /dmo/r_agencytp ENTITY /dmo/agency ALL FIELDS WITH ...
    ls_key-agencyid = ls_line-agencyid.
    ls_key-%pid = ls_line-%pid.
    APPEND ls_key TO lt_keys.
    zcl_osd_rap_eml=>read( EXPORTING iv_bdef = '/DMO/R_AGENCYTP' iv_entity = '/dmo/agency' it_keys = lt_keys
                           iv_fields = zcl_osd_rap_eml=>co_all_fields
                           CHANGING ct_result = lt_rows cs_failed = ls_failed ).
    READ TABLE lt_rows INDEX 1 INTO ls_row.
    cl_abap_unit_assert=>assert_equals( act = ls_row-name exp = 'R11 shared' msg = 'the base sees the interface''s create' ).
    lt_sessions = zcl_osd_rap_eml=>sessions( ).
    cl_abap_unit_assert=>assert_equals( act = lines( lt_sessions ) exp = 1 msg = 'one transaction, the base''s' ).
    cl_abap_unit_assert=>assert_true( act = commit( ) ).
    SELECT COUNT(*) FROM /dmo/agency INTO @DATA(lv_count) WHERE name = 'R11 shared'.
    cl_abap_unit_assert=>assert_equals( act = lv_count exp = 1 ).
  ENDMETHOD.

  METHOD refuses_what_it_cannot_route.
* EML runs a projection on its base by component name: an entity the BDEF
* does not have, a projection that renames elements and one with an augment
* are refused, not mapped wrongly
    DATA lt_keys   TYPE tt_keys.
    DATA ls_key    LIKE LINE OF lt_keys.
    DATA lt_rows   TYPE tt_rows.
    DATA lx_error  TYPE REF TO zcx_osd_rap.
    DATA lv_text   TYPE string.

    ls_key-agencyid = mv_max.
    APPEND ls_key TO lt_keys.
    TRY.
        zcl_osd_rap_eml=>read( EXPORTING iv_bdef = co_bdef iv_entity = 'Nothing' it_keys = lt_keys
                               CHANGING ct_result = lt_rows cs_failed = ms_failed ).
      CATCH zcx_osd_rap INTO lx_error.
        lv_text = lx_error->get_text( ).
    ENDTRY.
    cl_abap_unit_assert=>assert_char_cp( act = lv_text exp = '*no entity of /DMO/I_AGENCYTP*' ).
    CLEAR lv_text.
    TRY.
        zcl_osd_rap_eml=>read( EXPORTING iv_bdef = '/DMO/C_TRAVEL_PROCESSOR_M' iv_entity = 'TravelProcessor' it_keys = lt_keys
                               CHANGING ct_result = lt_rows cs_failed = ms_failed ).
      CATCH zcx_osd_rap INTO lx_error.
        lv_text = lx_error->get_text( ).
    ENDTRY.
    cl_abap_unit_assert=>assert_char_cp( act = lv_text exp = '*renames*' ).
    CLEAR lv_text.
    TRY.
        zcl_osd_rap_eml=>read( EXPORTING iv_bdef = '/DMO/C_SUPPLEMENT' iv_entity = 'Supplement' it_keys = lt_keys
                               CHANGING ct_result = lt_rows cs_failed = ms_failed ).
      CATCH zcx_osd_rap INTO lx_error.
        lv_text = lx_error->get_text( ).
    ENDTRY.
    cl_abap_unit_assert=>assert_char_cp( act = lv_text exp = '*augment*' ).
  ENDMETHOD.

ENDCLASS.
