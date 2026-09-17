FUNCTION z_osd_test_local_only.
*"----------------------------------------------------------------------
*"*"Local Interface:
*"  EXPORTING
*"     VALUE(EV_TEXT) TYPE  STRING
*"----------------------------------------------------------------------
* Deliberately NOT remote-enabled. It exists so the gate in the channel has
* something to refuse: a module without REMOTE_CALL = 'R' is callable from
* inside this system and from nowhere else, which is what a real system does.

  ev_text = 'a local caller reached me'.

ENDFUNCTION.
