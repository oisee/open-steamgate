* Fixture: a zip written by Python's zipfile (1781 bytes, comment "hello"):
*   a.txt  deflate  10892 -> 1145  the 2026-09-30 X2 probe text
*   dir/   stored   0              a directory entry
*   b.bin  stored   256            the bytes 00..FF
*   u-umlaut.txt deflate 7 -> 9    UTF-8 name (flag 0800), "gruesse" in UTF-8
* CRC-32 of the text 8FA2F233 and of 00..FF 29058C73 are zlib's.
CLASS ltcl_zip DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS crc32_values FOR TESTING RAISING cx_static_check.
    METHODS directory FOR TESTING RAISING cx_static_check.
    METHODS deflate_entry FOR TESTING RAISING cx_static_check.
    METHODS deflate_in_pieces FOR TESTING RAISING cx_static_check.
    METHODS stored_entry FOR TESTING RAISING cx_static_check.
    METHODS utf8_name FOR TESTING RAISING cx_static_check.
    METHODS damaged_entry FOR TESTING RAISING cx_static_check.
    METHODS missing_entry FOR TESTING RAISING cx_static_check.
    METHODS not_a_zip FOR TESTING RAISING cx_static_check.
    METHODS dataset_source FOR TESTING RAISING cx_static_check.
    METHODS reader
      IMPORTING iv_data          TYPE xstring
      RETURNING VALUE(ro_reader) TYPE REF TO zcl_osd_zip_reader
      RAISING   zcx_osd_zip.
    METHODS text RETURNING VALUE(rv_raw) TYPE xstring.
    METHODS all_bytes RETURNING VALUE(rv_raw) TYPE xstring.
    METHODS zip RETURNING VALUE(rv_data) TYPE xstring.
ENDCLASS.

