* The EML statements are written as the ZCL_OSD_RAP_EML calls they lower
* to, each with its statement in a comment above it; %is_draft is a
* component of the rows like a key. The rows each test makes are deleted
* again in teardown, so the seeded ones stay as they are.
CLASS ltcl_supplement DEFINITION FOR TESTING DURATION SHORT RISK LEVEL DANGEROUS FINAL.
  PRIVATE SECTION.
    CONSTANTS co_bdef TYPE string VALUE '/DMO/I_SUPPLEMENT'.
    TYPES tt_create   TYPE TABLE FOR CREATE /dmo/i_supplement.
    TYPES tt_update   TYPE TABLE FOR UPDATE /dmo/i_supplement.
    TYPES tt_activate TYPE TABLE FOR ACTION IMPORT /dmo/i_supplement~activate.
    TYPES tt_active   TYPE TABLE FOR ACTION RESULT /dmo/i_supplement~activate.
    TYPES ty_mapped   TYPE RESPONSE FOR MAPPED EARLY /dmo/i_supplement.
    TYPES ty_failed   TYPE RESPONSE FOR FAILED EARLY /dmo/i_supplement.
    TYPES ty_reported TYPE RESPONSE FOR REPORTED EARLY /dmo/i_supplement.
    DATA ms_failed   TYPE ty_failed.
    DATA ms_reported TYPE ty_reported.
    DATA mt_made     TYPE STANDARD TABLE OF /dmo/supplement_id WITH DEFAULT KEY.
    METHODS setup.
    METHODS teardown.
    METHODS commit
      RETURNING
        VALUE(rv_saved) TYPE abap_bool.
    METHODS new_draft
      IMPORTING
        iv_price     TYPE /dmo/supplement_price
      RETURNING
        VALUE(rv_id) TYPE /dmo/supplement_id.
    METHODS run
      IMPORTING
        iv_action      TYPE csequence
        iv_id          TYPE /dmo/supplement_id
        iv_draft       TYPE abap_bool
      RETURNING
        VALUE(rv_rows) TYPE i.
    METHODS numbers_by_category FOR TESTING RAISING cx_static_check.
    METHODS activates FOR TESTING RAISING cx_static_check.
    METHODS activation_validates FOR TESTING RAISING cx_static_check.
    METHODS edits_and_discards FOR TESTING RAISING cx_static_check.
ENDCLASS.

CLASS ltcl_supplement IMPLEMENTATION.

  METHOD setup.
    zcl_osd_rap_eml=>reset( ).
    CLEAR: ms_failed, ms_reported, mt_made.
  ENDMETHOD.

  METHOD teardown.
    DATA lv_id TYPE /dmo/supplement_id.
    zcl_osd_rap_eml=>rollback( ).
    zcl_osd_rap_eml=>reset( ).
    LOOP AT mt_made INTO lv_id.
      DELETE FROM /dmo/supplement WHERE supplement_id = @lv_id.
      DELETE FROM /dmo/suppl_text WHERE supplement_id = @lv_id.
      DELETE FROM /dmo/suppl_d WHERE supplementid = @lv_id.
      DELETE FROM /dmo/suppl_txt_d WHERE supplementid = @lv_id.
    ENDLOOP.
    COMMIT WORK.
  ENDMETHOD.

  METHOD commit.
* COMMIT ENTITIES
    zcl_osd_rap_eml=>commit( EXPORTING iv_bdef = co_bdef
                             IMPORTING ev_saved = rv_saved
                             CHANGING cs_failed = ms_failed cs_reported = ms_reported ).
  ENDMETHOD.

  METHOD new_draft.
