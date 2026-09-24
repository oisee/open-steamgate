CLASS zcl_osd_amdp_demo DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.
* The worked example of the AMDP bridge (backlog B.19, docs/amdp-in-hana.md).
*
* The body below is SQLScript and this file is the real thing: it compiles on
* a system as the AMDP it is. What runs here is a rewritten copy in gen/amdp/,
* where the body has become a call routed to HANA -- see tools/amdp-gen.mjs.
*
* It is deliberately a computation over DUMMY and reads no table, so it needs
* nothing mirrored and runs against an empty schema.

  PUBLIC SECTION.
    INTERFACES if_amdp_marker_hdb.

    TYPES: BEGIN OF ty_square,
             id     TYPE i,
             label  TYPE string,
             square TYPE i,
           END OF ty_square,
           tt_square TYPE STANDARD TABLE OF ty_square WITH EMPTY KEY.

    CLASS-METHODS squares
      IMPORTING VALUE(iv_count)  TYPE i
      EXPORTING VALUE(et_square) TYPE tt_square.

*   A table parameter crossing the ordinary ABAP call boundary. The caller
*   may fill it with Open SQL; portable execution turns it into a typed
*   relation and keeps aggregation in the selected database.
    TYPES: BEGIN OF ty_amount,
             amount TYPE i,
           END OF ty_amount,
           tt_amount TYPE STANDARD TABLE OF ty_amount WITH EMPTY KEY,
           BEGIN OF ty_total,
             item_count TYPE i,
             total      TYPE i,
           END OF ty_total,
           tt_total TYPE STANDARD TABLE OF ty_total WITH EMPTY KEY.

    CLASS-METHODS total_amount
      IMPORTING VALUE(it_amount) TYPE tt_amount
      EXPORTING VALUE(et_total)  TYPE tt_total.

*   Two OUT tables from one body: each is what the body assigned (an OUT
*   the path taken leaves alone arrives empty -- measured on A4H).
    CLASS-METHODS split_amounts
      IMPORTING VALUE(it_amount) TYPE tt_amount
                VALUE(iv_limit)  TYPE i
      EXPORTING VALUE(et_small)  TYPE tt_amount
                VALUE(et_large)  TYPE tt_amount.

*   Scalar OUTs beside a table OUT: a STRING keeps its trailing blanks, an
*   abap_bool is a c LENGTH 1 (both measured on A4H, 2026-09-23).
    CLASS-METHODS label_amounts
      IMPORTING VALUE(it_amount) TYPE tt_amount
                VALUE(iv_label)  TYPE string
      EXPORTING VALUE(et_small)  TYPE tt_amount
                VALUE(ev_found)  TYPE abap_bool
                VALUE(ev_label)  TYPE string.

    CLASS-METHODS total_amount_nested
      IMPORTING VALUE(it_amount) TYPE tt_amount
      EXPORTING VALUE(et_total)  TYPE tt_total.

*   A database-table read, unlike the table-parameter examples above.  It is
*   the shared-LUW proof: on the portable path this SQLScript plan reads the
*   same DEFAULT connection on which the caller just used Open SQL.
    TYPES: BEGIN OF ty_travel,
             travel_id   TYPE c LENGTH 8,
             description TYPE c LENGTH 40,
             status      TYPE c LENGTH 1,
             seats       TYPE i,
           END OF ty_travel,
           tt_travel TYPE STANDARD TABLE OF ty_travel WITH EMPTY KEY.

    CLASS-METHODS read_travel
      IMPORTING VALUE(iv_client)    TYPE string
                VALUE(iv_travel_id) TYPE string
      EXPORTING VALUE(et_travel)    TYPE tt_travel.

*   The same computation as a CDS table function: its result is queryable
*   like a view rather than returned to one caller. The row type has to agree
*   with the `returns` list of ZTF_OSD_SQUARES field for field -- the CDS
*   declaration is the authority and amdp-gen refuses a mismatch.
    TYPES: BEGIN OF ty_square_tf,
             id     TYPE i,
             label  TYPE c LENGTH 40,
             square TYPE i,
           END OF ty_square_tf,
           tt_square_tf TYPE STANDARD TABLE OF ty_square_tf WITH EMPTY KEY.

    CLASS-METHODS squares_tf
      IMPORTING VALUE(p_count)  TYPE i
      RETURNING VALUE(rt_square) TYPE tt_square_tf.

  PROTECTED SECTION.
  PRIVATE SECTION.
ENDCLASS.

CLASS zcl_osd_amdp_demo IMPLEMENTATION.

  METHOD squares BY DATABASE PROCEDURE FOR HDB
                 LANGUAGE SQLSCRIPT
                 OPTIONS READ-ONLY.
    DECLARE lv_i INTEGER;

    et_square = SELECT 0 AS id, '' AS label, 0 AS square FROM DUMMY WHERE 1 = 0;

    lv_i = 1;
    WHILE :lv_i <= :iv_count DO
      et_square = SELECT * FROM :et_square
                  UNION ALL
                  SELECT :lv_i AS id, 'square of ' || :lv_i AS label, :lv_i * :lv_i AS square FROM DUMMY;
      lv_i = :lv_i + 1;
    END WHILE;
  ENDMETHOD.

  METHOD split_amounts BY DATABASE PROCEDURE FOR HDB
                       LANGUAGE SQLSCRIPT
                       OPTIONS READ-ONLY.
    et_small = SELECT amount FROM :it_amount WHERE amount < :iv_limit;
    et_large = SELECT amount FROM :it_amount WHERE amount >= :iv_limit;
  ENDMETHOD.

  METHOD label_amounts BY DATABASE PROCEDURE FOR HDB
                       LANGUAGE SQLSCRIPT
                       OPTIONS READ-ONLY.
    et_small = SELECT amount FROM :it_amount WHERE amount < 10;
    ev_found = 'X';
    ev_label = :iv_label || '  ';
  ENDMETHOD.

  METHOD total_amount BY DATABASE PROCEDURE FOR HDB
                      LANGUAGE SQLSCRIPT
                      OPTIONS READ-ONLY.
    et_total = SELECT CAST(COUNT(*) AS INTEGER) AS item_count,
                      COALESCE(CAST(SUM(amount) AS INTEGER), 0) AS total
               FROM :it_amount;
  ENDMETHOD.

  METHOD total_amount_nested BY DATABASE PROCEDURE FOR HDB
                             LANGUAGE SQLSCRIPT
                             OPTIONS READ-ONLY
                             USING zcl_osd_amdp_demo=>total_amount.
    CALL "ZCL_OSD_AMDP_DEMO=>TOTAL_AMOUNT"(:it_amount, et_total);
  ENDMETHOD.

  METHOD read_travel BY DATABASE PROCEDURE FOR HDB
                     LANGUAGE SQLSCRIPT
                     OPTIONS READ-ONLY
                     USING zstg_demo.
    et_travel = SELECT travel_id, description, status, seats
                  FROM zstg_demo
                 WHERE mandt = CAST(:iv_client AS NVARCHAR(3))
                   AND travel_id = CAST(:iv_travel_id AS NVARCHAR(8));
  ENDMETHOD.

  METHOD squares_tf BY DATABASE FUNCTION FOR HDB
                    LANGUAGE SQLSCRIPT
                    OPTIONS READ-ONLY.
    RETURN SELECT n AS id,
                  'square of ' || n AS label,
                  n * n AS square
           FROM ( SELECT ROW_NUMBER() OVER () AS n
                  FROM SERIES_GENERATE_INTEGER(1, 1, :p_count + 1) );
  ENDMETHOD.

ENDCLASS.
