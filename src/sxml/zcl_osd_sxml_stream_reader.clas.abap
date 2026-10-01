"! IF_SXML_READER over a ZIF_OSD_BYTE_SOURCE: the streaming parser
"! ZCL_OSD_SXML_PULL with the reader's attributes and node objects
"! (ZCL_OSD_SXML_OPEN_ELEMENT, _CLOSE_ELEMENT, _VALUE_NODE, _ATTRIBUTE) on
"! top. It is what the sXML contract runs and what code written against
"! CL_SXML_STRING_READER uses in this repository's runtime.
"!
"! Runtime only: it implements open-abap-core's reduced IF_SXML_* shapes. A
"! system composes those interfaces differently (IF_SXML_NAMED, IF_SXML_VALUE
"! and IF_SXML_NSURI_HELPER come in through INTERFACES and ALIASES) and its
"! IF_SXML_READER has more methods (PUSH_BACK, NEXT_ATTRIBUTE_VALUE,
"! GET_ATTRIBUTE_VALUE, GET_BYTE_OFFSET, GET_OPTION, SET_VSI, GET_VSI), so
"! this class does not activate there. On a system use ZCL_OSD_SXML_PULL
"! directly; it implements no SAP interface.
"!
"! Values: NEXT_NODE with value type 3 (CO_VT_RAW on a system) gives the
"! value base64-decoded in VALUE_RAW, as sXML reads a raw value from XML
"! text; any other value type gives the text in VALUE. A source error
"! (ZCX_OSD_BYTE_SOURCE) passes through unchanged.
CLASS zcl_osd_sxml_stream_reader DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_sxml_reader.

    "! CO_VT_RAW of a system's IF_SXML_VALUE (open-abap-core has only TEXT)
    CONSTANTS c_vt_raw TYPE i VALUE 3.

    "! the parser underneath, for its offset, window and last error
    DATA pull TYPE REF TO zcl_osd_sxml_pull READ-ONLY.

    CLASS-METHODS create
      IMPORTING io_source        TYPE REF TO zif_osd_byte_source
      RETURNING VALUE(ri_reader) TYPE REF TO if_sxml_reader.
    METHODS constructor
      IMPORTING io_source TYPE REF TO zif_osd_byte_source.
  PRIVATE SECTION.
    " the reader's current node, for NEXT_ATTRIBUTE, CURRENT_NODE and
    " READ_CURRENT_NODE
    DATA ms_current TYPE zcl_osd_sxml_pull=>ty_item.
    DATA mv_attr TYPE i.
    METHODS node_of
      IMPORTING is_item        TYPE zcl_osd_sxml_pull=>ty_item
      RETURNING VALUE(ri_node) TYPE REF TO if_sxml_node.
    METHODS take
      IMPORTING is_item       TYPE zcl_osd_sxml_pull=>ty_item
                iv_value_type TYPE i DEFAULT if_sxml_value=>co_vt_text.
    METHODS attributes_of
      IMPORTING is_item         TYPE zcl_osd_sxml_pull=>ty_item
      RETURNING VALUE(rt_attrs) TYPE if_sxml_attribute=>attributes.
ENDCLASS.


