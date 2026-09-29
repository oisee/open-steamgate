* What a caller sees when a class constructor raises (ultra/events fix
* round): which CATCH takes it, and what a second use of the class does.
CLASS zcl_gogen_t_ccboom2 DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PROTECTED SECTION.
ENDCLASS.

CLASS zcl_gogen_t_ccboom2 IMPLEMENTATION.
  METHOD run.
    TRY.
        rv = |t:{ zcl_gogen_t_ccboom=>touch( ) }|.
      CATCH cx_sy_zerodivide.
        rv = `zd`.
      CATCH cx_sy_no_handler.
        rv = `nh`.
      CATCH cx_root.
        rv = `root`.
    ENDTRY.
    TRY.
        rv = |{ rv } again:{ zcl_gogen_t_ccboom=>touch( ) }|.
      CATCH cx_sy_zerodivide.
        rv = |{ rv } zd2|.
      CATCH cx_sy_no_handler.
        rv = |{ rv } nh2|.
      CATCH cx_root.
        rv = |{ rv } root2|.
    ENDTRY.
  ENDMETHOD.
ENDCLASS.
