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
METHODS search_half FOR TESTING.
METHODS case_find FOR TESTING.
METHODS json_escape FOR TESTING.
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
ENDCLASS.