* MODIFY ENTITIES OF /dmo/i_supplement ENTITY supplement
*   CREATE FIELDS ( supplementcategory price currencycode )
*   WITH VALUE #( ( %cid = 'S1' %is_draft = if_abap_behv=>mk-on ... ) )
    DATA lt_create TYPE tt_create.
    DATA ls_create LIKE LINE OF lt_create.
    DATA ls_mapped TYPE ty_mapped.
    DATA ls_line   LIKE LINE OF ls_mapped-supplement.

    ls_create-%cid = 'S1'.
    ls_create-%is_draft = if_abap_behv=>mk-on.
    ls_create-supplementcategory = 'ML'.
    ls_create-price = iv_price.
    ls_create-currencycode = 'EUR'.
    APPEND ls_create TO lt_create.
    zcl_osd_rap_eml=>modify( EXPORTING iv_bdef = co_bdef iv_entity = 'supplement' iv_operation = 'CREATE'
                                       it_rows = lt_create iv_fields = 'supplementcategory, price, currencycode'
                             CHANGING cs_mapped = ls_mapped cs_failed = ms_failed cs_reported = ms_reported ).
    cl_abap_unit_assert=>assert_initial( act = ms_failed msg = 'the create is accepted' ).
    READ TABLE ls_mapped-supplement INDEX 1 INTO ls_line.
    rv_id = ls_line-supplementid.
    APPEND rv_id TO mt_made.
    cl_abap_unit_assert=>assert_equals( act = ls_line-%is_draft exp = if_abap_behv=>mk-on msg = 'MAPPED names the draft' ).
    cl_abap_unit_assert=>assert_true( act = commit( ) msg = 'the draft is saved' ).
  ENDMETHOD.

  METHOD run.
* MODIFY ENTITIES OF /dmo/i_supplement ENTITY supplement EXECUTE <action>
*   FROM VALUE #( ( %tky-supplementid = iv_id %tky-%is_draft = ... ) ) RESULT ...
    DATA lt_import TYPE tt_activate.
    DATA ls_import LIKE LINE OF lt_import.
    DATA lt_result TYPE tt_active.

    ls_import-supplementid = iv_id.
    IF iv_draft = abap_true.
      ls_import-%is_draft = if_abap_behv=>mk-on.
    ENDIF.
    APPEND ls_import TO lt_import.
    zcl_osd_rap_eml=>execute( EXPORTING iv_bdef = co_bdef iv_entity = 'supplement' iv_action = iv_action it_rows = lt_import
                              CHANGING ct_result = lt_result cs_failed = ms_failed cs_reported = ms_reported ).
    rv_rows = lines( lt_result ).
  ENDMETHOD.

  METHOD numbers_by_category.
* the pool's early numbering: the category, a dash and the next number of
* the category, counted over the active and the draft supplements
    DATA lv_first  TYPE /dmo/supplement_id.
    DATA lv_second TYPE /dmo/supplement_id.

    lv_first = new_draft( '9.50' ).
    cl_abap_unit_assert=>assert_char_cp( act = lv_first exp = 'ML-++++' ).
    lv_second = new_draft( '9.50' ).
    cl_abap_unit_assert=>assert_equals( act = CONV i( substring_after( val = lv_second sub = '-' ) )
                                        exp = CONV i( substring_after( val = lv_first sub = '-' ) ) + 1
                                        msg = 'a draft counts for the next number' ).
    SELECT COUNT(*) FROM /dmo/suppl_d INTO @DATA(lv_drafts) WHERE supplementid = @lv_first.
    cl_abap_unit_assert=>assert_equals( act = lv_drafts exp = 1 ).
    SELECT COUNT(*) FROM /dmo/supplement INTO @DATA(lv_active) WHERE supplement_id = @lv_first.
    cl_abap_unit_assert=>assert_equals( act = lv_active exp = 0 msg = 'a draft is not active' ).
  ENDMETHOD.

  METHOD activates.
    DATA lv_id   TYPE /dmo/supplement_id.
    DATA ls_row  TYPE /dmo/supplement.

    lv_id = new_draft( '12.00' ).
    cl_abap_unit_assert=>assert_equals( act = run( iv_action = 'Prepare' iv_id = lv_id iv_draft = abap_true ) exp = 0 ).
    cl_abap_unit_assert=>assert_initial( act = ms_failed msg = 'Prepare: validatePrice passes' ).
    cl_abap_unit_assert=>assert_equals( act = run( iv_action = 'Activate' iv_id = lv_id iv_draft = abap_true ) exp = 1 ).
    cl_abap_unit_assert=>assert_true( act = commit( ) ).
    SELECT SINGLE * FROM /dmo/supplement INTO @ls_row WHERE supplement_id = @lv_id.
    cl_abap_unit_assert=>assert_subrc( act = sy-subrc msg = 'active after Activate' ).
    cl_abap_unit_assert=>assert_equals( act = ls_row-price exp = '12.00' ).
    cl_abap_unit_assert=>assert_equals( act = ls_row-supplement_category exp = 'ML' ).
    SELECT COUNT(*) FROM /dmo/suppl_d INTO @DATA(lv_drafts) WHERE supplementid = @lv_id.
    cl_abap_unit_assert=>assert_equals( act = lv_drafts exp = 0 msg = 'the draft is gone' ).
  ENDMETHOD.

  METHOD activation_validates.
