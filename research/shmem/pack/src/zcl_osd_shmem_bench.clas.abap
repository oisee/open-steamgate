CLASS zcl_osd_shmem_bench DEFINITION PUBLIC FINAL CREATE PUBLIC.
* Research only (docs/research-db-itab-shared-memory.md). Every method is one
* step the host times on its own: the SELECT, and then what ABAP does with
* the internal table. The table is kept in class data between the steps so
* that a step measures itself and not the SELECT before it.
  PUBLIC SECTION.
    TYPES ty_facts TYPE STANDARD TABLE OF zstg_flightfact WITH DEFAULT KEY.
    TYPES: BEGIN OF ty_agg,
             airline TYPE zstg_flightfact-airline,
             seats   TYPE i,
             price   TYPE p LENGTH 16 DECIMALS 2,
           END OF ty_agg.
    TYPES ty_aggs TYPE SORTED TABLE OF ty_agg WITH UNIQUE KEY airline.
    TYPES: BEGIN OF ty_narrow,
             airline TYPE zstg_flightfact-airline,
             seats   TYPE zstg_flightfact-seats,
           END OF ty_narrow.
    TYPES ty_narrows TYPE STANDARD TABLE OF ty_narrow WITH DEFAULT KEY.

    CLASS-DATA gt_facts TYPE ty_facts.
    CLASS-DATA gt_copy TYPE ty_facts.

    CLASS-METHODS select_all RETURNING VALUE(rv_lines) TYPE i.
    CLASS-METHODS select_narrow RETURNING VALUE(rv_lines) TYPE i.
    CLASS-METHODS select_cube RETURNING VALUE(rv_digest) TYPE string.
    CLASS-METHODS count_lines RETURNING VALUE(rv_lines) TYPE i.
    CLASS-METHODS loop_one_field RETURNING VALUE(rv_sum) TYPE i.
    CLASS-METHODS loop_all_fields RETURNING VALUE(rv_digest) TYPE string.
    CLASS-METHODS read_sparse RETURNING VALUE(rv_sum) TYPE i.
    CLASS-METHODS abap_cube RETURNING VALUE(rv_digest) TYPE string.
    CLASS-METHODS copy_table RETURNING VALUE(rv_lines) TYPE i.
    CLASS-METHODS release.
    CLASS-METHODS semantics RETURNING VALUE(rv_digest) TYPE string.
  PRIVATE SECTION.
    CLASS-METHODS digest_of
      IMPORTING it_aggs          TYPE ty_aggs
      RETURNING VALUE(rv_digest) TYPE string.
    CLASS-METHODS line_of
      IMPORTING is_fact        TYPE zstg_flightfact
      RETURNING VALUE(rv_line) TYPE string.
ENDCLASS.

