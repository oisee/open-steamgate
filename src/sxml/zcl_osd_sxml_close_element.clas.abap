"! A close element (IF_SXML_CLOSE_ELEMENT), as ZCL_OSD_SXML_STREAM_READER
"! reads it.
CLASS zcl_osd_sxml_close_element DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_sxml_close_element.
    "! the prefix of the element's name
    DATA prefix TYPE string READ-ONLY.
    METHODS constructor
      IMPORTING iv_name   TYPE string
                iv_prefix TYPE string OPTIONAL
                iv_nsuri  TYPE string OPTIONAL.
ENDCLASS.


CLASS zcl_osd_sxml_close_element IMPLEMENTATION.

  METHOD constructor.
    if_sxml_node~type = if_sxml_node=>co_nt_element_close.
    if_sxml_close_element~qname-name = iv_name.
    if_sxml_close_element~qname-namespace = iv_nsuri.
    prefix = iv_prefix.
  ENDMETHOD.

ENDCLASS.
