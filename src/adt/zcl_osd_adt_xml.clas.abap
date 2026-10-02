"! XML text for the ADT documents, escaped the way the Node facade escapes
"! it (tools/adt-documents.mjs, xmlEscape): ampersand first, then less-than,
"! greater-than and the double quote. No apostrophe, because every attribute
"! here is written in double quotes. Not cl_http_utility=>escape_xml_attr_value,
"! which is a stub in open-abap-core (port-map.md, section 2).
CLASS zcl_osd_adt_xml DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS esc
      IMPORTING iv_text        TYPE string
      RETURNING VALUE(rv_text) TYPE string.
ENDCLASS.

CLASS zcl_osd_adt_xml IMPLEMENTATION.

  METHOD esc.
    rv_text = iv_text.
    REPLACE ALL OCCURRENCES OF `&` IN rv_text WITH `&amp;`.
    REPLACE ALL OCCURRENCES OF `<` IN rv_text WITH `&lt;`.
    REPLACE ALL OCCURRENCES OF `>` IN rv_text WITH `&gt;`.
    REPLACE ALL OCCURRENCES OF `"` IN rv_text WITH `&quot;`.
  ENDMETHOD.

ENDCLASS.