CLASS zcl_osd_shmem_bench IMPLEMENTATION.

  METHOD select_all.
    SELECT * FROM zstg_flightfact INTO TABLE gt_facts.
    rv_lines = sy-dbcnt.
  ENDMETHOD.

  METHOD select_narrow.
    DATA lt_narrow TYPE ty_narrows.
    SELECT airline seats FROM zstg_flightfact INTO TABLE lt_narrow.
    rv_lines = lines( lt_narrow ).
  ENDMETHOD.

  METHOD select_cube.
    DATA lt_aggs TYPE ty_aggs.
    SELECT airline SUM( seats ) AS seats SUM( price ) AS price
      FROM zstg_flightfact
      INTO CORRESPONDING FIELDS OF TABLE lt_aggs
      GROUP BY airline.
    rv_digest = digest_of( lt_aggs ).
  ENDMETHOD.

  METHOD count_lines.
    rv_lines = lines( gt_facts ).
  ENDMETHOD.

  METHOD loop_one_field.
    FIELD-SYMBOLS <ls_fact> TYPE zstg_flightfact.
    LOOP AT gt_facts ASSIGNING <ls_fact>.
      rv_sum = rv_sum + <ls_fact>-seats.
    ENDLOOP.
  ENDMETHOD.

  METHOD loop_all_fields.
    FIELD-SYMBOLS <ls_fact> TYPE zstg_flightfact.
    DATA lv_seats TYPE i.
    DATA lv_price TYPE p LENGTH 16 DECIMALS 2.
    DATA lv_hits TYPE i.
    DATA lv_text TYPE string.
    LOOP AT gt_facts ASSIGNING <ls_fact>.
      lv_seats = lv_seats + <ls_fact>-seats.
      lv_price = lv_price + <ls_fact>-price.
      IF <ls_fact>-mandt = '123'.
        lv_hits = lv_hits + 1.
      ENDIF.
      IF <ls_fact>-fact_id > '0001500000'.
        lv_hits = lv_hits + 1.
      ENDIF.
      IF <ls_fact>-airline = 'LH'.
        lv_hits = lv_hits + 1.
      ENDIF.
      IF <ls_fact>-flight_month >= '202606'.
        lv_hits = lv_hits + 1.
      ENDIF.
      IF <ls_fact>-status = 'A'.
        lv_hits = lv_hits + 1.
      ENDIF.
      IF <ls_fact>-currency = 'EUR'.
        lv_hits = lv_hits + 1.
      ENDIF.
    ENDLOOP.
    rv_digest = lv_seats.
    lv_text = lv_price.
    CONCATENATE rv_digest lv_text INTO rv_digest SEPARATED BY '/'.
    lv_text = lv_hits.
    CONCATENATE rv_digest lv_text INTO rv_digest SEPARATED BY '/'.
    CONDENSE rv_digest NO-GAPS.
  ENDMETHOD.

  METHOD read_sparse.
    FIELD-SYMBOLS <ls_fact> TYPE zstg_flightfact.
    DATA lv_index TYPE i.
    DATA lv_lines TYPE i.
    lv_lines = lines( gt_facts ).
    lv_index = 1.
    WHILE lv_index <= lv_lines.
      READ TABLE gt_facts INDEX lv_index ASSIGNING <ls_fact>.
      IF sy-subrc = 0.
        rv_sum = rv_sum + <ls_fact>-seats.
      ENDIF.
      lv_index = lv_index + 1000.
    ENDWHILE.
  ENDMETHOD.

  METHOD abap_cube.
    FIELD-SYMBOLS <ls_fact> TYPE zstg_flightfact.
    DATA lt_aggs TYPE ty_aggs.
    DATA ls_agg TYPE ty_agg.
    LOOP AT gt_facts ASSIGNING <ls_fact>.
      ls_agg-airline = <ls_fact>-airline.
      ls_agg-seats = <ls_fact>-seats.
      ls_agg-price = <ls_fact>-price.
      COLLECT ls_agg INTO lt_aggs.
    ENDLOOP.
    rv_digest = digest_of( lt_aggs ).
  ENDMETHOD.

  METHOD copy_table.
    gt_copy = gt_facts.
    rv_lines = lines( gt_copy ).
  ENDMETHOD.

  METHOD release.
    CLEAR gt_facts.
    CLEAR gt_copy.
  ENDMETHOD.

  METHOD digest_of.
    DATA ls_agg TYPE ty_agg.
    DATA lv_text TYPE string.
    LOOP AT it_aggs INTO ls_agg.
      lv_text = ls_agg-seats.
      CONCATENATE rv_digest ls_agg-airline lv_text INTO rv_digest SEPARATED BY ':'.
      lv_text = ls_agg-price.
      CONCATENATE rv_digest lv_text INTO rv_digest SEPARATED BY ':'.
    ENDLOOP.
    CONDENSE rv_digest NO-GAPS.
  ENDMETHOD.

  METHOD line_of.
    DATA lv_seats TYPE string.
    DATA lv_price TYPE string.
    lv_seats = is_fact-seats.
    lv_price = is_fact-price.
    CONCATENATE is_fact-mandt is_fact-fact_id is_fact-airline is_fact-flight_month
      is_fact-status lv_seats lv_price is_fact-currency INTO rv_line SEPARATED BY '|'.
  ENDMETHOD.

  METHOD semantics.
