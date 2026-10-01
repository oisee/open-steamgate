INTERFACE zif_gogen_t_rng PUBLIC.
  TYPES ty_key TYPE c LENGTH 4.
  TYPES tt_keys TYPE STANDARD TABLE OF ty_key WITH DEFAULT KEY.
  TYPES tt_range TYPE RANGE OF ty_key.
  METHODS read
    IMPORTING it_range TYPE tt_range OPTIONAL
    RETURNING VALUE(rt_keys) TYPE tt_keys.
ENDINTERFACE.
