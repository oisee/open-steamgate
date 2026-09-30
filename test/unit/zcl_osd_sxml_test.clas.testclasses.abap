CLASS ltcl_reader DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS xml_report_path FOR TESTING RAISING cx_static_check.
ENDCLASS.

CLASS ltcl_reader IMPLEMENTATION.
  METHOD xml_report_path.
    DATA reader TYPE REF TO if_sxml_reader.
    DATA node TYPE REF TO if_sxml_node.
    DATA open TYPE REF TO if_sxml_open_element.
    DATA value TYPE REF TO if_sxml_value_node.
    reader = cl_sxml_string_reader=>create( cl_abap_codepage=>convert_to(
      '<doc xmlns="urn:d"><row id="7">A&amp;B</row></doc>' ) ).
    node = reader->read_next_node( ).
    open ?= node.
    cl_abap_unit_assert=>assert_equals( act = open->qname-namespace
                                        exp = 'urn:d' ).
    reader->next_node( ).
    cl_abap_unit_assert=>assert_equals( act = reader->name
                                        exp = 'row' ).
    reader->next_attribute( ).
    cl_abap_unit_assert=>assert_equals( act = reader->value
                                        exp = '7' ).
    node = reader->read_next_node( ).
    value ?= node.
    cl_abap_unit_assert=>assert_equals( act = value->get_value( )
                                        exp = 'A&B' ).
  ENDMETHOD.
ENDCLASS.
