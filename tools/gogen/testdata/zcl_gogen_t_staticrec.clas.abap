CLASS zcl_gogen_t_staticrec DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.
CLASS zcl_gogen_t_staticrec IMPLEMENTATION.
  METHOD run.
    CREATE OBJECT zcl_gogen_t_chunkstate=>go_a TYPE zcl_gogen_t_chunk_a.
    CREATE OBJECT zcl_gogen_t_chunkstate=>go_b TYPE zcl_gogen_t_chunk_b.
    CLEAR zcl_gogen_t_chunkstate=>gv_calls.
    zcl_gogen_t_chunkstate=>go_a->step( 2000 ).
    rv = |{ zcl_gogen_t_chunkstate=>gv_calls }|.
  ENDMETHOD.
ENDCLASS.
