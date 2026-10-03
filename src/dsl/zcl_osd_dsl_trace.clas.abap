CLASS zcl_osd_dsl_trace DEFINITION PUBLIC FINAL CREATE PRIVATE.
  PUBLIC SECTION.
    CLASS-METHODS node_of
      IMPORTING io_model TYPE REF TO zif_ajson iv_path TYPE string
      RETURNING VALUE(rv_node) TYPE string.
    CLASS-METHODS sidecar
      IMPORTING iv_generator TYPE string iv_template TYPE string
                io_model TYPE REF TO zif_ajson
                is_result TYPE zcl_osd_tpl=>ty_result
                iv_model_json TYPE string OPTIONAL
                iv_legacy TYPE abap_bool DEFAULT abap_false
                iv_file TYPE string OPTIONAL
                iv_source TYPE string OPTIONAL
      RETURNING VALUE(rv_json) TYPE string
      RAISING cx_abap_message_digest zcx_ajson_error.
    CLASS-METHODS metadata
      IMPORTING iv_generator TYPE string iv_template TYPE string
                io_model TYPE REF TO zif_ajson
                is_result TYPE zcl_osd_tpl=>ty_result
                iv_model_json TYPE string OPTIONAL iv_file TYPE string OPTIONAL
      RETURNING VALUE(rv_json) TYPE string
      RAISING cx_abap_message_digest zcx_ajson_error.
  PRIVATE SECTION.
    CLASS-METHODS legacy
      IMPORTING iv_generator TYPE string iv_template TYPE string
                io_model TYPE REF TO zif_ajson
                is_result TYPE zcl_osd_tpl=>ty_result
                iv_model_json TYPE string OPTIONAL
      RETURNING VALUE(rv_json) TYPE string
      RAISING cx_abap_message_digest zcx_ajson_error.
    CLASS-METHODS source_json
      IMPORTING io_model TYPE REF TO zif_ajson iv_path TYPE string iv_source TYPE string
      RETURNING VALUE(rv_json) TYPE string.
    CLASS-METHODS output_file
      IMPORTING io_model TYPE REF TO zif_ajson iv_generator TYPE string iv_file TYPE string
      RETURNING VALUE(rv_file) TYPE string.
    CLASS-METHODS recipe
      IMPORTING iv_generator TYPE string iv_template TYPE string
      RETURNING VALUE(rv_file) TYPE string.
ENDCLASS.

