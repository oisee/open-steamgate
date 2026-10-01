"! A value node (IF_SXML_VALUE_NODE), as ZCL_OSD_SXML_STREAM_READER reads it.
"! The raw form is the value in UTF-8.
CLASS zcl_osd_sxml_value_node DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_sxml_value_node.
    METHODS constructor
      IMPORTING iv_value TYPE string OPTIONAL.
  PRIVATE SECTION.
    DATA mv_value TYPE string.
ENDCLASS.


CLASS zcl_osd_sxml_value_node IMPLEMENTATION.

  METHOD constructor.
    if_sxml_node~type = if_sxml_node=>co_nt_value.
    mv_value = iv_value.
  ENDMETHOD.

  METHOD if_sxml_value_node~get_value.
    value = mv_value.
  ENDMETHOD.

  METHOD if_sxml_value_node~get_value_raw.
    value = cl_abap_codepage=>convert_to( mv_value ).
  ENDMETHOD.

  METHOD if_sxml_value_node~set_value.
    mv_value = value.
  ENDMETHOD.

  METHOD if_sxml_value_node~set_value_raw.
    mv_value = cl_abap_codepage=>convert_from( value ).
  ENDMETHOD.

ENDCLASS.
