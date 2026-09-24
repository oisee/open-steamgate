CLASS zcl_gogen_t_zip DEFINITION PUBLIC FINAL CREATE PUBLIC.
* cl_abap_zip=>save of two files (the SEGW RepoSet zip): the frame of the
* archive (local header, end of central directory, the entry count, the
* names), the CRC-32, and SHIFT LEFT CIRCULAR IN BYTE MODE (the little-
* endian int2 of the local class). The entries' bytes are the encoder's
* and are not pinned. LOAD is not here: open-abap-core's LCL_STREAM=>
* READ_INT4 multiplies its factor past i (ANOMALY-2026-09-25-zip-read-int4)
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_zip IMPLEMENTATION.
  METHOD run.
    DATA lo_zip TYPE REF TO cl_abap_zip.
    DATA lv_a TYPE xstring.
    DATA lv_b TYPE xstring.
    DATA lv_zip TYPE xstring.
    DATA lv_len TYPE i.
    DATA lv_off TYPE i.
    DATA lv_head TYPE xstring.
    DATA lv_tail TYPE xstring.
    DATA lv_count TYPE xstring.
    DATA lv_text TYPE string.
    DATA lv_name TYPE xstring.
    DATA lv_h2 TYPE x LENGTH 2.
    DATA lv_h4 TYPE x LENGTH 4.

    lv_h2 = 'AABB'.
    SHIFT lv_h2 LEFT CIRCULAR IN BYTE MODE.
    lv_h4 = '01020304'.
    SHIFT lv_h4 LEFT CIRCULAR IN BYTE MODE.
    rv = |shift:{ lv_h2 }/{ lv_h4 }|.

    DO 50 TIMES.
      lv_text = |{ lv_text }hello |.
    ENDDO.
    lv_a = cl_abap_codepage=>convert_to( lv_text ).
    lv_b = '00FF10203040'.
    CREATE OBJECT lo_zip.
    lo_zip->add( name = 'a.txt' content = lv_a ).
    lo_zip->add( name = 'dir/b.bin' content = lv_b ).
    lv_zip = lo_zip->save( ).
    lv_len = xstrlen( lv_zip ).
    lv_head = lv_zip(4).
    lv_off = lv_len - 22.
    lv_tail = lv_zip+lv_off(4).
    lv_off = lv_len - 12.
    lv_count = lv_zip+lv_off(2).
    rv = |{ rv } head:{ lv_head } eocd:{ lv_tail } entries:{ lv_count }|.
* the first local header's name, at its offset 30
    lv_name = lv_zip+30(5).
    rv = |{ rv } name:{ lv_name }|.
    rv = |{ rv } crc:{ cl_abap_zip=>crc32( lv_b ) }|.
  ENDMETHOD.
ENDCLASS.
