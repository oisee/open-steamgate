"! An open element (IF_SXML_OPEN_ELEMENT) with its attributes, as
"! ZCL_OSD_SXML_STREAM_READER reads it.
CLASS zcl_osd_sxml_open_element DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_sxml_open_element.
    METHODS constructor
      IMPORTING iv_name       TYPE string
                iv_prefix     TYPE string OPTIONAL
                iv_nsuri      TYPE string OPTIONAL
                it_attributes TYPE if_sxml_attribute=>attributes OPTIONAL.
  PRIVATE SECTION.
    DATA mt_attributes TYPE if_sxml_attribute=>attributes.
ENDCLASS.


CLASS zcl_osd_sxml_open_element IMPLEMENTATION.

  METHOD constructor.
    if_sxml_node~type = if_sxml_node=>co_nt_element_open.
    if_sxml_open_element~qname-name = iv_name.
    if_sxml_open_element~qname-namespace = iv_nsuri.
    if_sxml_open_element~prefix = iv_prefix.
    mt_attributes = it_attributes.
  ENDMETHOD.

  METHOD if_sxml_open_element~get_attributes.
    attr = mt_attributes.
  ENDMETHOD.

  METHOD if_sxml_open_element~get_attribute_value.
* the first attribute of that name and namespace; unbound if there is none
    DATA li_attribute TYPE REF TO if_sxml_attribute.
    DATA lo_value TYPE REF TO zcl_osd_sxml_value.
    DATA lv_value TYPE string.
    LOOP AT mt_attributes INTO li_attribute.
      IF li_attribute->qname-name = name AND li_attribute->qname-namespace = nsuri.
        lv_value = li_attribute->get_value( ).
        CREATE OBJECT lo_value EXPORTING iv_value = lv_value.
        value = lo_value.
        RETURN.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD if_sxml_open_element~set_attribute.
* replaces an attribute of the same name and namespace, else appends
    DATA li_attribute TYPE REF TO if_sxml_attribute.
    DATA lv_index TYPE i.
    CREATE OBJECT attribute TYPE zcl_osd_sxml_attribute
      EXPORTING iv_name   = name
                iv_prefix = prefix
                iv_nsuri  = nsuri
                iv_value  = value.
    LOOP AT mt_attributes INTO li_attribute.
      lv_index = sy-tabix.
      IF li_attribute->qname-name = name AND li_attribute->qname-namespace = nsuri.
        MODIFY mt_attributes FROM attribute INDEX lv_index.
        RETURN.
      ENDIF.
    ENDLOOP.
    APPEND attribute TO mt_attributes.
  ENDMETHOD.

  METHOD if_sxml_open_element~set_attributes.
    mt_attributes = attributes.
  ENDMETHOD.

  METHOD if_sxml_open_element~set_prefix.
    if_sxml_open_element~prefix = prefix.
  ENDMETHOD.

ENDCLASS.
