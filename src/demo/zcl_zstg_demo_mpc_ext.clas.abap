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
*
*   **The nested table is declared here WITH DEFAULT KEY and not as the
*   base class's TT_BOOKING.** A SEGW-generated MPC writes
*   `TT_BOOKING type standard table of TS_BOOKING .` with no key clause,
*   which is a GENERIC table type -- legal for a field symbol or a formal
*   parameter and not for a structure component. A4H says so exactly:
*   "TT_BOOKING is a generic type. Use this type only for typing field
*   symbols and formal parameters" (2026-09-19). Both corpus projects
*   declare theirs inline with a key for the same reason, and the first
*   version of this class referenced tt_booking because that detail was
*   read past.
*   One component per navigation property, named like it.
    TYPES: BEGIN OF ts_travel_deep.
        INCLUDE TYPE zcl_zstg_demo_mpc=>ts_travel.
    TYPES:
      to_bookings TYPE STANDARD TABLE OF zcl_zstg_demo_mpc=>ts_booking WITH DEFAULT KEY,
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
