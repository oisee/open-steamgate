* ABAPiti oracle 009: A4H measurement, 2026-10-02 (eight cases).
CLASS zcl_gogen_t_repl009 DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS probe IMPORTING iv_case TYPE i RETURNING VALUE(rv) TYPE string.
ENDCLASS.
CLASS zcl_gogen_t_repl009 IMPLEMENTATION.
  METHOD run.
    DO 8 TIMES.
      rv = rv && probe( sy-index ).
    ENDDO.
  ENDMETHOD.
  METHOD probe.
    DATA f TYPE x LENGTH 2 VALUE '1234'.
    DATA f4 TYPE x LENGTH 4 VALUE '11223344'.
    DATA xs TYPE xstring.
    DATA w2 TYPE x LENGTH 2 VALUE 'FFFF'.
    DATA w1 TYPE x LENGTH 1 VALUE 'AB'.
    DATA w3 TYPE x LENGTH 3 VALUE 'A1A2A3'.
    DATA lv_rc TYPE string.
    DATA lv_x TYPE string.
    DATA lx TYPE REF TO cx_root.
    TRY.
        CASE iv_case.
          WHEN 1. REPLACE SECTION OFFSET 1 LENGTH 1 OF f WITH w2 IN BYTE MODE. lv_x = f.
          WHEN 2. REPLACE SECTION OFFSET 0 LENGTH 2 OF f WITH w1 IN BYTE MODE. lv_x = f.
          WHEN 3. REPLACE SECTION OFFSET 1 LENGTH 2 OF f4 WITH w3 IN BYTE MODE. lv_x = f4.
          WHEN 4. REPLACE SECTION OFFSET 1 LENGTH 2 OF f4 WITH w1 IN BYTE MODE. lv_x = f4.
          WHEN 5. xs = '1234'. REPLACE SECTION OFFSET 1 LENGTH 1 OF xs WITH w2 IN BYTE MODE. lv_x = xs.
          WHEN 6. REPLACE SECTION OFFSET 1 LENGTH 1 OF f WITH w1 IN BYTE MODE. lv_x = f.
          WHEN 7. REPLACE SECTION OFFSET 2 LENGTH 0 OF f WITH w1 IN BYTE MODE. lv_x = f.
          WHEN 8. REPLACE SECTION OFFSET 0 LENGTH 1 OF f WITH w3 IN BYTE MODE. lv_x = f.
        ENDCASE.
* Template isolates the byte oracle from the numeric sign-blank discrepancy.
        lv_rc = |{ sy-subrc }|.
        CONCATENATE lv_x ' rc=' lv_rc INTO rv RESPECTING BLANKS.
      CATCH cx_root INTO lx.
        rv = cl_abap_classdescr=>get_class_name( lx ).
    ENDTRY.
    CONCATENATE '[' rv ']' INTO rv.
  ENDMETHOD.
ENDCLASS.