* a draft is saved unvalidated; Activate runs validatePrice and refuses
    DATA lv_id TYPE /dmo/supplement_id.

    lv_id = new_draft( '0' ).
    run( iv_action = 'Activate' iv_id = lv_id iv_draft = abap_true ).
    commit( ).
    cl_abap_unit_assert=>assert_not_initial( act = ms_failed-supplement msg = 'price_required' ).
    zcl_osd_rap_eml=>rollback( ).
    SELECT COUNT(*) FROM /dmo/supplement INTO @DATA(lv_active) WHERE supplement_id = @lv_id.
    cl_abap_unit_assert=>assert_equals( act = lv_active exp = 0 ).
    SELECT COUNT(*) FROM /dmo/suppl_d INTO @DATA(lv_drafts) WHERE supplementid = @lv_id.
    cl_abap_unit_assert=>assert_equals( act = lv_drafts exp = 1 msg = 'the draft stays' ).
  ENDMETHOD.

  METHOD edits_and_discards.
    DATA lv_id     TYPE /dmo/supplement_id.
    DATA lt_update TYPE tt_update.
    DATA ls_update LIKE LINE OF lt_update.
    DATA ls_mapped TYPE ty_mapped.
    DATA ls_row    TYPE /dmo/supplement.

    lv_id = new_draft( '5.00' ).
    run( iv_action = 'Activate' iv_id = lv_id iv_draft = abap_true ).
    cl_abap_unit_assert=>assert_true( act = commit( ) ).
* Edit: a draft of the active supplement
    cl_abap_unit_assert=>assert_equals( act = run( iv_action = 'Edit' iv_id = lv_id iv_draft = abap_false ) exp = 1 ).
    cl_abap_unit_assert=>assert_true( act = commit( ) ).
* MODIFY ENTITIES ... UPDATE FIELDS ( price ) WITH VALUE #( ( %is_draft = on ... ) )
    ls_update-supplementid = lv_id.
    ls_update-%is_draft = if_abap_behv=>mk-on.
    ls_update-price = '6.00'.
    APPEND ls_update TO lt_update.
    zcl_osd_rap_eml=>modify( EXPORTING iv_bdef = co_bdef iv_entity = 'supplement' iv_operation = 'UPDATE'
                                       it_rows = lt_update iv_fields = 'price'
                             CHANGING cs_mapped = ls_mapped cs_failed = ms_failed cs_reported = ms_reported ).
    cl_abap_unit_assert=>assert_true( act = commit( ) ).
* Discard: the draft goes, the active supplement keeps its price
    run( iv_action = 'Discard' iv_id = lv_id iv_draft = abap_true ).
    cl_abap_unit_assert=>assert_true( act = commit( ) ).
    SELECT COUNT(*) FROM /dmo/suppl_d INTO @DATA(lv_drafts) WHERE supplementid = @lv_id.
    cl_abap_unit_assert=>assert_equals( act = lv_drafts exp = 0 ).
    SELECT SINGLE * FROM /dmo/supplement INTO @ls_row WHERE supplement_id = @lv_id.
    cl_abap_unit_assert=>assert_equals( act = ls_row-price exp = '5.00' ).
  ENDMETHOD.

ENDCLASS.

CLASS ltcl_agency DEFINITION FOR TESTING DURATION SHORT RISK LEVEL DANGEROUS FINAL.
  PRIVATE SECTION.
    CONSTANTS co_bdef TYPE string VALUE '/DMO/R_AGENCYTP'.
    TYPES tt_create   TYPE TABLE FOR CREATE /dmo/r_agencytp.
    TYPES tt_activate TYPE TABLE FOR ACTION IMPORT /dmo/r_agencytp~activate.
    TYPES tt_active   TYPE TABLE FOR ACTION RESULT /dmo/r_agencytp~activate.
    TYPES ty_mapped   TYPE RESPONSE FOR MAPPED EARLY /dmo/r_agencytp.
    TYPES ty_failed   TYPE RESPONSE FOR FAILED EARLY /dmo/r_agencytp.
    TYPES ty_reported TYPE RESPONSE FOR REPORTED EARLY /dmo/r_agencytp.
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
        iv_draft      TYPE abap_bool
        iv_email      TYPE csequence DEFAULT 'r10@agency.example'
      RETURNING
        VALUE(rs_key) TYPE ty_mapped.
    METHODS activate
      IMPORTING
        iv_id          TYPE /dmo/agency_id
      RETURNING
        VALUE(rv_rows) TYPE i.
    METHODS draft_has_a_preliminary_key FOR TESTING RAISING cx_static_check.
    METHODS activate_draws_the_final_key FOR TESTING RAISING cx_static_check.
    METHODS activation_validates FOR TESTING RAISING cx_static_check.
    METHODS active_create_numbers_late FOR TESTING RAISING cx_static_check.
