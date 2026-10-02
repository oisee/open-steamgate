CLASS ltcl_host DEFINITION FINAL FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.
  PRIVATE SECTION.
    METHODS errors FOR TESTING.
    METHODS success FOR TESTING RAISING zcx_osd_adt.
    METHODS legacy_command FOR TESTING.
ENDCLASS.

CLASS ltcl_host IMPLEMENTATION.
  METHOD errors.
    DATA lt_codes TYPE string_table.
    DATA lv_code TYPE string.
    DATA lv_json TYPE string.
    DATA lv_status TYPE i.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    SPLIT `NOT_FOUND CONFLICT READ_ONLY NOT_SUPPORTED INVALID_NAME INTERNAL UNKNOWN` AT ` ` INTO TABLE lt_codes.
    LOOP AT lt_codes INTO lv_code.
      CASE lv_code.
        WHEN `NOT_FOUND`.
          lv_status = 404.
        WHEN `CONFLICT`.
          lv_status = 409.
        WHEN `READ_ONLY`.
          lv_status = 405.
        WHEN `NOT_SUPPORTED`.
          lv_status = 501.
        WHEN `INVALID_NAME`.
          lv_status = 400.
        WHEN OTHERS.
          lv_status = 500.
      ENDCASE.
      lv_json = `{"error":{"code":"` && lv_code && `","message":"raw <reason>"}}`.
      TRY.
          zcl_osd_adt_host=>check_error( iv_json = lv_json iv_error = `old screen message` ).
          cl_abap_unit_assert=>fail( `expected a refusal` ).
        CATCH zcx_osd_adt INTO lx_error.
          cl_abap_unit_assert=>assert_equals( act = lx_error->status exp = lv_status ).
          cl_abap_unit_assert=>assert_equals( act = lx_error->message_text exp = `raw <reason>` ).
          IF lv_status = 500.
            cl_abap_unit_assert=>assert_equals( act = lx_error->namespace exp = zcx_osd_adt=>c_namespace_osd ).
          ELSE.
            cl_abap_unit_assert=>assert_equals( act = lx_error->namespace exp = zcx_osd_adt=>c_namespace_adt ).
          ENDIF.
      ENDTRY.
    ENDLOOP.
  ENDMETHOD.

  METHOD success.
    zcl_osd_adt_host=>check_error( `{ "found": false }` ).
    zcl_osd_adt_host=>check_error( `` ).
*   Success is not parsed again, including raw non-JSON answers.
    zcl_osd_adt_host=>check_error( `raw body` ).
  ENDMETHOD.

  METHOD legacy_command.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    TRY.
        zcl_osd_adt_host=>check_error( iv_json = `` iv_error = `unknown store command PARSE` ).
        cl_abap_unit_assert=>fail( `expected 501` ).
      CATCH zcx_osd_adt INTO lx_error.
        cl_abap_unit_assert=>assert_equals( act = lx_error->status exp = 501 ).
        cl_abap_unit_assert=>assert_equals( act = lx_error->message_text exp = `unknown store command PARSE` ).
    ENDTRY.
  ENDMETHOD.
ENDCLASS.
