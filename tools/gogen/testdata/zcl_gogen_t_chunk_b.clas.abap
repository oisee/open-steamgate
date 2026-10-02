CLASS zcl_gogen_t_chunk_b DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_gogen_t_chunk.
ENDCLASS.
CLASS zcl_gogen_t_chunk_b IMPLEMENTATION.
  METHOD zif_gogen_t_chunk~step.
    zcl_gogen_t_chunkstate=>gv_calls = zcl_gogen_t_chunkstate=>gv_calls + 1.
    IF depth > 0.
      zcl_gogen_t_chunkstate=>go_a->step( depth - 1 ).
    ENDIF.
  ENDMETHOD.
ENDCLASS.
