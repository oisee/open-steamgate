CLASS zcl_osd_lift_r1_demo DEFINITION PUBLIC FINAL CREATE PUBLIC.
* Recipe R1 of verified lift (docs/verified-lift.md): a SELECT SINGLE per row
* of a loop becomes one SELECT for all rows and a read of a hashed table.
* BEFORE is the shape as it is found in code; AFTER is BEFORE with the loop
* replaced by what recipes/r1-lookup-enrich/template.tpl renders from the
* model tools/lift.mjs extracts out of BEFORE. The region between the
* markers is generated, and test/lift-r1.mjs fails when it drifts.
  PUBLIC SECTION.
    TYPES:
      BEGIN OF ty_row,
        kind TYPE c LENGTH 4,
        code TYPE c LENGTH 10,
        text TYPE c LENGTH 40,
      END OF ty_row,
      tt_rows TYPE STANDARD TABLE OF ty_row WITH DEFAULT KEY.

    CLASS-METHODS before
      CHANGING
        ct_rows TYPE tt_rows.

    CLASS-METHODS after
      CHANGING
        ct_rows TYPE tt_rows.

ENDCLASS.

CLASS zcl_osd_lift_r1_demo IMPLEMENTATION.

  METHOD before.
    FIELD-SYMBOLS <ls_row> LIKE LINE OF ct_rows.
    LOOP AT ct_rows ASSIGNING <ls_row>.
      SELECT SINGLE text FROM zosd_lift_txt INTO <ls_row>-text
        WHERE kind = <ls_row>-kind AND code = <ls_row>-code.
    ENDLOOP.
  ENDMETHOD.

  METHOD after.
    FIELD-SYMBOLS <ls_row> LIKE LINE OF ct_rows.
    " lift:R1 begin
    DATA lt_lookup TYPE HASHED TABLE OF zosd_lift_txt WITH UNIQUE KEY kind code.
    FIELD-SYMBOLS <ls_lookup> LIKE LINE OF lt_lookup.
    IF ct_rows IS NOT INITIAL.
      SELECT kind code text FROM zosd_lift_txt
        INTO CORRESPONDING FIELDS OF TABLE lt_lookup
        FOR ALL ENTRIES IN ct_rows
        WHERE kind = ct_rows-kind AND code = ct_rows-code.
    ENDIF.
    LOOP AT ct_rows ASSIGNING <ls_row>.
      READ TABLE lt_lookup ASSIGNING <ls_lookup> WITH TABLE KEY kind = <ls_row>-kind code = <ls_row>-code.
      IF sy-subrc = 0.
        <ls_row>-text = <ls_lookup>-text.
      ENDIF.
    ENDLOOP.
    " lift:R1 end
  ENDMETHOD.

ENDCLASS.