CLASS ltcl_zip IMPLEMENTATION.
  METHOD reader.
    DATA lo_source TYPE REF TO zcl_osd_zip_source_x.
    CREATE OBJECT lo_source EXPORTING iv_data = iv_data.
    CREATE OBJECT ro_reader EXPORTING io_source = lo_source.
  ENDMETHOD.

  METHOD text.
    DATA lv_text TYPE string.
    DATA lv_n TYPE string.
    DO 500 TIMES.
      lv_n = sy-index.
      CONDENSE lv_n.
      CONCATENATE lv_text 'line ' lv_n ' of the probe;' INTO lv_text RESPECTING BLANKS.
    ENDDO.
    rv_raw = cl_abap_codepage=>convert_to( lv_text ).
  ENDMETHOD.

  METHOD all_bytes.
    DATA lv_x TYPE x LENGTH 1.
    DATA lv_i TYPE i.
    DO 256 TIMES.
      lv_i = sy-index - 1.
      lv_x = lv_i.
      CONCATENATE rv_raw lv_x INTO rv_raw IN BYTE MODE.
    ENDDO.
  ENDMETHOD.

  METHOD crc32_values.
    DATA lo_crc TYPE REF TO zcl_osd_crc32.
    DATA lv_text TYPE xstring.
    DATA lv_part TYPE xstring.
    DATA lv_exp TYPE zcl_osd_crc32=>ty_crc.
    lv_exp = '8FA2F233'.
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_crc32=>of( text( ) ) exp = lv_exp ).
    lv_exp = '29058C73'.
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_crc32=>of( all_bytes( ) ) exp = lv_exp ).
    lv_exp = '00000000'.
    CLEAR lv_text.
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_crc32=>of( lv_text ) exp = lv_exp ).
    " in pieces: the same as at once
    lv_text = text( ).
    CREATE OBJECT lo_crc.
    lv_part = lv_text(5000).
    lo_crc->update( lv_part ).
    lv_part = lv_text+5000.
    lo_crc->update( lv_part ).
    lv_exp = '8FA2F233'.
    cl_abap_unit_assert=>assert_equals( act = lo_crc->value( ) exp = lv_exp ).
  ENDMETHOD.

  METHOD directory.
    DATA lt_entries TYPE zcl_osd_zip_reader=>tt_entry.
    DATA ls_entry TYPE zcl_osd_zip_reader=>ty_entry.
    DATA lo_zip TYPE REF TO zcl_osd_zip_reader.
    lo_zip = reader( zip( ) ).
    lt_entries = lo_zip->get_entries( ).
    cl_abap_unit_assert=>assert_equals( act = lines( lt_entries ) exp = 4 ).
    READ TABLE lt_entries INTO ls_entry INDEX 1.
    cl_abap_unit_assert=>assert_equals( act = ls_entry-name exp = `a.txt` ).
    cl_abap_unit_assert=>assert_equals( act = ls_entry-method exp = 8 ).
    cl_abap_unit_assert=>assert_equals( act = ls_entry-size exp = 10892 ).
    cl_abap_unit_assert=>assert_equals( act = ls_entry-compressed_size exp = 1145 ).
    READ TABLE lt_entries INTO ls_entry INDEX 2.
    cl_abap_unit_assert=>assert_equals( act = ls_entry-name exp = `dir/` ).
    cl_abap_unit_assert=>assert_true( ls_entry-is_directory ).
    READ TABLE lt_entries INTO ls_entry INDEX 3.
    cl_abap_unit_assert=>assert_equals( act = ls_entry-name exp = `b.bin` ).
    cl_abap_unit_assert=>assert_equals( act = ls_entry-method exp = 0 ).
    cl_abap_unit_assert=>assert_equals( act = ls_entry-header_offset exp = 1214 ).
    cl_abap_unit_assert=>assert_equals( act = lo_zip->get_comment( ) exp = `hello` ).
  ENDMETHOD.

  METHOD deflate_entry.
    cl_abap_unit_assert=>assert_equals( act = reader( zip( ) )->read_all( `a.txt` ) exp = text( ) ).
  ENDMETHOD.

  METHOD deflate_in_pieces.
    DATA lo_zip TYPE REF TO zcl_osd_zip_reader.
    DATA lv_piece TYPE xstring.
    DATA lv_all TYPE xstring.
    DATA lv_reads TYPE i.
    lo_zip = reader( zip( ) ).
    lo_zip->open( `a.txt` ).
    WHILE lo_zip->is_eof( ) = abap_false.
      lv_piece = lo_zip->read( 100 ).
      CONCATENATE lv_all lv_piece INTO lv_all IN BYTE MODE.
      lv_reads = lv_reads + 1.
    ENDWHILE.
    cl_abap_unit_assert=>assert_equals( act = lv_reads exp = 12 ).
    cl_abap_unit_assert=>assert_equals( act = lv_all exp = text( ) ).
    " a second entry after the first, from the same reader
    cl_abap_unit_assert=>assert_equals( act = lo_zip->read_all( `b.bin` ) exp = all_bytes( ) ).
  ENDMETHOD.

  METHOD stored_entry.
    DATA lo_zip TYPE REF TO zcl_osd_zip_reader.
    DATA lv_empty TYPE xstring.
    lo_zip = reader( zip( ) ).
    cl_abap_unit_assert=>assert_equals( act = lo_zip->read_all( `b.bin` ) exp = all_bytes( ) ).
    cl_abap_unit_assert=>assert_equals( act = lo_zip->read_all( `dir/` ) exp = lv_empty ).
  ENDMETHOD.

  METHOD utf8_name.
    DATA lt_entries TYPE zcl_osd_zip_reader=>tt_entry.
    DATA ls_entry TYPE zcl_osd_zip_reader=>ty_entry.
    DATA lv_exp TYPE xstring.
    DATA lo_zip TYPE REF TO zcl_osd_zip_reader.
    lo_zip = reader( zip( ) ).
    lt_entries = lo_zip->get_entries( ).
    READ TABLE lt_entries INTO ls_entry INDEX 4.
    lv_exp = 'C3BC2E747874'.
    cl_abap_unit_assert=>assert_equals( act = cl_abap_codepage=>convert_to( ls_entry-name ) exp = lv_exp ).
    lv_exp = '6772C3BCC39F65'.
    cl_abap_unit_assert=>assert_equals( act = lo_zip->read_all( ls_entry-name ) exp = lv_exp ).
  ENDMETHOD.

  METHOD damaged_entry.
