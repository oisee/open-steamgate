INTERFACE if_bali_item_getter PUBLIC.
  DATA severity TYPE c LENGTH 1.
  DATA log_item_number TYPE i.
  DATA timestamp TYPE timestamp.
  METHODS get_message_text
    RETURNING VALUE(message_text) TYPE string
    RAISING cx_bali_runtime.
ENDINTERFACE.
