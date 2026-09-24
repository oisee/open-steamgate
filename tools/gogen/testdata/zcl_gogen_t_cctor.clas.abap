* When a class constructor runs (ultra/events): at the first use of its
* class, a static method call or a CREATE OBJECT (of a subclass too, the
* superclass's first), once.
CLASS zcl_gogen_t_cctor DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_cctor IMPLEMENTATION.
  METHOD run.
    DATA lo TYPE REF TO zcl_gogen_t_cc2.
    zcl_gogen_t_cclog=>add( `a` ).
    zcl_gogen_t_cc3=>touch( ).
    zcl_gogen_t_cc3=>touch( ).
    zcl_gogen_t_cclog=>add( `b` ).
    CREATE OBJECT lo.
    zcl_gogen_t_cc1=>touch( ).
    CREATE OBJECT lo.
    zcl_gogen_t_cclog=>add( `c` ).
    rv = zcl_gogen_t_cclog=>get( ).
  ENDMETHOD.
ENDCLASS.
