INTERFACE zif_gogen_t_chains PUBLIC.
  METHODS get RETURNING VALUE(ro) TYPE REF TO zif_gogen_t_chains.
  METHODS label RETURNING VALUE(rv) TYPE string.
ENDINTERFACE.
