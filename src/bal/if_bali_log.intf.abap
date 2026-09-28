INTERFACE if_bali_log PUBLIC.
  TYPES ty_handle TYPE c LENGTH 32.
  TYPES: BEGIN OF ty_item_entry,
           log_item_number TYPE i,
           item TYPE REF TO if_bali_item_getter,
         END OF ty_item_entry.
  TYPES ty_item_table TYPE SORTED TABLE OF ty_item_entry
    WITH UNIQUE KEY log_item_number.
  METHODS get_handle RETURNING VALUE(handle) TYPE ty_handle.
  METHODS get_header
    RETURNING VALUE(header) TYPE REF TO if_bali_header_getter
    RAISING cx_bali_runtime.
  METHODS add_item
    IMPORTING item TYPE REF TO if_bali_item_setter
    RAISING cx_bali_runtime.
  METHODS get_all_items
    RETURNING VALUE(item_table) TYPE ty_item_table
    RAISING cx_bali_runtime.
ENDINTERFACE.
