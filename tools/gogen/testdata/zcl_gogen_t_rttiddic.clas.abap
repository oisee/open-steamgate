* cl_abap_typedescr=>describe_by_data of a c typed through the dictionary
* (ultra/json fix round, critic finding 6): its output length is the
* domain's. The Go host refused it until parity-wave1 carried the
* dictionary's output lengths (ZCL_GOGEN_T_RTTIOL has the rule measured on
* A4H; A4H's DD04L gives SDOK_CLASS CHAR 10, output length 10).
CLASS zcl_gogen_t_rttiddic DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
    TYPES: BEGIN OF ty_s,
             c TYPE sdok_class,
           END OF ty_s.
ENDCLASS.

CLASS zcl_gogen_t_rttiddic IMPLEMENTATION.
  METHOD run.
    DATA ls TYPE ty_s.
    DATA lo TYPE REF TO cl_abap_typedescr.
    DATA le TYPE REF TO cl_abap_elemdescr.
    lo = cl_abap_typedescr=>describe_by_data( ls-c ).
    le ?= lo.
    rv = |{ lo->type_kind }/{ lo->length }/{ le->output_length }|.
  ENDMETHOD.
ENDCLASS.
