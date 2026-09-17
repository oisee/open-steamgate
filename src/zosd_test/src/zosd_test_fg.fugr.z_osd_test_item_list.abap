FUNCTION z_osd_test_item_list.
*"----------------------------------------------------------------------
*"*"Local Interface:
*"  IMPORTING
*"     VALUE(IV_STATUS) TYPE  ZOSD_TEST_STATUS OPTIONAL
*"  EXPORTING
*"     VALUE(EV_COUNT) TYPE  I
*"  TABLES
*"      ET_ITEM STRUCTURE  ZOSD_TEST_ITEM_S
*"  EXCEPTIONS
*"      UNKNOWN_STATUS
*"----------------------------------------------------------------------
* The second remote-enabled demo module, and the one that has a shape worth
* marshalling: an optional import, a scalar export, a TABLES parameter and a
* classic exception. A channel that carries this carries most of what a real
* RFC-enabled module asks for.

  DATA lt_row TYPE STANDARD TABLE OF zosd_test_item WITH DEFAULT KEY.
  DATA ls_row TYPE zosd_test_item.
  DATA ls_out TYPE zosd_test_item_s.

  IF iv_status IS NOT INITIAL
      AND iv_status <> 'N'
      AND iv_status <> 'O'
      AND iv_status <> 'C'.
    RAISE unknown_status.
  ENDIF.

  IF iv_status IS INITIAL.
    SELECT * FROM zosd_test_item INTO TABLE lt_row ORDER BY item_id.
  ELSE.
    SELECT * FROM zosd_test_item INTO TABLE lt_row
      WHERE status = iv_status ORDER BY item_id.
  ENDIF.

  LOOP AT lt_row INTO ls_row.
    CLEAR ls_out.
    MOVE-CORRESPONDING ls_row TO ls_out.
    APPEND ls_out TO et_item.
  ENDLOOP.

  ev_count = lines( et_item ).

ENDFUNCTION.
