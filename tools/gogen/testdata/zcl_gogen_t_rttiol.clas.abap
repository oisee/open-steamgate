* cl_abap_typedescr=>describe_by_data of components typed through the
* dictionary (parity-wave1: the RFC channel's /UI2/CL_JSON): OUTPUT_LENGTH
* is the domain's OUTPUTLEN, or the data element's when it has no domain.
* A4H 2026-09-24 ran this class with SAP's data elements of the same shape
* in place of the testdata ones (a: SIC_NORM_TV_ICON_RULE_TYPE CHAR 40 out
* 10, b: SWD_AUTHTY CHAR 1 out 80, c: SIAG_ACTION_TYPE CHAR 5 without a
* domain, p: SABP_D_SINCE_TS DEC 15 out 19, n: WDY_MD_TEXT_TYPE_ENUM NUMC 2
* out 1), the only difference the type names.
CLASS zcl_gogen_t_rttiol DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_s,
             a TYPE zgogen_t_ola,
             b TYPE zgogen_t_olb,
             c TYPE zgogen_t_olc,
             p TYPE zgogen_t_olp,
             n TYPE zgogen_t_oln,
           END OF ty_s.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    CLASS-METHODS one IMPORTING io TYPE REF TO cl_abap_typedescr RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_rttiol IMPLEMENTATION.
  METHOD one.
    DATA le TYPE REF TO cl_abap_elemdescr.
    le ?= io.
    rv = |{ io->type_kind }/{ io->length }/{ io->decimals }/{ le->output_length } |.
  ENDMETHOD.

  METHOD run.
    DATA ls TYPE ty_s.
    rv = one( cl_abap_typedescr=>describe_by_data( ls-a ) )
      && one( cl_abap_typedescr=>describe_by_data( ls-b ) )
      && one( cl_abap_typedescr=>describe_by_data( ls-c ) )
      && one( cl_abap_typedescr=>describe_by_data( ls-p ) )
      && one( cl_abap_typedescr=>describe_by_data( ls-n ) ).
  ENDMETHOD.
ENDCLASS.