* one byte of b.bin's stored data flipped (data at 1214 + 30 + 5 = 1249)
    DATA lv_zip TYPE xstring.
    DATA lv_head TYPE xstring.
    DATA lv_tail TYPE xstring.
    DATA lv_bad TYPE x LENGTH 1 VALUE 'FF'.
    DATA lx_error TYPE REF TO zcx_osd_zip.
    lv_zip = zip( ).
    lv_head = lv_zip(1249).
    lv_tail = lv_zip+1250.
    CONCATENATE lv_head lv_bad lv_tail INTO lv_zip IN BYTE MODE.
    TRY.
        reader( lv_zip )->read_all( `b.bin` ).
        cl_abap_unit_assert=>fail( 'a damaged entry must not read clean' ).
      CATCH zcx_osd_zip INTO lx_error.
        cl_abap_unit_assert=>assert_equals( act = lx_error->reason exp = `b.bin: CRC-32 does not match` ).
    ENDTRY.
  ENDMETHOD.

  METHOD missing_entry.
    TRY.
        reader( zip( ) )->open( `nope` ).
        cl_abap_unit_assert=>fail( 'a missing entry must not open' ).
      CATCH zcx_osd_zip.
    ENDTRY.
  ENDMETHOD.

  METHOD dataset_source.
