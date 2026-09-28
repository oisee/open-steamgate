CLASS cl_bali_free_text_setter DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_bali_free_text_setter.
    INTERFACES if_bali_item_getter.
    DATA text TYPE string READ-ONLY.
    TYPES ty_severity TYPE c LENGTH 1.
    CLASS-METHODS create
      IMPORTING text TYPE string
                severity TYPE ty_severity DEFAULT 'S'
      RETURNING VALUE(free_text) TYPE REF TO if_bali_free_text_setter.
ENDCLASS.

CLASS cl_bali_free_text_setter IMPLEMENTATION.
  METHOD create.
    DATA(lo_item) = NEW cl_bali_free_text_setter( ).
    lo_item->text = text.
    lo_item->if_bali_item_getter~severity = severity.
    free_text = lo_item.
  ENDMETHOD.
  METHOD if_bali_item_getter~get_message_text.
    message_text = text.
  ENDMETHOD.
ENDCLASS.
