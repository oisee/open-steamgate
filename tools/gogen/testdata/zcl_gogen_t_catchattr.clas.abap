* CATCH ... INTO an attribute: a report's global data is a private attribute
* of the class the converter makes of it. One that a CATCH of runtime
* exceptions takes INTO holds the exception in the whole class (read in
* another method); one that takes a raised object holds the object. A local
* or a parameter of the same name stays what it is.
CLASS zcl_gogen_t_catchattr DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    DATA mx TYPE REF TO cx_root.
    DATA mm TYPE REF TO cx_root.
    CLASS-DATA gs TYPE REF TO cx_root.
    CLASS-DATA go TYPE REF TO zcx_gogen_t_rbase.
    METHODS divide IMPORTING iv TYPE i.
    METHODS seen RETURNING VALUE(rv) TYPE string.
    METHODS mixed IMPORTING iv TYPE i RETURNING VALUE(rv) TYPE string.
    METHODS shadow RETURNING VALUE(rv) TYPE string.
    METHODS text_of IMPORTING mx TYPE REF TO cx_root RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS overflow.
ENDCLASS.

CLASS zcl_gogen_t_catchattr IMPLEMENTATION.
  METHOD divide.
    DATA lv TYPE i.
    TRY.
        lv = 1 / iv.
      CATCH cx_sy_zerodivide INTO mx.
    ENDTRY.
  ENDMETHOD.
  METHOD seen.
    rv = cl_abap_classdescr=>get_class_name( mx ).
  ENDMETHOD.
  METHOD mixed.
    DATA lv TYPE i.
    TRY.
        IF iv = 0.
          lv = 1 / iv.
        ENDIF.
        RAISE EXCEPTION TYPE zcx_gogen_t_rsub EXPORTING num = iv.
      CATCH cx_sy_zerodivide zcx_gogen_t_rbase INTO mm.
    ENDTRY.
    rv = cl_abap_classdescr=>get_class_name( mm ).
  ENDMETHOD.
  METHOD shadow.
    DATA mx TYPE REF TO zcx_gogen_t_rbase.
    TRY.
        RAISE EXCEPTION TYPE zcx_gogen_t_rsub EXPORTING num = 5.
      CATCH zcx_gogen_t_rbase INTO mx.
    ENDTRY.
    rv = |{ mx->num }|.
  ENDMETHOD.
  METHOD text_of.
    rv = mx->get_text( ).
  ENDMETHOD.
  METHOD overflow.
    DATA lv TYPE i.
    TRY.
        lv = 2147483647.
        lv = lv + 1.
      CATCH cx_sy_arithmetic_overflow INTO gs.
    ENDTRY.
  ENDMETHOD.
  METHOD run.
    DATA lo TYPE REF TO zcl_gogen_t_catchattr.
    CREATE OBJECT lo.
    lo->divide( 0 ).
    rv = |rt:{ lo->seen( ) }|.
    TRY.
        RAISE EXCEPTION TYPE zcx_gogen_t_rsub EXPORTING num = 3.
      CATCH zcx_gogen_t_rbase INTO go.
    ENDTRY.
    rv = |{ rv } obj:{ boolc( go IS BOUND ) }/{ go->num }|.
    overflow( ).
    rv = |{ rv } static:{ cl_abap_classdescr=>get_class_name( gs ) }|.
    rv = |{ rv } mixed:{ lo->mixed( 0 ) },{ lo->mixed( 4 ) }|.
    rv = |{ rv } shadow:{ lo->shadow( ) }|.
    rv = |{ rv } param:[{ lo->text_of( go ) }]|.
  ENDMETHOD.
ENDCLASS.