ENDCLASS.

CLASS ltcl_agency IMPLEMENTATION.

  METHOD setup.
    zcl_osd_rap_eml=>reset( ).
    CLEAR: ms_failed, ms_reported.
    SELECT MAX( agency_id ) FROM /dmo/agency INTO @mv_max.
    SELECT SINGLE country FROM i_country INTO @mv_country.
  ENDMETHOD.

  METHOD teardown.
    zcl_osd_rap_eml=>rollback( ).
    zcl_osd_rap_eml=>reset( ).
    DELETE FROM /dmo/agency WHERE agency_id > @mv_max.
    DELETE FROM /dmo/agency_d WHERE name = 'R10 agency'.
    COMMIT WORK.
  ENDMETHOD.

  METHOD commit.
* COMMIT ENTITIES
    zcl_osd_rap_eml=>commit( EXPORTING iv_bdef = co_bdef
                             IMPORTING ev_saved = rv_saved
                             CHANGING cs_failed = ms_failed cs_reported = ms_reported ).
  ENDMETHOD.

  METHOD create.
* MODIFY ENTITIES OF /dmo/r_agencytp ENTITY /dmo/agency
*   CREATE FIELDS ( name countrycode emailaddress ) WITH VALUE #( ( %cid = 'A1' ... ) )
*   MAPPED DATA(mapped)
    DATA lt_create TYPE tt_create.
    DATA ls_create LIKE LINE OF lt_create.

    ls_create-%cid = 'A1'.
    IF iv_draft = abap_true.
      ls_create-%is_draft = if_abap_behv=>mk-on.
    ENDIF.
    ls_create-name = 'R10 agency'.
    ls_create-countrycode = mv_country.
    ls_create-emailaddress = iv_email.
    APPEND ls_create TO lt_create.
    zcl_osd_rap_eml=>modify( EXPORTING iv_bdef = co_bdef iv_entity = '/dmo/agency' iv_operation = 'CREATE'
                                       it_rows = lt_create iv_fields = 'name, countrycode, emailaddress'
                             CHANGING cs_mapped = rs_key cs_failed = ms_failed cs_reported = ms_reported ).
    cl_abap_unit_assert=>assert_initial( act = ms_failed msg = 'the create is accepted' ).
  ENDMETHOD.

  METHOD activate.
    DATA lt_import TYPE tt_activate.
    DATA ls_import LIKE LINE OF lt_import.
    DATA lt_result TYPE tt_active.

    ls_import-agencyid = iv_id.
    ls_import-%is_draft = if_abap_behv=>mk-on.
    APPEND ls_import TO lt_import.
    zcl_osd_rap_eml=>execute( EXPORTING iv_bdef = co_bdef iv_entity = '/dmo/agency' iv_action = 'Activate' it_rows = lt_import
                              CHANGING ct_result = lt_result cs_failed = ms_failed cs_reported = ms_reported ).
    rv_rows = lines( lt_result ).
  ENDMETHOD.

  METHOD draft_has_a_preliminary_key.