* One answer out of many statements on a selected table. The host runs it
* with the switch off and on and the two answers have to be the same text.
    TYPES ty_sorted TYPE SORTED TABLE OF zstg_flightfact WITH NON-UNIQUE KEY airline flight_month.
    TYPES ty_hashed TYPE HASHED TABLE OF zstg_flightfact WITH UNIQUE KEY mandt fact_id.
    DATA lt_facts TYPE ty_facts.
    DATA lt_more TYPE ty_facts.
    DATA lt_sorted TYPE ty_sorted.
    DATA lt_hashed TYPE ty_hashed.
    DATA lt_narrow TYPE ty_narrows.
    DATA ls_fact TYPE zstg_flightfact.
    DATA ls_narrow TYPE ty_narrow.
    DATA lr_fact TYPE REF TO zstg_flightfact.
    DATA lv_text TYPE string.
    DATA lv_count TYPE i.
    FIELD-SYMBOLS <ls_fact> TYPE zstg_flightfact.
    FIELD-SYMBOLS <lv_any> TYPE any.

    DEFINE _say.
      lv_text = &1.
      CONCATENATE rv_digest lv_text INTO rv_digest SEPARATED BY ';'.
    END-OF-DEFINITION.

    SELECT * FROM zstg_flightfact INTO TABLE lt_facts UP TO 200 ROWS ORDER BY PRIMARY KEY.
    _say sy-dbcnt.
    _say sy-subrc.

* untouched rows: size, copy, compare
    lv_count = lines( lt_facts ).
    _say lv_count.
    lt_more = lt_facts.
    IF lt_more = lt_facts.
      _say 'equal'.
    ENDIF.

* index and key reads
    READ TABLE lt_facts INDEX 7 INTO ls_fact.
    lv_text = line_of( ls_fact ).
    _say lv_text.
    READ TABLE lt_facts WITH KEY airline = 'LH' status = 'A' ASSIGNING <ls_fact>.
    _say sy-tabix.
    lv_text = line_of( <ls_fact> ).
    _say lv_text.
    READ TABLE lt_facts WITH KEY fact_id = '0000000003' BINARY SEARCH INTO ls_fact.
    _say sy-subrc.
    _say sy-tabix.
    READ TABLE lt_facts INDEX 3 REFERENCE INTO lr_fact.
    _say lr_fact->seats.

* a change through a field symbol stays in the table and not in the copy
    READ TABLE lt_facts INDEX 5 ASSIGNING <ls_fact>.
    <ls_fact>-seats = 99.
    <ls_fact>-airline = 'ZZ'.
    READ TABLE lt_facts INDEX 5 INTO ls_fact.
    lv_text = line_of( ls_fact ).
    _say lv_text.
    READ TABLE lt_more INDEX 5 INTO ls_fact.
    lv_text = line_of( ls_fact ).
    _say lv_text.
    IF lt_more <> lt_facts.
      _say 'differs'.
    ENDIF.

* a component by name
    READ TABLE lt_facts INDEX 9 ASSIGNING <ls_fact>.
    ASSIGN COMPONENT 'PRICE' OF STRUCTURE <ls_fact> TO <lv_any>.
    _say <lv_any>.
    ASSIGN COMPONENT 2 OF STRUCTURE <ls_fact> TO <lv_any>.
    _say <lv_any>.

