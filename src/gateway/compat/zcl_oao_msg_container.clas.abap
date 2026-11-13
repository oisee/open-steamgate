CLASS zcl_oao_msg_container DEFINITION PUBLIC.
* The message container of a request: BAPI return messages and plain texts
* the DPC adds while processing, read by the error response.
* Overlay (H5x-3) of the library's copy: the interface carries add_message,
* the member the SEGW sample calls per message it forwards.
  PUBLIC SECTION.
    INTERFACES /iwbep/if_message_container.

    METHODS get_messages
      RETURNING
        VALUE(rt_messages) TYPE bapirettab.

    METHODS has_errors
      RETURNING
        VALUE(rv_errors) TYPE abap_bool.
  PRIVATE SECTION.
    DATA mt_messages TYPE bapirettab.
ENDCLASS.

CLASS zcl_oao_msg_container IMPLEMENTATION.

  METHOD /iwbep/if_message_container~add_message_from_bapi.
    APPEND is_bapi_message TO mt_messages.
  ENDMETHOD.

  METHOD /iwbep/if_message_container~add_message_text_only.
    DATA ls_message TYPE bapiret2.

    ls_message-type    = iv_msg_type.
    ls_message-message = iv_msg_text.
    APPEND ls_message TO mt_messages.
  ENDMETHOD.

  METHOD /iwbep/if_message_container~add_messages_from_bapi.
    DATA ls_message TYPE bapiret2.
    FIELD-SYMBOLS <ls_row> TYPE any.

    LOOP AT it_bapi_messages ASSIGNING <ls_row>.
      CLEAR ls_message.
      MOVE-CORRESPONDING <ls_row> TO ls_message.
      APPEND ls_message TO mt_messages.
    ENDLOOP.
  ENDMETHOD.

  METHOD /iwbep/if_message_container~add_message.
    DATA ls_message TYPE bapiret2.

    ls_message-type       = iv_msg_type.
    ls_message-id         = iv_msg_id.
    ls_message-number     = iv_msg_number.
    ls_message-message_v1 = iv_msg_v1.
    ls_message-message_v2 = iv_msg_v2.
    ls_message-message_v3 = iv_msg_v3.
    ls_message-message_v4 = iv_msg_v4.
* a text the caller gives is the message; otherwise the text a system builds
* from the message class, built here from the variables: this runtime keeps
* no message classes. The category, leading flag, entity type, keys and
* target are accepted and not kept: the error response carries none of them.
    IF iv_msg_text IS NOT INITIAL.
      ls_message-message = iv_msg_text.
    ELSE.
      CONCATENATE iv_msg_v1 iv_msg_v2 iv_msg_v3 iv_msg_v4
        INTO ls_message-message SEPARATED BY space.
      CONDENSE ls_message-message.
    ENDIF.
    APPEND ls_message TO mt_messages.
  ENDMETHOD.

  METHOD get_messages.
    rt_messages = mt_messages.
  ENDMETHOD.

  METHOD has_errors.
    DATA ls_message TYPE bapiret2.

    LOOP AT mt_messages INTO ls_message WHERE type CA 'EAX'.
      rv_errors = abap_true.
      RETURN.
    ENDLOOP.
  ENDMETHOD.

ENDCLASS.
