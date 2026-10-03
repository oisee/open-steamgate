FUNCTION th_wpinfo.
* Clean-room local host capacity; the kernel supplies this on a system.
  DATA ls_wp TYPE wpinfo.
  DATA lv_free TYPE i VALUE 4.
  DATA lv_busy TYPE i.
  WHILE lv_free > 0.
    ls_wp-wp_typ = 'BGD'.
    ls_wp-wp_status = 'Waiting'.
    APPEND ls_wp TO wplist.
    lv_free = lv_free - 1.
  ENDWHILE.
ENDFUNCTION.
