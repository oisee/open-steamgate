CLASS ltcl_test DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.
PRIVATE SECTION.
METHODS len FOR TESTING.
METHODS section FOR TESTING.
METHODS write_section FOR TESTING.
METHODS shift_places FOR TESTING.
METHODS find_offset FOR TESTING.
METHODS half_roundtrip FOR TESTING.
METHODS numofchar_units FOR TESTING.
METHODS concat_pair FOR TESTING.
METHODS concat_cs FOR TESTING.
METHODS search_half FOR TESTING.
METHODS case_find FOR TESTING.
METHODS json_escape FOR TESTING.
METHODS supplementary_fold FOR TESTING.
METHODS join_keys FOR TESTING.
METHODS join_hash FOR TESTING.
METHODS join_template FOR TESTING.
METHODS join_loop FOR TESTING.
METHODS join_replace FOR TESTING.
METHODS egress_pair FOR TESTING.
METHODS binary_body FOR TESTING.
METHODS half_operators FOR TESTING.
METHODS half_ignore_case FOR TESTING.
METHODS json_half_parse FOR TESTING.
METHODS egress_apc FOR TESTING.
METHODS condense_no_gaps FOR TESTING.
ENDCLASS.
CLASS ltcl_test IMPLEMENTATION.
METHOD len.
DATA(s) = zcl_osgt_strlen16=>emoji( ).
cl_abap_unit_assert=>assert_equals( act = strlen( s ) exp = 3 msg = `strlen of U+1F600 followed by A` ).
ENDMETHOD.
METHOD section.
DATA(s) = zcl_osgt_strlen16=>emoji( ).
DATA(last) = s+2(1).
cl_abap_unit_assert=>assert_equals( act = last exp = `A` msg = `offset 2 is the A after the surrogate pair` ).
ENDMETHOD.
METHOD write_section.
DATA(s) = zcl_osgt_strlen16=>emoji( ).
DATA c TYPE c LENGTH 3.
c = s.
c+2(1) = `B`.
cl_abap_unit_assert=>assert_equals( act = c+2(1) exp = `B` ).
cl_abap_unit_assert=>assert_equals( act = strlen( c ) exp = 3 ).
ENDMETHOD.
METHOD shift_places.
DATA(s) = zcl_osgt_strlen16=>emoji( ).
SHIFT s BY 2 PLACES LEFT.
cl_abap_unit_assert=>assert_equals( act = s exp = `A` ).
ENDMETHOD.
METHOD find_offset.
DATA(s) = zcl_osgt_strlen16=>emoji( ).
DATA off TYPE i.
DATA len TYPE i.
FIND `A` IN s MATCH OFFSET off MATCH LENGTH len.
cl_abap_unit_assert=>assert_equals( act = off exp = 2 ).
cl_abap_unit_assert=>assert_equals( act = len exp = 1 ).
cl_abap_unit_assert=>assert_equals( act = find( val = s sub = `A` off = 1 ) exp = 2 ).
ENDMETHOD.
METHOD half_roundtrip.
DATA(s) = zcl_osgt_strlen16=>emoji( ).
DATA pair TYPE string.
pair = s+0(1).
DATA(hi) = s+0(1).
cl_abap_unit_assert=>assert_equals( act = strlen( hi ) exp = 1 ).
DATA c TYPE c LENGTH 3.
c = s.
c+0(1) = hi.
s = c.
cl_abap_unit_assert=>assert_equals( act = s exp = zcl_osgt_strlen16=>emoji( ) ).
ENDMETHOD.
METHOD numofchar_units.
DATA(s) = zcl_osgt_strlen16=>emoji( ) && `  `.
cl_abap_unit_assert=>assert_equals( act = numofchar( s ) exp = 3 ).
ENDMETHOD.
METHOD concat_pair.
DATA(s) = zcl_osgt_strlen16=>emoji( ).
DATA(hi) = s+0(1).
DATA(lo) = s+1(1).
CONCATENATE hi lo INTO DATA(r).
cl_abap_unit_assert=>assert_equals( act = strlen( r ) exp = 2 ).
cl_abap_unit_assert=>assert_equals( act = cl_abap_codepage=>convert_to( r )
  exp = CONV xstring( 'F09F9880' ) ).
ENDMETHOD.
METHOD search_half.
DATA(s) = zcl_osgt_strlen16=>emoji( ).
DATA(lo) = s+1(1).
DATA(count) = 0.
FIND ALL OCCURRENCES OF lo IN s MATCH COUNT count.
cl_abap_unit_assert=>assert_equals( act = count exp = 1 ).
REPLACE lo IN s WITH `X`.
cl_abap_unit_assert=>assert_equals( act = cl_abap_codepage=>convert_to( s )
  exp = CONV xstring( 'EDA0BD5841' ) ).
