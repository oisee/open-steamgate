CLASS zcl_lsd_apc_handler DEFINITION
  PUBLIC
  INHERITING FROM cl_apc_wsp_ext_stateful_base
  FINAL
  CREATE PUBLIC.

  " The recorded light-show, in chunks, to a page that paints it.
  "
  " sap-lsd plays a demoscene show to a real SAP GUI over DIAG. sap-tui, its
  " terminal viewer, composed every screen it received into a grid of styled
  " runs and wrote the stream down (sap-tui --record): a header, the styles as
  " they first appear, then one frame per line with only the rows that
  " changed. That stream is the SMW0 object ZLSD-SHOW here.
  "
  " The object is gzip, because the show is 5.2 MB of text and 225 KB
  " compressed, and neither side has to inflate it: the channel hands out the
  " bytes as base64 and the page inflates them with DecompressionStream, which
  " is the browser's own zlib. So the pack carries the small file, the wire
  " carries the small file, and the page speaks no DIAG at all.
  "
  "   {"cmd":"info"}                  -> {"type":"show","bytes":N,"encoding":"gzip"}
  "   {"cmd":"bytes","from":a,"to":b} -> base64 of the bytes a..b-1

  PUBLIC SECTION.
    METHODS if_apc_wsp_extension~on_start REDEFINITION.
    METHODS if_apc_wsp_extension~on_message REDEFINITION.
    METHODS if_apc_wsp_extension~on_close REDEFINITION.
    METHODS if_apc_wsp_extension~on_error REDEFINITION.

    "! The recording as bytes, loaded once per session (also for tests).
    METHODS load
      RETURNING VALUE(rv_bytes) TYPE i.

    "! The bytes from..to-1, base64 encoded.
    METHODS chunk
      IMPORTING iv_from          TYPE i
                iv_to            TYPE i
      RETURNING VALUE(rv_base64) TYPE string.

  PRIVATE SECTION.
    CONSTANTS c_object TYPE wwwdatatab-objid VALUE 'ZLSD-SHOW'.
    DATA mv_data TYPE xstring.

    METHODS send
      IMPORTING i_message_manager TYPE REF TO if_apc_wsp_message_manager
                iv_text           TYPE string.

    METHODS number_after
      IMPORTING iv_json         TYPE string
                iv_key          TYPE string
      RETURNING VALUE(rv_value) TYPE i.

    METHODS info
      RETURNING VALUE(rv_json) TYPE string.
ENDCLASS.

CLASS zcl_lsd_apc_handler IMPLEMENTATION.

  METHOD if_apc_wsp_extension~on_start.
    load( ).
    send( i_message_manager = i_message_manager iv_text = info( ) ).
  ENDMETHOD.

  METHOD if_apc_wsp_extension~on_message.
    DATA lv_json TYPE string.
    TRY.
        lv_json = i_message->get_text( ).
      CATCH cx_apc_error.
        RETURN.
    ENDTRY.
    IF lv_json CS '"cmd":"info"'.
      load( ).
      send( i_message_manager = i_message_manager iv_text = info( ) ).
    ELSEIF lv_json CS '"cmd":"bytes"'.
      DATA(lv_from) = number_after( iv_json = lv_json iv_key = '"from":' ).
      DATA(lv_to) = number_after( iv_json = lv_json iv_key = '"to":' ).
      send( i_message_manager = i_message_manager
            iv_text = chunk( iv_from = lv_from iv_to = lv_to ) ).
    ENDIF.
  ENDMETHOD.

  METHOD if_apc_wsp_extension~on_close.
    CLEAR mv_data.
  ENDMETHOD.

  METHOD if_apc_wsp_extension~on_error.
    CLEAR mv_data.
  ENDMETHOD.

  METHOD info.
    rv_json = |\{"type":"show","bytes":{ xstrlen( mv_data ) },"encoding":"gzip"\}|.
  ENDMETHOD.

  METHOD load.
    DATA lv_size TYPE i.
    IF mv_data IS NOT INITIAL.
      rv_bytes = xstrlen( mv_data ).
      RETURN.
    ENDIF.
    zcl_lsd_media=>load( EXPORTING iv_name = c_object IMPORTING ev_data = mv_data ev_size = lv_size ).
    rv_bytes = xstrlen( mv_data ).
  ENDMETHOD.

  METHOD chunk.
    DATA(lv_size) = xstrlen( mv_data ).
    DATA(lv_from) = iv_from.
    DATA(lv_to) = iv_to.
    IF lv_from < 0.
      lv_from = 0.
    ENDIF.
    IF lv_to > lv_size.
      lv_to = lv_size.
    ENDIF.
    IF lv_to <= lv_from.
      RETURN.
    ENDIF.
    DATA(lv_len) = lv_to - lv_from.
    " the slice goes into a variable of its own: an offset on an xstring is
    " not allowed where a method's actual parameter is expected
    DATA lv_part TYPE xstring.
    lv_part = mv_data+lv_from(lv_len).
    rv_base64 = cl_http_utility=>encode_x_base64( lv_part ).
  ENDMETHOD.

  METHOD send.
    TRY.
        DATA(lo_message) = i_message_manager->create_message( ).
        lo_message->set_text( iv_text ).
        i_message_manager->send( lo_message ).
      CATCH cx_apc_error.
        " The connection may already be closed; ON_ERROR handles cleanup.
    ENDTRY.
  ENDMETHOD.

  METHOD number_after.
    DATA(lv_pos) = find( val = iv_json sub = iv_key ).
    IF lv_pos < 0.
      RETURN.
    ENDIF.
    lv_pos = lv_pos + strlen( iv_key ).
    DATA(lv_end) = lv_pos.
    WHILE lv_end < strlen( iv_json ) AND iv_json+lv_end(1) CO '0123456789'.
      lv_end = lv_end + 1.
    ENDWHILE.
    IF lv_end > lv_pos.
      DATA(lv_len) = lv_end - lv_pos.
      rv_value = iv_json+lv_pos(lv_len).
    ENDIF.
  ENDMETHOD.

ENDCLASS.