CLASS zcl_osd_sxml_stream_reader IMPLEMENTATION.

  METHOD create.
    CREATE OBJECT ri_reader TYPE zcl_osd_sxml_stream_reader
      EXPORTING io_source = io_source.
  ENDMETHOD.

  METHOD constructor.
    CREATE OBJECT pull EXPORTING io_source = io_source.
  ENDMETHOD.

  METHOD attributes_of.
    DATA ls_attribute TYPE zcl_osd_sxml_pull=>ty_attribute.
    DATA li_attribute TYPE REF TO if_sxml_attribute.
    LOOP AT is_item-attrs INTO ls_attribute.
      CREATE OBJECT li_attribute TYPE zcl_osd_sxml_attribute
        EXPORTING iv_name   = ls_attribute-name
                  iv_prefix = ls_attribute-prefix
                  iv_nsuri  = ls_attribute-nsuri
                  iv_value  = ls_attribute-value.
      APPEND li_attribute TO rt_attrs.
    ENDLOOP.
  ENDMETHOD.

  METHOD node_of.
    DATA lo_open TYPE REF TO zcl_osd_sxml_open_element.
    DATA lo_close TYPE REF TO zcl_osd_sxml_close_element.
    DATA lo_value TYPE REF TO zcl_osd_sxml_value_node.
    CASE is_item-kind.
      WHEN zcl_osd_sxml_pull=>c_open.
        CREATE OBJECT lo_open
          EXPORTING iv_name       = is_item-name
                    iv_prefix     = is_item-prefix
                    iv_nsuri      = is_item-nsuri
                    it_attributes = attributes_of( is_item ).
        ri_node = lo_open.
      WHEN zcl_osd_sxml_pull=>c_close.
        CREATE OBJECT lo_close
          EXPORTING iv_name   = is_item-name
                    iv_prefix = is_item-prefix
                    iv_nsuri  = is_item-nsuri.
        ri_node = lo_close.
      WHEN zcl_osd_sxml_pull=>c_value.
        CREATE OBJECT lo_value EXPORTING iv_value = is_item-value.
        ri_node = lo_value.
      WHEN OTHERS.
* the end of the document: no node, as a system answers
        CLEAR ri_node.
    ENDCASE.
  ENDMETHOD.

  METHOD take.
* the reader's attributes after a node; a close element and FINAL leave the
* last value in place, as the ported reader does
    if_sxml_reader~node_type = is_item-kind.
    mv_attr = 0.
    IF is_item-kind = zcl_osd_sxml_pull=>c_final.
      CLEAR ms_current-attrs.
      ms_current-kind = is_item-kind.
      RETURN.
    ENDIF.
    ms_current = is_item.
    if_sxml_reader~name = is_item-name.
    if_sxml_reader~prefix = is_item-prefix.
    if_sxml_reader~nsuri = is_item-nsuri.
    IF is_item-kind = zcl_osd_sxml_pull=>c_value.
      IF iv_value_type = c_vt_raw.
        CLEAR if_sxml_reader~value.
        if_sxml_reader~value_raw = cl_http_utility=>decode_x_base64( is_item-value ).
        if_sxml_reader~value_type = c_vt_raw.
      ELSE.
        if_sxml_reader~value = is_item-value.
        CLEAR if_sxml_reader~value_raw.
        if_sxml_reader~value_type = if_sxml_value=>co_vt_text.
      ENDIF.
    ENDIF.
  ENDMETHOD.

  METHOD if_sxml_reader~next_node.
    take( is_item       = pull->next( )
          iv_value_type = value_type ).
  ENDMETHOD.

  METHOD if_sxml_reader~read_next_node.
    DATA ls_item TYPE zcl_osd_sxml_pull=>ty_item.
    ls_item = pull->next( ).
    take( ls_item ).
    node = node_of( ls_item ).
  ENDMETHOD.

  METHOD if_sxml_reader~next_attribute.
    DATA ls_attribute TYPE zcl_osd_sxml_pull=>ty_attribute.
    mv_attr = mv_attr + 1.
    READ TABLE ms_current-attrs INDEX mv_attr INTO ls_attribute.
    IF sy-subrc = 0.
      if_sxml_reader~node_type = if_sxml_node=>co_nt_attribute.
      if_sxml_reader~name = ls_attribute-name.
      if_sxml_reader~prefix = ls_attribute-prefix.
      if_sxml_reader~nsuri = ls_attribute-nsuri.
      IF value_type = c_vt_raw.
        CLEAR if_sxml_reader~value.
        if_sxml_reader~value_raw = cl_http_utility=>decode_x_base64( ls_attribute-value ).
        if_sxml_reader~value_type = c_vt_raw.
      ELSE.
        if_sxml_reader~value = ls_attribute-value.
        CLEAR if_sxml_reader~value_raw.
        if_sxml_reader~value_type = if_sxml_value=>co_vt_text.
      ENDIF.
    ELSE.
      if_sxml_reader~node_type = if_sxml_node=>co_nt_final.
    ENDIF.
  ENDMETHOD.

  METHOD if_sxml_reader~current_node.
