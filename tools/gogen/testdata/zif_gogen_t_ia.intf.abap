INTERFACE zif_gogen_t_ia PUBLIC.
  INTERFACES zif_gogen_t_ia2.
  TYPES: BEGIN OF ty_pair,
           a TYPE i,
           b TYPE string,
         END OF ty_pair.
  DATA mv_count TYPE i.
  DATA mv_name TYPE string.
  DATA mv_ro TYPE i READ-ONLY.
  DATA ms_pair TYPE ty_pair.
  METHODS bump.
ENDINTERFACE.
