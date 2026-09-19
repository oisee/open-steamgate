CLASS zcl_zstg_demo_mpc_ext DEFINITION PUBLIC INHERITING FROM zcl_zstg_demo_mpc CREATE PUBLIC.
* The developer's part of the model provider. The Fiori annotations of the
* demo are described in zstg_demo.stg.yaml; stg-compile generates
* zcl_zstg_demo_mpc_ann from them (gen/stg) and this class calls it, as a
* SEGW-generated _MPC_EXT writes its vocabulary annotations in DEFINE.
  PUBLIC SECTION.
*   The deep-insert structure lives HERE and not in the base class, because
*   SEGW regenerates _MPC from the tree and wipes whatever was added to it,
*   while _MPC_EXT is the developer's and is never rewritten. Both real
*   projects in the corpus that do a deep insert declare theirs this way
*   (zcl_zsap_tools_transla_mpc_ext, zcl_zsap_tools_trans_o_mpc_ext), and
*   both take the flat part with INCLUDE TYPE from the base -- so the
*   structure cannot drift from the entity when the model changes.
*   One component per navigation property, named like it.
    TYPES: BEGIN OF ts_travel_deep.
        INCLUDE TYPE zcl_zstg_demo_mpc=>ts_travel.
    TYPES: to_bookings TYPE zcl_zstg_demo_mpc=>tt_booking,
           END OF ts_travel_deep.

    METHODS define REDEFINITION.
  PROTECTED SECTION.
  PRIVATE SECTION.
ENDCLASS.

CLASS zcl_zstg_demo_mpc_ext IMPLEMENTATION.

  METHOD define.
    super->define( ).
    zcl_zstg_demo_mpc_ann=>define( vocab_anno_model ).
  ENDMETHOD.

ENDCLASS.