CLASS zcl_osd_dsl_trace IMPLEMENTATION.
  METHOD node_of.
    DATA lv_path TYPE string.
    DATA lv_pos TYPE i.
    lv_path = iv_path.
    DO.
      IF lv_path IS INITIAL OR lv_path = `/`.
        rv_node = io_model->get( `/@id` ).
        RETURN.
      ENDIF.
      rv_node = io_model->get( lv_path && `/@id` ).
      IF rv_node IS NOT INITIAL.
        RETURN.
      ENDIF.
      FIND REGEX `/[^/]+$` IN lv_path MATCH OFFSET lv_pos.
      IF sy-subrc <> 0.
        lv_path = `/`.
      ELSE.
        lv_path = substring( val = lv_path len = lv_pos ).
      ENDIF.
    ENDDO.
  ENDMETHOD.

  METHOD legacy.
    DATA lv_hash TYPE string.
    DATA ls_trace TYPE zcl_osd_tpl=>ty_trace.
    DATA lv_node TYPE string.
    DATA lv_first TYPE abap_bool.
    TYPES: BEGIN OF ty_cached_node,
             path TYPE string,
             node TYPE string,
           END OF ty_cached_node.
    DATA lt_nodes TYPE HASHED TABLE OF ty_cached_node WITH UNIQUE KEY path.
    DATA ls_node TYPE ty_cached_node.
    DATA lt_parts TYPE string_table.
    " the model's own JSON text when the caller has it: serialising a large
    " parsed tree again costs seconds
    IF iv_model_json IS NOT INITIAL.
      cl_abap_message_digest=>calculate_hash_for_char(
        EXPORTING if_algorithm = 'SHA256' if_data = iv_model_json
        IMPORTING ef_hashstring = lv_hash ).
    ELSE.
      cl_abap_message_digest=>calculate_hash_for_char(
        EXPORTING if_algorithm = 'SHA256' if_data = io_model->stringify( )
        IMPORTING ef_hashstring = lv_hash ).
    ENDIF.
    " built from parts and joined once: appending to one string ten thousand
    " times copies it ten thousand times
    APPEND `{"generator":"` && zcl_stg_json=>escape( iv_generator ) && `","lines":[` TO lt_parts.
    lv_first = abap_true.
    LOOP AT is_result-trace INTO ls_trace.
      READ TABLE lt_nodes INTO ls_node WITH TABLE KEY path = ls_trace-path.
      IF sy-subrc <> 0.
        ls_node-path = ls_trace-path.
        ls_node-node = node_of( io_model = io_model iv_path = ls_trace-path ).
        INSERT ls_node INTO TABLE lt_nodes.
      ENDIF.
      lv_node = zcl_stg_json=>escape( ls_node-node ).
      IF lv_first = abap_false.
        APPEND `,` TO lt_parts.
      ENDIF.
      lv_first = abap_false.
      APPEND `{"line":` && |{ ls_trace-line }|
        && `,"node":"` && lv_node
        && `","path":"` && zcl_stg_json=>escape( ls_trace-path )
        && `","template_line":` && |{ ls_trace-template_line }| TO lt_parts.
      APPEND `}` TO lt_parts.
    ENDLOOP.
    APPEND `],"model":"sha256:` && to_lower( lv_hash )
      && `","template":"` && zcl_stg_json=>escape( iv_template ) && `"}` TO lt_parts.
    rv_json = concat_lines_of( table = lt_parts ).
  ENDMETHOD.
  METHOD output_file.
    rv_file = iv_file.
    IF rv_file IS INITIAL.
      IF iv_generator = 'dsl-dpc'.
        rv_file = io_model->get( '/dpc' ).
      ELSE.
        rv_file = io_model->get( '/mpc' ).
      ENDIF.
      rv_file = to_lower( rv_file ) && '.clas.abap'.
    ENDIF.
  ENDMETHOD.

  METHOD recipe.
    IF iv_generator = 'dsl-dpc'.
      IF iv_template = 'dpc_class'.
        rv_file = 'src/dsl/dpc-templates/class.tpl'.
      ELSE.
        rv_file = 'src/dsl/dpc-templates/' && iv_template && '.tpl'.
      ENDIF.
    ELSE.
      " Logical identities for the templates embedded in the MPC emitter.
      rv_file = 'src/dsl/mpc-templates/' && iv_template && '.tpl'.
    ENDIF.
  ENDMETHOD.

  METHOD source_json.
    DATA lv_path TYPE string.
    DATA lv_node TYPE string.
    DATA lv_selector TYPE string.
    DATA lv_pos TYPE i.
    lv_path = iv_path.
    DO.
      IF lv_path IS INITIAL OR lv_path = '/'.
        lv_node = io_model->get( '/@id' ).
        CLEAR lv_path.
        EXIT.
      ENDIF.
      lv_node = io_model->get( lv_path && '/@id' ).
      IF lv_node IS NOT INITIAL.
        EXIT.
      ENDIF.
      FIND REGEX '/[^/]+$' IN lv_path MATCH OFFSET lv_pos.
      IF sy-subrc <> 0.
        CLEAR lv_path.
      ELSE.
        lv_path = substring( val = lv_path len = lv_pos ).
      ENDIF.
    ENDDO.
    lv_selector = substring( val = iv_path off = strlen( lv_path ) ).
    IF lv_selector IS INITIAL.
      lv_selector = '/'.
    ENDIF.
    rv_json = `            {"file": "` && zcl_stg_json=>escape( iv_source )
      && `", "node": "` && zcl_stg_json=>escape( lv_node )
      && `", "selector": "` && zcl_stg_json=>escape( lv_selector ) && `"}`.
  ENDMETHOD.

  METHOD sidecar.
    TYPES: BEGIN OF ty_cached,
             path TYPE string,
             node TYPE string,
             source TYPE string,
           END OF ty_cached.
    DATA lt_cached TYPE HASHED TABLE OF ty_cached WITH UNIQUE KEY path.
    DATA ls_cached TYPE ty_cached.
    TYPES: BEGIN OF ty_counter,
             key TYPE string,
             line TYPE i,
             offset TYPE i,
           END OF ty_counter.
    DATA lt_counters TYPE HASHED TABLE OF ty_counter WITH UNIQUE KEY key.
    DATA ls_counter TYPE ty_counter.
    TYPES: BEGIN OF ty_location,
             recipe TYPE string,
             offset TYPE i,
           END OF ty_location.
    DATA lt_locations TYPE SORTED TABLE OF ty_location WITH UNIQUE KEY recipe offset.
    DATA ls_location TYPE ty_location.
    DATA lt_location_parts TYPE string_table.
    DATA lt_identities TYPE SORTED TABLE OF string WITH UNIQUE KEY table_line.
    DATA lv_locations TYPE string.
    DATA lv_saved_locations TYPE string.
    DATA lv_relative TYPE i.
    DATA lv_file TYPE string.
    DATA lv_source TYPE string.
    DATA ls_contributor TYPE zcl_osd_tpl=>ty_contribution.
    DATA lt_sources TYPE SORTED TABLE OF string WITH UNIQUE KEY table_line.
    DATA lv_sources TYPE string.
    DATA lv_piece TYPE string.
    DATA ls_trace TYPE zcl_osd_tpl=>ty_trace.
    DATA lv_recipe TYPE string.
    DATA lv_key TYPE string.
    DATA lv_previous TYPE string.
    DATA lv_start TYPE i.
    DATA lv_end TYPE i.
    DATA lv_identity TYPE string.
    DATA lv_saved TYPE string.
    DATA lv_record TYPE string.
    DATA lt_records TYPE string_table.
    DATA lv_nl TYPE string.
    lv_nl = cl_abap_char_utilities=>newline.
    IF iv_legacy = abap_true.
      rv_json = legacy( iv_generator = iv_generator iv_template = iv_template
        io_model = io_model is_result = is_result iv_model_json = iv_model_json ).
      RETURN.
    ENDIF.
    lv_file = output_file( io_model = io_model iv_generator = iv_generator iv_file = iv_file ).
    lv_source = iv_source.
    IF lv_source IS INITIAL.
      lv_source = to_lower( io_model->get( '/@id' ) ).
      REPLACE FIRST OCCURRENCE OF 'project/' IN lv_source WITH ''.
      lv_source = lv_source && '.iwpr.xml'.
    ENDIF.
    LOOP AT is_result-trace INTO ls_trace.
      READ TABLE lt_cached INTO ls_cached WITH TABLE KEY path = ls_trace-path.
      IF sy-subrc <> 0.
        ls_cached-path = ls_trace-path.
        ls_cached-node = node_of( io_model = io_model iv_path = ls_trace-path ).
        ls_cached-source = source_json( io_model = io_model iv_path = ls_trace-path iv_source = lv_source ).
        INSERT ls_cached INTO TABLE lt_cached.
      ENDIF.
      CLEAR lt_sources.
      CLEAR lt_locations.
      CLEAR lt_identities.
      IF ls_trace-contributors IS INITIAL.
        ls_contributor-path = ls_trace-path.
        ls_contributor-template = ls_trace-template.
        APPEND ls_contributor TO ls_trace-contributors.
      ENDIF.
      LOOP AT ls_trace-contributors INTO ls_contributor.
        READ TABLE lt_cached INTO ls_cached WITH TABLE KEY path = ls_contributor-path.
        IF sy-subrc <> 0.
          ls_cached-path = ls_contributor-path.
          ls_cached-node = node_of( io_model = io_model iv_path = ls_contributor-path ).
          ls_cached-source = source_json( io_model = io_model iv_path = ls_contributor-path iv_source = lv_source ).
          INSERT ls_cached INTO TABLE lt_cached.
        ENDIF.
        lv_piece = ls_cached-source.
        INSERT lv_piece INTO TABLE lt_sources.
        lv_recipe = recipe( iv_generator = iv_generator iv_template = ls_contributor-template ).
        lv_key = lv_recipe && '|' && ls_cached-node && '|' && |{ ls_contributor-invocation }|.
        READ TABLE lt_counters INTO ls_counter WITH TABLE KEY key = lv_key.
        IF sy-subrc <> 0.
          CLEAR ls_counter.
          ls_counter-key = lv_key.
        ENDIF.
        IF ls_counter-line <> ls_trace-line.
          IF ls_counter-line > 0.
            ls_counter-offset = ls_counter-offset + 1.
          ELSE.
            ls_counter-offset = 0.
          ENDIF.
          ls_counter-line = ls_trace-line.
          MODIFY TABLE lt_counters FROM ls_counter.
          IF sy-subrc <> 0.
            INSERT ls_counter INTO TABLE lt_counters.
          ENDIF.
        ENDIF.
        lv_piece = `{"recipe":"` && zcl_stg_json=>escape( lv_recipe )
          && `","anchor":"<partial>","offset":`.
        ls_location-recipe = lv_recipe.
        ls_location-offset = ls_counter-offset.
        INSERT ls_location INTO TABLE lt_locations.
        lv_relative = ls_counter-offset - ls_trace-line.
        INSERT lv_piece && |{ lv_relative }| && '}' INTO TABLE lt_identities.
      ENDLOOP.
      lv_sources = concat_lines_of( table = lt_sources sep = ',' && lv_nl ).
      CLEAR lt_location_parts.
      LOOP AT lt_locations INTO ls_location.
        APPEND `            {"recipe": "` && zcl_stg_json=>escape( ls_location-recipe )
          && `", "anchor": "<partial>", "offset": ` && |{ ls_location-offset }| && `}` TO lt_location_parts.
      ENDLOOP.
      lv_locations = concat_lines_of( table = lt_location_parts sep = ',' && lv_nl ).
      lv_identity = lv_sources && '|' && concat_lines_of( table = lt_identities sep = ',' ).
      IF lv_identity <> lv_previous.
        IF lv_start > 0.
          IF lv_start = lv_end.
            lv_record = `        {` && lv_nl && `          "line": ` && |{ lv_start }|.
          ELSE.
            lv_record = `        {` && lv_nl && `          "lines": [` && |{ lv_start }| && `, ` && |{ lv_end }| && `]`.
          ENDIF.
          APPEND lv_record && lv_saved && lv_saved_locations && lv_nl && `          ]` && lv_nl && `        }` TO lt_records.
        ENDIF.
        lv_start = ls_trace-line.
        lv_previous = lv_identity.
        lv_saved = `,` && lv_nl && `          "sources": [` && lv_nl && lv_sources && lv_nl
          && `          ],` && lv_nl && `          "locations": [` && lv_nl.
        lv_saved_locations = lv_locations.
      ENDIF.
      lv_end = ls_trace-line.
    ENDLOOP.
    IF lv_start > 0.
      IF lv_start = lv_end.
        lv_record = `        {` && lv_nl && `          "line": ` && |{ lv_start }|.
      ELSE.
        lv_record = `        {` && lv_nl && `          "lines": [` && |{ lv_start }| && `, ` && |{ lv_end }| && `]`.
      ENDIF.
      APPEND lv_record && lv_saved && lv_saved_locations && lv_nl && `          ]` && lv_nl && `        }` TO lt_records.
    ENDIF.
    rv_json = `{` && lv_nl && `  "format": "osd-trace/1",` && lv_nl
      && `  "outputs": [` && lv_nl && `    {` && lv_nl
      && `      "file": "` && zcl_stg_json=>escape( lv_file ) && `",` && lv_nl.
    IF lt_records IS INITIAL.
      rv_json = rv_json && `      "lines": []` && lv_nl.
    ELSE.
      rv_json = rv_json && `      "lines": [` && lv_nl
        && concat_lines_of( table = lt_records sep = ',' && lv_nl ) && lv_nl && `      ]` && lv_nl.
    ENDIF.
    rv_json = rv_json && `    }` && lv_nl && `  ]` && lv_nl && `}` && lv_nl.
  ENDMETHOD.

  METHOD metadata.
    TYPES: BEGIN OF ty_cached_node,
             path TYPE string,
             node TYPE string,
           END OF ty_cached_node,
           BEGIN OF ty_template_hash,
             file TYPE string,
             hash TYPE string,
           END OF ty_template_hash.
    DATA lt_nodes TYPE HASHED TABLE OF ty_cached_node WITH UNIQUE KEY path.
    DATA ls_node TYPE ty_cached_node.
    DATA lt_templates TYPE SORTED TABLE OF string WITH UNIQUE KEY table_line.
    DATA lt_hashes TYPE SORTED TABLE OF ty_template_hash WITH UNIQUE KEY file.
    DATA ls_hash TYPE ty_template_hash.
    DATA ls_trace TYPE zcl_osd_tpl=>ty_trace.
    DATA ls_contributor TYPE zcl_osd_tpl=>ty_contribution.
    DATA lt_lines TYPE string_table.
    DATA lt_template_parts TYPE string_table.
    DATA lv_model_hash TYPE string.
    DATA lv_output_hash TYPE string.
    DATA lv_text TYPE string.
    DATA lv_file TYPE string.
    DATA lv_template TYPE string.
    DATA lv_nl TYPE string.
    lv_nl = cl_abap_char_utilities=>newline.
    lv_file = output_file( io_model = io_model iv_generator = iv_generator iv_file = iv_file ).
    lv_text = iv_model_json.
    IF lv_text IS INITIAL.
      lv_text = io_model->stringify( ).
    ENDIF.
    cl_abap_message_digest=>calculate_hash_for_char(
      EXPORTING if_algorithm = 'SHA256' if_data = lv_text
      IMPORTING ef_hashstring = lv_model_hash ).
    lv_text = zcl_osd_tpl=>to_string( is_result ).
    cl_abap_message_digest=>calculate_hash_for_char(
      EXPORTING if_algorithm = 'SHA256' if_data = lv_text
      IMPORTING ef_hashstring = lv_output_hash ).
    LOOP AT is_result-trace INTO ls_trace.
      READ TABLE lt_nodes INTO ls_node WITH TABLE KEY path = ls_trace-path.
      IF sy-subrc <> 0.
        ls_node-path = ls_trace-path.
        ls_node-node = node_of( io_model = io_model iv_path = ls_trace-path ).
        INSERT ls_node INTO TABLE lt_nodes.
      ENDIF.
      APPEND `    {"file": "` && zcl_stg_json=>escape( lv_file )
        && `", "line": ` && |{ ls_trace-line }|
        && `, "node": "` && zcl_stg_json=>escape( ls_node-node )
        && `", "path": "` && zcl_stg_json=>escape( ls_trace-path )
        && `", "template": "` && zcl_stg_json=>escape( ls_trace-template )
        && `", "template_line": ` && |{ ls_trace-template_line }| && `}` TO lt_lines.
      INSERT ls_trace-template INTO TABLE lt_templates.
      LOOP AT ls_trace-contributors INTO ls_contributor.
        INSERT ls_contributor-template INTO TABLE lt_templates.
      ENDLOOP.
    ENDLOOP.
    LOOP AT lt_templates INTO lv_template.
      ls_hash-file = recipe( iv_generator = iv_generator iv_template = lv_template ).
      IF iv_generator = 'dsl-dpc'.
        lv_text = lv_template.
        IF lv_text = 'dpc_class'.
          lv_text = 'class'.
        ENDIF.
        lv_text = zcl_osd_dsl_dpc_templates=>get( lv_text ).
      ELSE.
        lv_text = zcl_osd_dsl_mpc=>template_source( lv_template ).
      ENDIF.
      cl_abap_message_digest=>calculate_hash_for_char(
        EXPORTING if_algorithm = 'SHA256' if_data = lv_text
        IMPORTING ef_hashstring = ls_hash-hash ).
      INSERT ls_hash INTO TABLE lt_hashes.
    ENDLOOP.
    LOOP AT lt_hashes INTO ls_hash.
      APPEND `    {"file": "` && zcl_stg_json=>escape( ls_hash-file ) && `", "hash": "sha256:` && to_lower( ls_hash-hash ) && `"}` TO lt_template_parts.
    ENDLOOP.
    rv_json = `{` && lv_nl && `  "format": "osd-trace-meta/1",` && lv_nl
      && `  "generator": "` && zcl_stg_json=>escape( iv_generator ) && `",` && lv_nl
      && `  "generator_version": "0.7",` && lv_nl.
    IF lt_lines IS INITIAL.
      rv_json = rv_json && `  "lines": [],` && lv_nl.
    ELSE.
      rv_json = rv_json && `  "lines": [` && lv_nl
        && concat_lines_of( table = lt_lines sep = ',' && lv_nl ) && lv_nl && `  ],` && lv_nl.
    ENDIF.
    rv_json = rv_json && `  "model": "sha256:` && to_lower( lv_model_hash ) && `",` && lv_nl
      && `  "model_serialization": "existing AJSON/model JSON text",` && lv_nl
      && `  "outputs": [` && lv_nl && `    {"file": "` && zcl_stg_json=>escape( lv_file )
      && `", "hash": "sha256:` && to_lower( lv_output_hash ) && `"}` && lv_nl && `  ],` && lv_nl
      && `  "template": "` && zcl_stg_json=>escape( iv_template ) && `",` && lv_nl.
    IF lt_template_parts IS INITIAL.
      rv_json = rv_json && `  "templates": []` && lv_nl.
    ELSE.
      rv_json = rv_json && `  "templates": [` && lv_nl
        && concat_lines_of( table = lt_template_parts sep = ',' && lv_nl ) && lv_nl && `  ]` && lv_nl.
    ENDIF.
    rv_json = rv_json && `}` && lv_nl.
  ENDMETHOD.
ENDCLASS.
