"! Makes an sXML reader over a byte source. The reference implementation
"! drains the source into one xstring (ZCL_OSD_SXML_FACTORY_CONCAT); a
"! streaming reader takes the source as it is. ZCL_OSD_SXML_CONTRACT runs
"! any factory over the same fixtures cut at every byte offset.
INTERFACE zif_osd_sxml_factory PUBLIC.
  METHODS create
    IMPORTING io_source TYPE REF TO zif_osd_byte_source
    RETURNING VALUE(ri) TYPE REF TO if_sxml_reader.
ENDINTERFACE.
