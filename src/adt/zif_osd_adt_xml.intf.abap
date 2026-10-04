"! Expanded names and immediate element text, after whole-document admission.
INTERFACE zif_osd_adt_xml PUBLIC.
  TYPES: BEGIN OF ty_attribute,
           uri TYPE string,
           local TYPE string,
           value TYPE string,
         END OF ty_attribute.
  TYPES tt_attribute TYPE STANDARD TABLE OF ty_attribute WITH DEFAULT KEY.
  TYPES: BEGIN OF ty_element,
           uri TYPE string,
           local TYPE string,
           parent TYPE i,
           text TYPE string,
           attributes TYPE tt_attribute,
         END OF ty_element.
  TYPES tt_element TYPE STANDARD TABLE OF ty_element WITH DEFAULT KEY.
ENDINTERFACE.
