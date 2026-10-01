"! The streaming factory: a ZCL_OSD_SXML_STREAM_READER over the source as it
"! is, nothing drained.
CLASS zcl_osd_sxml_factory_stream DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_osd_sxml_factory.
ENDCLASS.


CLASS zcl_osd_sxml_factory_stream IMPLEMENTATION.

  METHOD zif_osd_sxml_factory~create.
    ri = zcl_osd_sxml_stream_reader=>create( io_source ).
  ENDMETHOD.

ENDCLASS.
