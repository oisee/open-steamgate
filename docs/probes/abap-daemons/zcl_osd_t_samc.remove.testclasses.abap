CLASS ltcl_install DEFINITION FINAL FOR TESTING RISK LEVEL HARMLESS DURATION SHORT.
  PRIVATE SECTION.
    METHODS run FOR TESTING.
ENDCLASS.

CLASS ltcl_install IMPLEMENTATION.
  METHOD run.
    DATA(lv) = zcl_osd_t_samc=>remove( '$ZOSG_TMP_0061' ).
    TRY.
        zcl_abapgit_factory=>get_tadir( )->delete_single( iv_object = 'SAMC' iv_obj_name = 'ZOSD_T_AMC' ).
        lv = |{ lv } tadir deleted|.
      CATCH zcx_abapgit_exception INTO DATA(lx).
        lv = |{ lv } tadir: { lx->get_text( ) }|.
    ENDTRY.
    COMMIT WORK.
    cl_abap_unit_assert=>fail( msg = |REMOVE: { lv }| ).
  ENDMETHOD.
ENDCLASS.