ENDMETHOD.
METHOD case_find.
DATA(s) = zcl_osgt_strlen16=>emoji( ).
DATA(hi) = s+0(1).
CONCATENATE hi `A` INTO s.
DATA(off) = -1.
FIND `a` IN s IGNORING CASE MATCH OFFSET off.
cl_abap_unit_assert=>assert_equals( act = off exp = 1 ).
ENDMETHOD.
METHOD json_escape.
DATA(s) = zcl_osgt_strlen16=>emoji( ).
DATA(hi) = s+0(1).
DATA(lo) = s+1(1).
CONCATENATE hi lo INTO DATA(pair).
cl_abap_unit_assert=>assert_equals(
  act = escape( val = hi format = cl_abap_format=>e_json_string )
  exp = `\uD83D` ).
cl_abap_unit_assert=>assert_equals(
  act = escape( val = pair format = cl_abap_format=>e_json_string )
  exp = cl_abap_codepage=>convert_from( source = CONV xstring( 'F09F9880' )
    codepage = `UTF-8` ) ).
ENDMETHOD.
METHOD concat_cs.
DATA(s) = zcl_osgt_strlen16=>emoji( ).
DATA(hi) = s+0(1).
DATA(lo) = s+1(1).
CONCATENATE hi lo INTO DATA(r).
DATA expected TYPE string.
expected = cl_abap_codepage=>convert_from( source = CONV xstring( 'F09F9880' )
  codepage = `UTF-8` ).
IF r CS expected.
  cl_abap_unit_assert=>assert_equals( act = 1 exp = 1 ).
ELSE.
  cl_abap_unit_assert=>fail( ).
ENDIF.
ENDMETHOD.
METHOD supplementary_fold.
DATA(s) = cl_abap_codepage=>convert_from( source = CONV xstring( 'F09090A8ED8080' ) ).
DATA(expected) = cl_abap_codepage=>convert_from( source = CONV xstring( 'F0909080ED8080' ) ).
cl_abap_unit_assert=>assert_equals( act = to_upper( s ) exp = expected ).
ENDMETHOD.
METHOD join_keys.
DATA(s) = zcl_osgt_strlen16=>emoji( ).
DATA(hi) = s+0(1).
DATA(lo) = s+1(1).
DATA(emoji) = s+0(2).
DATA(r) = hi && lo.
IF r <> emoji.
 cl_abap_unit_assert=>fail( msg = `raw equality after &&` ).
ENDIF.
ENDMETHOD.
METHOD join_hash.
DATA(s) = zcl_osgt_strlen16=>emoji( ).
DATA(hi) = s+0(1).
DATA(lo) = s+1(1).
DATA(emoji) = s+0(2).
DATA(r) = hi && lo.
TYPES: BEGIN OF ty_row, value TYPE string, END OF ty_row.
DATA keys TYPE HASHED TABLE OF ty_row WITH UNIQUE KEY value.
DATA row TYPE ty_row.
row-value = r.
INSERT row INTO TABLE keys.
row-value = emoji.
INSERT row INTO TABLE keys.
cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 4 ).
cl_abap_unit_assert=>assert_equals( act = lines( keys ) exp = 1 ).
ENDMETHOD.
METHOD join_template.
DATA(s) = zcl_osgt_strlen16=>emoji( ).
DATA(hi) = s+0(1).
DATA(lo) = s+1(1).
DATA(emoji) = s+0(2).
DATA(r) = |{ hi }{ lo }|.
cl_abap_unit_assert=>assert_equals( act = r exp = emoji ).
DATA lines TYPE STANDARD TABLE OF string WITH DEFAULT KEY.
APPEND hi TO lines.
APPEND lo TO lines.
r = concat_lines_of( table = lines ).
cl_abap_unit_assert=>assert_equals( act = r exp = emoji ).
ENDMETHOD.
METHOD join_loop.
DATA(s) = zcl_osgt_strlen16=>emoji( ).
DATA(hi) = s+0(1).
DATA(lo) = s+1(1).
DATA(emoji) = s+0(2).
DATA r TYPE string.
r = hi.
DO 1 TIMES.
 r = r && lo.