* loops
    CLEAR lv_count.
    LOOP AT lt_facts ASSIGNING <ls_fact> WHERE status = 'A' AND seats > 1.
      lv_count = lv_count + <ls_fact>-seats.
    ENDLOOP.
    _say lv_count.
    CLEAR lv_count.
    LOOP AT lt_facts INTO ls_fact FROM 10 TO 20.
      lv_count = lv_count + ls_fact-seats.
    ENDLOOP.
    _say lv_count.

* changes of the table itself
    DELETE lt_facts INDEX 2.
    DELETE lt_facts WHERE status = 'X'.
    _say sy-subrc.
    lv_count = lines( lt_facts ).
    _say lv_count.
    ls_fact-fact_id = '9999999999'.
    ls_fact-seats = 7.
    INSERT ls_fact INTO lt_facts INDEX 1.
    APPEND ls_fact TO lt_facts.
    MODIFY lt_facts FROM ls_fact INDEX 4.
    ls_fact-currency = 'XXX'.
    MODIFY lt_facts FROM ls_fact TRANSPORTING currency WHERE airline = 'AA'.
    _say sy-subrc.
    SORT lt_facts BY price DESCENDING fact_id ASCENDING.
    READ TABLE lt_facts INDEX 1 INTO ls_fact.
    lv_text = line_of( ls_fact ).
    _say lv_text.
    SORT lt_facts BY airline flight_month.
    DELETE ADJACENT DUPLICATES FROM lt_facts COMPARING airline flight_month.
    lv_count = lines( lt_facts ).
    _say lv_count.
    APPEND LINES OF lt_more FROM 190 TO lt_facts.
    lv_count = lines( lt_facts ).
    _say lv_count.
    LOOP AT lt_facts INTO ls_fact.
      lv_text = line_of( ls_fact ).
      _say lv_text.
    ENDLOOP.

* other targets
    SELECT * FROM zstg_flightfact INTO TABLE lt_sorted UP TO 150 ROWS ORDER BY PRIMARY KEY.
    READ TABLE lt_sorted WITH TABLE KEY airline = 'BA' flight_month = '202603' INTO ls_fact.
    _say sy-subrc.
    LOOP AT lt_sorted INTO ls_fact WHERE airline = 'SQ'.
      lv_text = line_of( ls_fact ).
      _say lv_text.
    ENDLOOP.
    SELECT * FROM zstg_flightfact INTO TABLE lt_hashed UP TO 150 ROWS ORDER BY PRIMARY KEY.
    READ TABLE lt_hashed WITH TABLE KEY mandt = '123' fact_id = '0000000011' INTO ls_fact.
    lv_text = line_of( ls_fact ).
    _say lv_text.
    SELECT airline seats FROM zstg_flightfact INTO TABLE lt_narrow UP TO 30 ROWS ORDER BY PRIMARY KEY.
    LOOP AT lt_narrow INTO ls_narrow.
      _say ls_narrow-airline.
      _say ls_narrow-seats.
    ENDLOOP.
    SELECT * FROM zstg_flightfact INTO CORRESPONDING FIELDS OF TABLE lt_narrow UP TO 5 ROWS ORDER BY PRIMARY KEY.
    SELECT * FROM zstg_flightfact APPENDING CORRESPONDING FIELDS OF TABLE lt_narrow UP TO 3 ROWS ORDER BY PRIMARY KEY.
    lv_count = lines( lt_narrow ).
    _say lv_count.
    LOOP AT lt_narrow INTO ls_narrow.
      _say ls_narrow-airline.
      _say ls_narrow-seats.
    ENDLOOP.

* a table moved into another and the source cleared
    lt_more = lt_facts.
    CLEAR lt_facts.
    READ TABLE lt_more INDEX 1 INTO ls_fact.
    lv_text = line_of( ls_fact ).
    _say lv_text.
    SELECT * FROM zstg_flightfact INTO TABLE lt_facts WHERE airline = 'NO'.
    _say sy-subrc.
    lv_count = lines( lt_facts ).
    _say lv_count.
  ENDMETHOD.

ENDCLASS.
