CLASS zcl_gogen_t_adt4 DEFINITION PUBLIC FINAL CREATE PUBLIC.
 PUBLIC SECTION.
 CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.
CLASS zcl_gogen_t_adt4 IMPLEMENTATION.
 METHOD run.
 DATA a TYPE t VALUE '231500'.
 DATA b TYPE t.
 DATA n TYPE i.
 n = a - b.
 DATA d TYPE d VALUE '20261007'.
 DATA epoch TYPE d VALUE '19700101'.
 DATA days TYPE p LENGTH 8 DECIMALS 0.
 days = d - epoch.
 DATA di TYPE i.
 di = d - epoch.
 DATA c TYPE c LENGTH 10.
 c = n - 1 + 1.
 TYPES ty TYPE c LENGTH 3.
 DATA lt TYPE STANDARD TABLE OF ty WITH EMPTY KEY.
 APPEND 'A' TO lt.
 DATA count TYPE i.
 DATA pattern TYPE c LENGTH 3 VALUE 'A# '.
 LOOP AT lt INTO DATA(row) WHERE table_line CS `A ` AND table_line CA ` ` AND table_line CP pattern.
 count = count + 1.
 ENDLOOP.
 LOOP AT lt INTO row WHERE table_line NS `A `.
 count = count + 10.
 ENDLOOP.
 LOOP AT lt INTO row WHERE table_line NA ` `.
 count = count + 100.
 ENDLOOP.
 LOOP AT lt INTO row WHERE table_line NP pattern.
 count = count + 1000.
 ENDLOOP.
 DATA size TYPE i.
 size = lines( lt ) + 1.
 DATA lx TYPE REF TO cx_root.
 DATA lx2 TYPE REF TO zcx_gogen_t_rnochk.
 TRY.
 RAISE EXCEPTION TYPE zcx_gogen_t_rnochk.
 CATCH cx_root INTO lx.
 ENDTRY.
 TRY.
 RAISE EXCEPTION lx.
 CATCH zcx_gogen_t_rnochk INTO lx2.
 ENDTRY.
 rv = |{ n }/{ days }/{ di }/[{ c } ]/{ count }/{ size }/{ boolc( lx = lx2 ) }|.
 ENDMETHOD.
ENDCLASS.