ENDDO.
cl_abap_unit_assert=>assert_equals( act = r exp = emoji ).
ENDMETHOD.
METHOD join_replace.
DATA(s) = zcl_osgt_strlen16=>emoji( ).
DATA(hi) = s+0(1).
DATA(lo) = s+1(1).
DATA(emoji) = s+0(2).
DATA(r) = hi && `X` && lo.
r = replace( val = r sub = `X` with = `` ).
cl_abap_unit_assert=>assert_equals( act = r exp = emoji ).
ENDMETHOD.
METHOD egress_pair.
DATA(s) = zcl_osgt_strlen16=>emoji( ).
DATA(hi) = s+0(1).
DATA(lo) = s+1(1).
DATA(emoji) = s+0(2).
DATA(r) = hi && lo.
DATA entity TYPE REF TO if_http_response.
CREATE OBJECT entity TYPE cl_http_entity.
entity->set_cdata( r ).
cl_abap_unit_assert=>assert_equals( act = entity->get_data( ) exp = CONV xstring( 'F09F9880' ) ).
ENDMETHOD.
METHOD binary_body.
DATA entity TYPE REF TO if_http_response.
CREATE OBJECT entity TYPE cl_http_entity.
entity->set_data( CONV xstring( 'ED00FF' ) ).
cl_abap_unit_assert=>assert_equals( act = entity->get_data( ) exp = CONV xstring( 'ED00FF' ) ).
ENDMETHOD.
METHOD half_operators.
DATA(s) = zcl_osgt_strlen16=>emoji( ).
DATA(hi) = s+0(1).
DATA(lo) = s+1(1).
DATA(emoji) = s+0(2).
DATA(r) = hi && `A`.
IF r CS `a`.
 cl_abap_unit_assert=>assert_equals( act = sy-fdpos exp = 1 ).
ELSE.
 cl_abap_unit_assert=>fail( ).
ENDIF.
IF r NS `b`.
 cl_abap_unit_assert=>assert_equals( act = sy-fdpos exp = 2 ).
ELSE.
 cl_abap_unit_assert=>fail( ).
ENDIF.
IF r CP `+a`.
 cl_abap_unit_assert=>assert_equals( act = 1 exp = 1 ).
ELSE.
 cl_abap_unit_assert=>fail( msg = `CP half wildcard` ).
ENDIF.
ENDMETHOD.
METHOD half_ignore_case.
DATA(s) = zcl_osgt_strlen16=>emoji( ).
DATA(hi) = s+0(1).
DATA(lo) = s+1(1).
DATA(emoji) = s+0(2).
DATA(count) = 0.
FIND ALL OCCURRENCES OF lo IN s IGNORING CASE MATCH COUNT count.
cl_abap_unit_assert=>assert_equals( act = count exp = 1 ).
DATA results TYPE match_result_tab.
FIND ALL OCCURRENCES OF lo IN s IGNORING CASE RESULTS results.
cl_abap_unit_assert=>assert_equals( act = lines( results ) exp = 1 ).
READ TABLE results INDEX 1 INTO DATA(result).
cl_abap_unit_assert=>assert_equals( act = result-offset exp = 1 ).
REPLACE lo IN s WITH `X` IGNORING CASE.
cl_abap_unit_assert=>assert_equals( act = sy-subrc exp = 0 ).
cl_abap_unit_assert=>assert_equals( act = s exp = hi && `XA` ).
ENDMETHOD.
METHOD json_half_parse.
DATA(s) = zcl_osgt_strlen16=>emoji( ).
DATA(hi) = s+0(1).
DATA(lo) = s+1(1).
DATA(emoji) = s+0(2).
DATA reader TYPE REF TO if_sxml_reader.
DATA node TYPE REF TO if_sxml_node.
DATA val TYPE REF TO if_sxml_value_node.
DATA(json) = `"` && escape( val = hi format = cl_abap_format=>e_json_string ) && `"`.
reader = cl_sxml_string_reader=>create( cl_abap_codepage=>convert_to( json ) ).
node = reader->read_next_node( ).
node = reader->read_next_node( ).
val ?= node.
cl_abap_unit_assert=>assert_equals( act = val->get_value( ) exp = hi ).
reader = cl_sxml_string_reader=>create( cl_abap_codepage=>convert_to( `"\uD83D\uDE00"` ) ).
node = reader->read_next_node( ).
node = reader->read_next_node( ).
val ?= node.
cl_abap_unit_assert=>assert_equals( act = val->get_value( ) exp = emoji ).
ENDMETHOD.
METHOD egress_apc.
DATA(s) = zcl_osgt_strlen16=>emoji( ).
DATA(hi) = s+0(1).
DATA(lo) = s+1(1).
DATA(emoji) = s+0(2).
DATA msg TYPE REF TO if_apc_wsp_message.
CREATE OBJECT msg TYPE zcl_apc_message.
msg->set_text( hi && lo ).
cl_abap_unit_assert=>assert_equals( act = msg->get_text( ) exp = emoji ).
cl_abap_unit_assert=>assert_equals( act = msg->get_binary( ) exp = CONV xstring( 'F09F9880' ) ).
ENDMETHOD.
METHOD condense_no_gaps.
DATA(s) = zcl_osgt_strlen16=>emoji( ).
DATA(hi) = s+0(1).
DATA(lo) = s+1(1).
DATA r TYPE string.
r = |{ hi } { lo }|.
CONDENSE r NO-GAPS.
DATA(emoji) = s+0(2).
IF r <> emoji.
  cl_abap_unit_assert=>fail( ).
ENDIF.
ENDMETHOD.
ENDCLASS.
