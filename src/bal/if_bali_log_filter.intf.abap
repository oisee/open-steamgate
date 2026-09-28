INTERFACE if_bali_log_filter PUBLIC.
  TYPES ty_object TYPE c LENGTH 20.
  TYPES ty_subobject TYPE c LENGTH 20.
  TYPES ty_external_id TYPE c LENGTH 100.
  DATA object TYPE c LENGTH 20.
  DATA subobject TYPE c LENGTH 20.
  DATA external_id TYPE c LENGTH 100.
  METHODS set_descriptor
    IMPORTING object TYPE ty_object OPTIONAL
              subobject TYPE ty_subobject OPTIONAL
              external_id TYPE ty_external_id OPTIONAL
    RETURNING VALUE(new_filter) TYPE REF TO if_bali_log_filter
    RAISING cx_bali_runtime.
ENDINTERFACE.
