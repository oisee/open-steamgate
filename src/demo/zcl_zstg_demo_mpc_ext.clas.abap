CLASS zcl_zstg_demo_mpc_ext DEFINITION PUBLIC INHERITING FROM zcl_zstg_demo_mpc CREATE PUBLIC.
* The developer's part of the model provider. The Fiori annotations of the
* demo are described in zstg_demo.stg.yaml; stg-compile generates
* zcl_zstg_demo_mpc_ann from them (gen/stg) and this class calls it, as a
* SEGW-generated _MPC_EXT writes its vocabulary annotations in DEFINE.
  PUBLIC SECTION.
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
