"! A text value standing alone (IF_SXML_VALUE), as GET_ATTRIBUTE_VALUE of
"! ZCL_OSD_SXML_OPEN_ELEMENT answers it. The raw form is the value in UTF-8.
CLASS zcl_osd_sxml_value DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_sxml_value.
    METHODS constructor
      IMPORTING iv_value TYPE string OPTIONAL.
  PRIVATE SECTION.
    DATA mv_value TYPE string.
ENDCLASS.


CLASS zcl_osd_sxml_value IMPLEMENTATION.

  METHOD constructor.
    if_sxml_value~type = if_sxml_value=>co_vt_text.
    mv_value = iv_value.
  ENDMETHOD.

  METHOD if_sxml_value~get_value.
    value = mv_value.
  ENDMETHOD.

  METHOD if_sxml_value~get_value_raw.
    value = cl_abap_codepage=>convert_to( mv_value ).
  ENDMETHOD.

  METHOD if_sxml_value~set_value.
    mv_value = value.
  ENDMETHOD.

  METHOD if_sxml_value~set_value_raw.
    mv_value = cl_abap_codepage=>convert_from( value ).
  ENDMETHOD.

ENDCLASS.
