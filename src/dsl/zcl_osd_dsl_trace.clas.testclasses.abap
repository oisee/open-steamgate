CLASS ltcl_trace DEFINITION FOR TESTING RISK LEVEL HARMLESS DURATION SHORT FINAL.
  PRIVATE SECTION.
    METHODS node_paths FOR TESTING RAISING cx_static_check.
    METHODS sidecar_fields FOR TESTING RAISING cx_static_check.
    METHODS stable_fields FOR TESTING RAISING cx_static_check.
ENDCLASS.

CLASS ltcl_trace IMPLEMENTATION.
  METHOD node_paths.
    DATA lo_model TYPE REF TO zif_ajson.
    lo_model = zcl_ajson=>parse( `{"@id":"root","items":[{"@id":"child","value":"x"},{"value":"y"}]}` ).
    cl_abap_unit_assert=>assert_equals(
      act = zcl_osd_dsl_trace=>node_of( io_model = lo_model iv_path = '/' ) exp = 'root' ).
    cl_abap_unit_assert=>assert_equals(
      act = zcl_osd_dsl_trace=>node_of( io_model = lo_model iv_path = '/items/1/value' ) exp = 'child' ).
    cl_abap_unit_assert=>assert_equals(
      act = zcl_osd_dsl_trace=>node_of( io_model = lo_model iv_path = '/items/2/value' ) exp = 'root' ).
  ENDMETHOD.

  METHOD sidecar_fields.
    DATA lo_model TYPE REF TO zif_ajson.
    DATA lo_sidecar TYPE REF TO zif_ajson.
    DATA ls_result TYPE zcl_osd_tpl=>ty_result.
    lo_model = zcl_ajson=>parse( `{"@id":"root","items":[{"@id":"child","value":"x"}]}` ).
    ls_result = zcl_osd_tpl=>render( iv_template = `{{#items}}{{value}}{{/items}}`
                                       ii_data = lo_model iv_name = 'sample.tpl' ).
    lo_sidecar = zcl_ajson=>parse( zcl_osd_dsl_trace=>sidecar(
      iv_legacy = abap_true iv_generator = 'sample' iv_template = 'sample.tpl'
      io_model = lo_model is_result = ls_result ) ).
    cl_abap_unit_assert=>assert_equals( act = lo_sidecar->get( '/generator' ) exp = 'sample' ).
    cl_abap_unit_assert=>assert_equals( act = lo_sidecar->get( '/template' ) exp = 'sample.tpl' ).
    cl_abap_unit_assert=>assert_equals( act = strlen( lo_sidecar->get( '/model' ) ) exp = 71 ).
    cl_abap_unit_assert=>assert_true( xsdbool( lo_sidecar->get( '/model' ) CP `sha256:*` ) ).
    " the same model hashes the same, a changed model differently
    cl_abap_unit_assert=>assert_equals(
      act = zcl_ajson=>parse( zcl_osd_dsl_trace=>sidecar( iv_legacy = abap_true iv_generator = 'sample' iv_template = 'sample.tpl'
              io_model = zcl_ajson=>parse( lo_model->stringify( ) ) is_result = ls_result ) )->get( '/model' )
      exp = lo_sidecar->get( '/model' ) ).
    lo_model->set_string( iv_path = '/items/1/value' iv_val = 'y' ).
    cl_abap_unit_assert=>assert_differs(
      act = zcl_ajson=>parse( zcl_osd_dsl_trace=>sidecar( iv_legacy = abap_true iv_generator = 'sample' iv_template = 'sample.tpl'
              io_model = lo_model is_result = ls_result ) )->get( '/model' )
      exp = lo_sidecar->get( '/model' ) ).
    cl_abap_unit_assert=>assert_equals( act = lo_sidecar->get_integer( '/lines/1/line' ) exp = 1 ).
    cl_abap_unit_assert=>assert_equals( act = lo_sidecar->get_integer( '/lines/1/template_line' ) exp = 1 ).
    cl_abap_unit_assert=>assert_equals( act = lo_sidecar->get( '/lines/1/path' ) exp = '/items/1/value' ).
    cl_abap_unit_assert=>assert_equals( act = lo_sidecar->get( '/lines/1/node' ) exp = 'child' ).
  ENDMETHOD.
  METHOD stable_fields.
    DATA lo_model TYPE REF TO zif_ajson.
    DATA lo_trace TYPE REF TO zif_ajson.
    DATA lo_meta TYPE REF TO zif_ajson.
    DATA ls_result TYPE zcl_osd_tpl=>ty_result.
    lo_model = zcl_ajson=>parse( `{"@id":"project/example","mpc":"ZCL_EXAMPLE"}` ).
    ls_result = zcl_osd_tpl=>render( iv_template = `first` && cl_abap_char_utilities=>newline
      && `second` && cl_abap_char_utilities=>newline ii_data = lo_model iv_name = 'mpc_class' ).
    lo_trace = zcl_ajson=>parse( zcl_osd_dsl_trace=>sidecar(
      iv_generator = 'dsl-mpc' iv_template = 'mpc_class' io_model = lo_model is_result = ls_result ) ).
    cl_abap_unit_assert=>assert_equals( act = lo_trace->get( '/format' ) exp = 'osd-trace/1' ).
    cl_abap_unit_assert=>assert_equals( act = lo_trace->get( '/outputs/1/file' ) exp = 'zcl_example.clas.abap' ).
    cl_abap_unit_assert=>assert_equals( act = lo_trace->get_integer( '/outputs/1/lines/1/lines/1' ) exp = 1 ).
    cl_abap_unit_assert=>assert_equals( act = lo_trace->get_integer( '/outputs/1/lines/1/lines/2' ) exp = 2 ).
    cl_abap_unit_assert=>assert_equals( act = lo_trace->get( '/outputs/1/lines/1/locations/1/anchor' ) exp = '<partial>' ).
    cl_abap_unit_assert=>assert_initial( lo_trace->get( '/model' ) ).
    lo_meta = zcl_ajson=>parse( zcl_osd_dsl_trace=>metadata(
      iv_generator = 'dsl-mpc' iv_template = 'mpc_class' io_model = lo_model is_result = ls_result ) ).
    cl_abap_unit_assert=>assert_equals( act = lo_meta->get( '/format' ) exp = 'osd-trace-meta/1' ).
    cl_abap_unit_assert=>assert_equals( act = strlen( lo_meta->get( '/outputs/1/hash' ) ) exp = 71 ).
  ENDMETHOD.
ENDCLASS.
