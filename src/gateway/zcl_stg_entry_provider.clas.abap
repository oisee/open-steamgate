CLASS zcl_stg_entry_provider DEFINITION PUBLIC CREATE PUBLIC.
* The io_data_provider a DPC receives on create/update: the request body,
* already parsed, handed over as the entity structure the DPC expects.
* Property names are mapped to ABAP fields through the model; values are
* converted by EDM type (Int32 -> i, Boolean -> abap_bool, DateTime ->
* d or timestamp, the rest as character data).
  PUBLIC SECTION.
    INTERFACES /iwbep/if_mgw_entry_provider.

    METHODS constructor
      IMPORTING
        it_values TYPE tihttpnvp
        is_set    TYPE zcl_stg_model_info=>ty_entity_set.

    CLASS-METHODS convert_value
      IMPORTING
        iv_value    TYPE string
        iv_edm_type TYPE string
      CHANGING
        cv_target   TYPE any.
  PRIVATE SECTION.
    DATA mt_values TYPE tihttpnvp.
    DATA ms_set    TYPE zcl_stg_model_info=>ty_entity_set.
ENDCLASS.

CLASS zcl_stg_entry_provider IMPLEMENTATION.

  METHOD constructor.
    mt_values = it_values.
    ms_set    = is_set.
  ENDMETHOD.

  METHOD convert_value.
    DATA lv_kind TYPE c LENGTH 1.
    DATA lv_ms   TYPE string.
    DATA lv_days TYPE i.
    DATA lv_secs TYPE i.
    DATA lv_date TYPE d VALUE '19700101'.
    DATA lv_rest TYPE i.
    DATA lv_hh   TYPE i.
    DATA lv_mm   TYPE i.
    DATA lv_time TYPE t.

    DESCRIBE FIELD cv_target TYPE lv_kind.

    CASE iv_edm_type.
      WHEN 'Edm.Boolean'.
        IF iv_value = 'true' OR iv_value = 'X'.
          cv_target = abap_true.
        ELSE.
          cv_target = abap_false.
        ENDIF.
      WHEN 'Edm.DateTime'.
        IF iv_value IS INITIAL OR iv_value = 'null'.
          CLEAR cv_target.
          RETURN.
        ENDIF.
        FIND REGEX 'Date\((-?\d+)\)' IN iv_value SUBMATCHES lv_ms.
        IF sy-subrc = 0.
* /Date(ms)/ -> days since 1970 + seconds
          lv_days = lv_ms / 1000 / 86400.
          IF lv_ms < 0 OR lv_days * 86400 * 1000 > lv_ms.
            lv_days = lv_days - 1.
          ENDIF.
          lv_secs = lv_ms / 1000 - lv_days * 86400.
          lv_date = lv_date + lv_days.
          lv_hh = lv_secs DIV 3600.
          lv_rest = lv_secs MOD 3600.
          lv_mm = lv_rest DIV 60.
          lv_rest = lv_rest MOD 60.
          lv_time = |{ lv_hh WIDTH = 2 ALIGN = RIGHT PAD = '0' }{ lv_mm WIDTH = 2 ALIGN = RIGHT PAD = '0' }{ lv_rest WIDTH = 2 ALIGN = RIGHT PAD = '0' }|.
          IF lv_kind = 'D'.
            cv_target = lv_date.
          ELSE.
            cv_target = |{ lv_date }{ lv_time }|.
          ENDIF.
        ELSE.
* ISO 2024-01-02T10:20:30 -> internal
          lv_ms = iv_value.
          REPLACE ALL OCCURRENCES OF '-' IN lv_ms WITH ''.
          REPLACE ALL OCCURRENCES OF ':' IN lv_ms WITH ''.
          REPLACE ALL OCCURRENCES OF 'T' IN lv_ms WITH ''.
          IF lv_kind = 'D'.
            cv_target = lv_ms(8).
          ELSE.
            cv_target = lv_ms.
          ENDIF.
        ENDIF.
      WHEN 'Edm.Time'.
* PT10H20M30S -> 102030
        lv_ms = iv_value.
        REPLACE ALL OCCURRENCES OF 'PT' IN lv_ms WITH ''.
        REPLACE ALL OCCURRENCES OF 'H' IN lv_ms WITH ''.
        REPLACE ALL OCCURRENCES OF 'M' IN lv_ms WITH ''.
        REPLACE ALL OCCURRENCES OF 'S' IN lv_ms WITH ''.
        cv_target = lv_ms.
      WHEN OTHERS.
        IF iv_value = 'null'.
          CLEAR cv_target.
        ELSE.
          cv_target = iv_value.
        ENDIF.
    ENDCASE.
  ENDMETHOD.

  METHOD /iwbep/if_mgw_entry_provider~read_entry_data.
    DATA ls_value    LIKE LINE OF mt_values.
    DATA ls_property TYPE zcl_stg_model_info=>ty_property.
    FIELD-SYMBOLS <lv_target> TYPE any.

    CLEAR es_data.
    LOOP AT mt_values INTO ls_value.
      READ TABLE ms_set-properties INTO ls_property WITH KEY name = ls_value-name.
      IF sy-subrc <> 0.
        CONTINUE.
      ENDIF.
      ASSIGN COMPONENT ls_property-fieldname OF STRUCTURE es_data TO <lv_target>.
      IF sy-subrc <> 0.
        CONTINUE.
      ENDIF.
      convert_value( EXPORTING iv_value    = ls_value-value
                               iv_edm_type = ls_property-edm_type
                     CHANGING  cv_target   = <lv_target> ).
    ENDLOOP.
  ENDMETHOD.

ENDCLASS.
