CLASS zcl_lsd_apc_handler DEFINITION
  PUBLIC
  INHERITING FROM cl_apc_wsp_ext_stateful_base
  FINAL
  CREATE PUBLIC.

  " The recorded light-show, line by line, to a page that paints it.
  "
  " sap-lsd plays a demoscene show to a real SAP GUI over DIAG. sap-tui, its
  " terminal viewer, composed every screen it received into a grid of styled
  " runs and wrote the stream down (sap-tui --record): a header, the styles as
  " they first appear, then one frame per line with only the rows that
  " changed. That stream is the SMW0 object ZLSD-SHOW here, and this channel
  " hands it out by line number, so the page speaks no DIAG at all and paces
  " itself by the recorded time of each frame, the way the ZO4D page asks for
  " a frame by tick.
  "
  "   {"cmd":"info"}                 -> {"type":"show","lines":N}
  "   {"cmd":"lines","from":a,"to":b} -> the lines a..b-1, newline-separated

  PUBLIC SECTION.
    METHODS if_apc_wsp_extension~on_start REDEFINITION.
    METHODS if_apc_wsp_extension~on_message REDEFINITION.
    METHODS if_apc_wsp_extension~on_close REDEFINITION.
    METHODS if_apc_wsp_extension~on_error REDEFINITION.

    "! The recording as lines, loaded once per session (also for tests).
    METHODS load
      RETURNING VALUE(rv_lines) TYPE i.

    "! Lines from..to-1, joined with newlines.
    METHODS slice
      IMPORTING iv_from        TYPE i
                iv_to          TYPE i
      RETURNING VALUE(rv_text) TYPE string.

  PRIVATE SECTION.
    CONSTANTS c_object TYPE wwwdatatab-objid VALUE 'ZLSD-SHOW'.
    DATA mt_lines TYPE STANDARD TABLE OF string WITH EMPTY KEY.

    METHODS send
      IMPORTING i_message_manager TYPE REF TO if_apc_wsp_message_manager
                iv_text           TYPE string.

    METHODS number_after
      IMPORTING iv_json        TYPE string
                iv_key         TYPE string
      RETURNING VALUE(rv_value) TYPE i.
ENDCLASS.

CLASS zcl_lsd_apc_handler IMPLEMENTATION.

  METHOD if_apc_wsp_extension~on_start.
    DATA(lv_lines) = load( ).
    send( i_message_manager = i_message_manager
          iv_text = |\{"type":"show","lines":{ lv_lines }\}| ).
  ENDMETHOD.

  METHOD if_apc_wsp_extension~on_message.
    DATA(lv_json) = i_message->get_text( ).
    IF lv_json CS '"cmd":"info"'.
      send( i_message_manager = i_message_manager
            iv_text = |\{"type":"show","lines":{ lines( mt_lines ) }\}| ).
    ELSEIF lv_json CS '"cmd":"lines"'.
      DATA(lv_from) = number_after( iv_json = lv_json iv_key = '"from":' ).
      DATA(lv_to) = number_after( iv_json = lv_json iv_key = '"to":' ).
      send( i_message_manager = i_message_manager
            iv_text = slice( iv_from = lv_from iv_to = lv_to ) ).
    ENDIF.
  ENDMETHOD.

  METHOD if_apc_wsp_extension~on_close.
    CLEAR mt_lines.
  ENDMETHOD.

  METHOD if_apc_wsp_extension~on_error.
    CLEAR mt_lines.
  ENDMETHOD.

  METHOD load.
    DATA: lv_data TYPE xstring, lv_size TYPE i.
    IF mt_lines IS NOT INITIAL.
      rv_lines = lines( mt_lines ).
      RETURN.
    ENDIF.
    zcl_lsd_media=>load( EXPORTING iv_name = c_object IMPORTING ev_data = lv_data ev_size = lv_size ).
    IF lv_data IS INITIAL.
      RETURN.
    ENDIF.
    DATA(lv_text) = cl_abap_codepage=>convert_from( lv_data ).
    SPLIT lv_text AT cl_abap_char_utilities=>newline INTO TABLE mt_lines.
    " a trailing newline leaves an empty last line, which is no frame
    IF mt_lines IS NOT INITIAL.
      DATA(lv_last) = lines( mt_lines ).
      READ TABLE mt_lines INDEX lv_last INTO DATA(lv_tail).
      IF lv_tail IS INITIAL.
        DELETE mt_lines INDEX lv_last.
      ENDIF.
    ENDIF.
    rv_lines = lines( mt_lines ).
  ENDMETHOD.

  METHOD slice.
    DATA(lv_index) = iv_from + 1.
    WHILE lv_index <= iv_to AND lv_index <= lines( mt_lines ).
      READ TABLE mt_lines INDEX lv_index INTO DATA(lv_line).
      IF rv_text IS INITIAL.
        rv_text = lv_line.
      ELSE.
        rv_text = rv_text && cl_abap_char_utilities=>newline && lv_line.
      ENDIF.
      lv_index = lv_index + 1.
    ENDWHILE.
  ENDMETHOD.

  METHOD send.
    DATA(lo_message) = i_message_manager->create_message( ).
    lo_message->set_text( iv_text ).
    i_message_manager->send( lo_message ).
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
