"! An attribute of an open element, as ZCL_OSD_SXML_STREAM_READER reads it.
CLASS zcl_osd_sxml_attribute DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_sxml_attribute.
    METHODS constructor
      IMPORTING iv_name   TYPE string
                iv_prefix TYPE string OPTIONAL
                iv_nsuri  TYPE string OPTIONAL
                iv_value  TYPE string OPTIONAL.
  PRIVATE SECTION.
    DATA mv_value TYPE string.
ENDCLASS.


CLASS zcl_osd_sxml_attribute IMPLEMENTATION.

  METHOD constructor.
    if_sxml_attribute~qname-name = iv_name.
    if_sxml_attribute~qname-namespace = iv_nsuri.
    if_sxml_attribute~prefix = iv_prefix.
    if_sxml_attribute~value_type = if_sxml_value=>co_vt_text.
    mv_value = iv_value.
  ENDMETHOD.

  METHOD if_sxml_attribute~get_value.
    value = mv_value.
  ENDMETHOD.

ENDCLASS.
