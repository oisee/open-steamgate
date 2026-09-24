* The superclass of ZCL_GOGEN_T_INHCONST (ultra/zvdb): run on A4H 2026-09-24
* in $ZOSG_TMP_0300 as written here.
CLASS zcl_gogen_t_icsup DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    CONSTANTS c_k TYPE c LENGTH 3 VALUE 'SUP'.
    CONSTANTS: BEGIN OF c_key,
                 msgid TYPE c LENGTH 4 VALUE 'ZMSG',
                 msgno TYPE n LENGTH 3 VALUE '042',
               END OF c_key.
ENDCLASS.

CLASS zcl_gogen_t_icsup IMPLEMENTATION.
ENDCLASS.