* the archive written with TRANSFER and read back through OPEN DATASET, in
* 100-byte pieces; needs a dataset write root (OSD_DATASET_WRITE on this
* runtime), and a run without one has nothing to test here
    DATA lv_file TYPE string VALUE `osd_zip_test.zip`.
    DATA lv_message TYPE string.
    DATA lo_source TYPE REF TO zcl_osd_zip_source_dataset.
    DATA lo_zip TYPE REF TO zcl_osd_zip_reader.
    DATA lv_piece TYPE xstring.
    DATA lv_all TYPE xstring.
    OPEN DATASET lv_file FOR OUTPUT IN BINARY MODE MESSAGE lv_message.
    IF sy-subrc <> 0.
      RETURN.
    ENDIF.
    TRANSFER zip( ) TO lv_file.
    CLOSE DATASET lv_file.
    CREATE OBJECT lo_source EXPORTING iv_file = lv_file.
    cl_abap_unit_assert=>assert_equals( act = lo_source->zif_osd_zip_source~size( ) exp = 1781 ).
    CREATE OBJECT lo_zip EXPORTING io_source = lo_source.
    lo_zip->open( `a.txt` ).
    WHILE lo_zip->is_eof( ) = abap_false.
      lv_piece = lo_zip->read( 100 ).
      CONCATENATE lv_all lv_piece INTO lv_all IN BYTE MODE.
    ENDWHILE.
    lo_source->close( ).
    DELETE DATASET lv_file.
    cl_abap_unit_assert=>assert_equals( act = lv_all exp = text( ) ).
  ENDMETHOD.

  METHOD not_a_zip.
    TRY.
        reader( text( ) ).
        cl_abap_unit_assert=>fail( 'text is not a zip' ).
      CATCH zcx_osd_zip.
    ENDTRY.
  ENDMETHOD.

  METHOD zip.
    DATA lv_hex TYPE string.
    CONCATENATE
      '504B030414000000080000603E5D33F2A28F790400008C2A000005000000612E74787475DA4BAAA4C91184D1ADD412D2CD2C5FF46E1AAA91A0510BA1FD23346D4E4D7DF671F3FE7E88883FFFF9AF9F3FEEC75F7FFCF8EF3F7EFEF8F77FFEFAFDE76F7FFE'
      '7F16CC8AD9307B62F6C2EC8DD907B32F66F7D05025A79453CB29E65473CA39F59C824E455151F8B7515154141545455151541415454555515554FEDC54541555455551555415554553D15434158DFF412A9A8AA6A2A9682A9A8A9E2A7AAAE8A9A2A78A9E'
      'FC28A8E8A9A2A78A9E2A7AAAE8A5A2978A5E2A7AA9E8A5A217BF732A7AA9E8A5A2978ADE2A7AABE8ADA2B78ADE2A7AABE8CD4FB78ADE2A7AABE8A3A28F8A3E2AFAA8E8A3A28F8A3E2AFA701BA9E8A3A2AF8ABE2AFAAAE8ABA2AF8ABE2AFAAAE8ABA22F17'
      'AC372C57EC833BF6C125FBE0967D70CD3EB8671F5CB40F6EDA0757ED836DBFE003DB0C080BC284B0218C082BC28CA0238E90384AE24889A3258E98386AE2C889A3278EA0388AE2488AA3298EA838AAE2C88AA32B8EB038CAE2488BA32D8EB838EAE2C88B'
      'A32F8EC0380AE3488CA3318EC8382AE3C88CA3338ED0384AE3488DA3358ED8386AE3C88DA3378EE0388AE3488EA3398EE838AAE3C88EA33B8EF038CAE3488FA33D8EF838EAE3C88FA33F8E00390AE44890A3418E08392AE4C890A3438E10394AE44891A3'
      '458E18396AE4C891A3478E20398AE44892A3498E2839AAE4C892A34B4297842E095D12BA247449E892D025A14B4297842E095D12BA247449E892D025A14B4297842E095D129F6FF880E317271C6CF319870F397CCAE1630E9F73F8A0832E095D12BA2474'
      '49E892D025A14B4297842E095D12BA247449E892D025A14B4297842E095D12BA247449E892D025A14B4297842E095D12BA247449E892D025A14B4297842E095D12BA247449E892D025A14B4297842E095D12BA247449E892D025A14B4297842E095D12BA'
      '247449E892D025A14B4297842E095D12BA247449E892D025A14B4297842E095D12BA247449E892D025A14B4A97942E295D52BAA47449E992D225A54B4A97942E295D52BAA47449E992D225A54B4A97942E295D52BAA47449E992D225A54B4A97942E295D'
      '52BAA474497D03E32B18DFC1FCE212866DBE86F13D8C2F627C13E3AB18BAA47449E992D225A54B4A97942E295D52BAA47449E992D225A54B4A97942E295D52BAA47449E992D225A54B4A97942E295D52BAA47449E992D225A54B4A97942E295D52BAA474'
      '49E992D225A54B4A97942E295D52BAA47449E992D225A54B4A97942E295D52BAA47449E992D225A54B4A97942E295D52BAA47449E992D225A54B46978C2E195D32BA6474C9E892D125A34B46978C2E195D32BA6474C9E892D125A34B46978C2E195D32BA'
      '6474C9E892D125A34B46978C2E195D32BA6474C9E892D125A34B46978C2E195D32BA6474C9E892D125F31B113F12F12B113F13F9C53B11B6F9A5889F8AF8AD881F8BD025A34B46978C2E195D32BA6474C9E892D125A34B46978C2E195D32BA6474C9E892'
      'D125A34B46978C2E195D32BA6474C9E892D125A34B46978C2E195D32BA6474C9E892D125A34B46978C2E195D32BA6474C9E892D125A34B46978C2E195D32BA6474C9E892D125A34B46973CFFEE92FF01504B030414000000000000603E5D000000000000'
      '000000000000040000006469722F504B030414000000000000603E5D738C0529000100000001000005000000622E62696E000102030405060708090A0B0C0D0E0F101112131415161718191A1B1C1D1E1F202122232425262728292A2B2C2D2E2F303132'
      '333435363738393A3B3C3D3E3F404142434445464748494A4B4C4D4E4F505152535455565758595A5B5C5D5E5F606162636465666768696A6B6C6D6E6F707172737475767778797A7B7C7D7E7F808182838485868788898A8B8C8D8E8F90919293949596'
      '9798999A9B9C9D9E9FA0A1A2A3A4A5A6A7A8A9AAABACADAEAFB0B1B2B3B4B5B6B7B8B9BABBBCBDBEBFC0C1C2C3C4C5C6C7C8C9CACBCCCDCECFD0D1D2D3D4D5D6D7D8D9DADBDCDDDEDFE0E1E2E3E4E5E6E7E8E9EAEBECEDEEEFF0F1F2F3F4F5F6F7F8F9FA'
      'FBFCFDFEFF504B030414000008080000603E5DED496E34090000000700000006000000C3BC2E7478744B2F3ABCE7F0FC5400504B0102140314000000080000603E5D33F2A28F790400008C2A0000050000000000000000000000800100000000612E7478'
      '74504B0102140314000000000000603E5D00000000000000000000000004000000000000000000000080019C0400006469722F504B0102140314000000000000603E5D738C052900010000000100000500000000000000000000008001BE040000622E62'
      '696E504B0102140314000008080000603E5DED496E3409000000070000000600000000000000000000008001E1050000C3BC2E747874504B05060000000004000400CC0000000E060000050068656C6C6F'
      INTO lv_hex.
    rv_data = lv_hex.
  ENDMETHOD.
ENDCLASS.
