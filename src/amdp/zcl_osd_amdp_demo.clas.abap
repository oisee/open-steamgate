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

ENDCLASS.