* back to the node itself after its attributes
    DATA ls_item TYPE zcl_osd_sxml_pull=>ty_item.
    ls_item = ms_current.
    take( ls_item ).
  ENDMETHOD.

  METHOD if_sxml_reader~read_current_node.
    IF if_sxml_reader~node_type = if_sxml_node=>co_nt_final.
      RETURN.
    ENDIF.
    node = node_of( ms_current ).
  ENDMETHOD.

  METHOD if_sxml_reader~skip_node.
* the rest of the current element, its close included; copying it to a
* writer is not implemented and raises CX_SXML_STATE_ERROR before anything
* is read
    DATA lv_level TYPE i.
    IF writer IS BOUND.
      RAISE EXCEPTION TYPE cx_sxml_state_error.
    ENDIF.
    IF if_sxml_reader~node_type <> if_sxml_node=>co_nt_element_open.
      RETURN.
    ENDIF.
    lv_level = 1.
    WHILE lv_level > 0.
      if_sxml_reader~next_node( ).
      IF if_sxml_reader~node_type = if_sxml_node=>co_nt_element_open.
        lv_level = lv_level + 1.
      ELSEIF if_sxml_reader~node_type = if_sxml_node=>co_nt_element_close.
        lv_level = lv_level - 1.
      ELSEIF if_sxml_reader~node_type = if_sxml_node=>co_nt_final.
        EXIT.
      ENDIF.
    ENDWHILE.
  ENDMETHOD.

  METHOD if_sxml_reader~set_option.
* CO_OPT_KEEP_WHITESPACE keeps values of white space only; the other
* options change nothing here
    IF option = if_sxml_reader=>co_opt_keep_whitespace.
      pull->set_keep_whitespace( value ).
    ENDIF.
  ENDMETHOD.

  METHOD if_sxml_reader~get_nsuri_by_prefix.
    nsuri = pull->get_nsuri_by_prefix( prefix ).
  ENDMETHOD.

  METHOD if_sxml_reader~get_prefix_by_nsuri.
    prefix = pull->get_prefix_by_nsuri( nsuri ).
  ENDMETHOD.

  METHOD if_sxml_reader~get_nsbindings.
    DATA lt_bindings TYPE zcl_osd_sxml_pull=>ty_nsbindings.
    DATA ls_binding TYPE zcl_osd_sxml_pull=>ty_nsbinding.
    DATA ls_out TYPE if_sxml_named=>nsbinding.
    lt_bindings = pull->get_nsbindings( ).
    LOOP AT lt_bindings INTO ls_binding.
      ls_out-prefix = ls_binding-prefix.
      ls_out-nsuri = ls_binding-nsuri.
      INSERT ls_out INTO TABLE nsbindings.
    ENDLOOP.
  ENDMETHOD.

  METHOD if_sxml_reader~get_path.
    DATA lt_path TYPE zcl_osd_sxml_pull=>ty_path.
    DATA ls_node TYPE zcl_osd_sxml_pull=>ty_pathnode.
    DATA ls_out TYPE if_sxml_named=>pathnode.
    lt_path = pull->get_path( ).
    LOOP AT lt_path INTO ls_node.
      CLEAR ls_out.
      ls_out-qname-name = ls_node-name.
      ls_out-qname-namespace = ls_node-nsuri.
      ls_out-prefix = ls_node-prefix.
      ls_out-child_position = ls_node-child_position.
      APPEND ls_out TO path.
    ENDLOOP.
  ENDMETHOD.

ENDCLASS.