* a new draft has %pid and a preliminary key from the top of the key's
* range, which the final keys (counting up) do not reach
    DATA ls_mapped TYPE ty_mapped.
    DATA ls_line   LIKE LINE OF ls_mapped-/dmo/agency.

    ls_mapped = create( abap_true ).
    READ TABLE ls_mapped-/dmo/agency INDEX 1 INTO ls_line.
    cl_abap_unit_assert=>assert_not_initial( act = ls_line-%pid msg = '%pid' ).
    cl_abap_unit_assert=>assert_char_cp( act = ls_line-agencyid exp = '99999+' ).
    cl_abap_unit_assert=>assert_true( act = commit( ) ).
    SELECT COUNT(*) FROM /dmo/agency_d INTO @DATA(lv_drafts) WHERE agencyid = @ls_line-agencyid.
    cl_abap_unit_assert=>assert_equals( act = lv_drafts exp = 1 msg = 'the draft keeps its preliminary key' ).
    SELECT COUNT(*) FROM /dmo/agency INTO @DATA(lv_active) WHERE agency_id > @mv_max.
    cl_abap_unit_assert=>assert_equals( act = lv_active exp = 0 ).
  ENDMETHOD.

  METHOD activate_draws_the_final_key.
    DATA ls_mapped TYPE ty_mapped.
    DATA ls_line   LIKE LINE OF ls_mapped-/dmo/agency.
    DATA ls_row    TYPE /dmo/agency.
    DATA lv_next   TYPE /dmo/agency_id.

    ls_mapped = create( abap_true ).
    READ TABLE ls_mapped-/dmo/agency INDEX 1 INTO ls_line.
    cl_abap_unit_assert=>assert_true( act = commit( ) ).
    cl_abap_unit_assert=>assert_equals( act = activate( ls_line-agencyid ) exp = 1 ).
    cl_abap_unit_assert=>assert_true( act = commit( ) msg = 'validations pass, adjust_numbers draws' ).
    lv_next = mv_max + 1.
    SELECT SINGLE * FROM /dmo/agency INTO @ls_row WHERE agency_id = @lv_next.
    cl_abap_unit_assert=>assert_subrc( act = sy-subrc msg = 'the final key: the highest saved + 1' ).
    cl_abap_unit_assert=>assert_equals( act = ls_row-name exp = 'R10 agency' ).
    SELECT COUNT(*) FROM /dmo/agency INTO @DATA(lv_pre) WHERE agency_id = @ls_line-agencyid.
    cl_abap_unit_assert=>assert_equals( act = lv_pre exp = 0 msg = 'the preliminary key is not saved' ).
    SELECT COUNT(*) FROM /dmo/agency_d INTO @DATA(lv_drafts) WHERE agencyid = @ls_line-agencyid.
    cl_abap_unit_assert=>assert_equals( act = lv_drafts exp = 0 msg = 'the draft is gone' ).
  ENDMETHOD.

  METHOD activation_validates.
* the draft takes an e-mail address without a domain; Activate runs
* /DMO/validateEMailAddress and refuses it, nothing is numbered
    DATA ls_mapped TYPE ty_mapped.
    DATA ls_line   LIKE LINE OF ls_mapped-/dmo/agency.

    ls_mapped = create( iv_draft = abap_true iv_email = 'no-at-sign' ).
    READ TABLE ls_mapped-/dmo/agency INDEX 1 INTO ls_line.
    cl_abap_unit_assert=>assert_true( act = commit( ) msg = 'a draft is saved unvalidated' ).
    activate( ls_line-agencyid ).
    commit( ).
    cl_abap_unit_assert=>assert_not_initial( act = ms_failed-/dmo/agency msg = 'email_invalid_format' ).
    zcl_osd_rap_eml=>rollback( ).
    SELECT COUNT(*) FROM /dmo/agency INTO @DATA(lv_active) WHERE agency_id > @mv_max.
    cl_abap_unit_assert=>assert_equals( act = lv_active exp = 0 ).
    SELECT COUNT(*) FROM /dmo/agency_d INTO @DATA(lv_drafts) WHERE agencyid = @ls_line-agencyid.
    cl_abap_unit_assert=>assert_equals( act = lv_drafts exp = 1 msg = 'the draft stays' ).
  ENDMETHOD.

  METHOD active_create_numbers_late.
* without a draft: MAPPED answers %pid and the preliminary key; the save's
* adjust_numbers writes the final one
    DATA ls_mapped TYPE ty_mapped.
    DATA ls_line   LIKE LINE OF ls_mapped-/dmo/agency.
    DATA lv_next   TYPE /dmo/agency_id.

    ls_mapped = create( abap_false ).
    READ TABLE ls_mapped-/dmo/agency INDEX 1 INTO ls_line.
    cl_abap_unit_assert=>assert_not_initial( act = ls_line-%pid ).
    cl_abap_unit_assert=>assert_true( act = commit( ) ).
    lv_next = mv_max + 1.
    SELECT COUNT(*) FROM /dmo/agency INTO @DATA(lv_final) WHERE agency_id = @lv_next.
    cl_abap_unit_assert=>assert_equals( act = lv_final exp = 1 ).
    SELECT COUNT(*) FROM /dmo/agency INTO @DATA(lv_pre) WHERE agency_id = @ls_line-agencyid.
    cl_abap_unit_assert=>assert_equals( act = lv_pre exp = 0 ).
  ENDMETHOD.

ENDCLASS.
