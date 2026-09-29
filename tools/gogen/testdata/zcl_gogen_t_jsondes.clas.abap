CLASS zcl_gogen_t_jsondes DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    TYPES: BEGIN OF ty_item,
             n  TYPE i,
             ok TYPE abap_bool,
           END OF ty_item.
    TYPES ty_items TYPE STANDARD TABLE OF ty_item WITH DEFAULT KEY.
    TYPES: BEGIN OF ty_doc,
             name  TYPE string,
             count TYPE i,
             flag  TYPE abap_bool,
             items TYPE ty_items,
             code  TYPE c LENGTH 3,
           END OF ty_doc.
ENDCLASS.

CLASS zcl_gogen_t_jsondes IMPLEMENTATION.
  METHOD run.
* open-abap-core's /UI2/CL_JSON=>DESERIALIZE, the path ZCL_OSD_STATUS=>REFRESH
* takes: members matched without regard to case, a missing one cleared,
* an unknown one ignored, true into abap_bool, a number into i, an array
* into a table
    DATA ls TYPE ty_doc.
    DATA li TYPE ty_item.
    ls-code = 'old'.
    /ui2/cl_json=>deserialize( EXPORTING json = `{"NAME":"osg","count":42,"flag":true,"extra":[1],"items":[{"n":1,"ok":true},{"n":2},{"n":3,"ok":false}]}`
                               CHANGING  data = ls ).
    rv = |{ ls-name }/{ ls-count }/{ ls-flag }/{ ls-code }/{ lines( ls-items ) }:|.
    LOOP AT ls-items INTO li.
      rv = |{ rv }{ li-n }{ li-ok },|.
    ENDLOOP.
    TRY.
        /ui2/cl_json=>deserialize( EXPORTING json = `{"name":` CHANGING data = ls ).
        rv = |{ rv } bad:none|.
      CATCH cx_root.
        rv = |{ rv } bad:caught|.
    ENDTRY.
  ENDMETHOD.
ENDCLASS.
