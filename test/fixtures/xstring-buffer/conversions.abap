REPORT zconversions.
DATA bytes TYPE xstring.
DATA zeros TYPE x LENGTH 65536.
DATA text TYPE string.
DATA decoder TYPE REF TO cl_abap_conv_in_ce.
DATA encoder TYPE REF TO cl_abap_conv_out_ce.
bytes = zeros.
REPLACE SECTION OFFSET 0 LENGTH 1 OF bytes WITH '41' IN BYTE MODE.
decoder = cl_abap_conv_in_ce=>create( encoding = 'UTF-8' ).
decoder->convert( EXPORTING input = bytes IMPORTING data = text ).
WRITE text(1).
encoder = cl_abap_conv_out_ce=>create( encoding = 'UTF-8' ).
encoder->convert( EXPORTING data = text IMPORTING buffer = bytes ).
WRITE bytes(1).
REPLACE SECTION OFFSET 0 LENGTH 1 OF bytes WITH '42' IN BYTE MODE.
decoder = cl_abap_conv_in_ce=>create( encoding = 'UTF-8' input = bytes ).
decoder->read( IMPORTING data = text ).
WRITE text(1).
encoder->write( text ).
bytes = encoder->get_buffer( ).
WRITE bytes(1).
