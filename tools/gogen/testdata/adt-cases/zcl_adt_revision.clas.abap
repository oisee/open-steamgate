CLASS zcl_adt_revision DEFINITION PUBLIC FINAL CREATE PUBLIC.
 PUBLIC SECTION.
 CLASS-METHODS run.
ENDCLASS.
CLASS zcl_adt_revision IMPLEMENTATION.
 METHOD run.
 TYPES: BEGIN OF ty_revision,
 revision TYPE string,
 subject TYPE c LENGTH 80,
 subject_full TYPE string,
 END OF ty_revision.
 DATA revisions TYPE STANDARD TABLE OF ty_revision WITH EMPTY KEY.
 DATA row TYPE ty_revision.
 row-subject_full = `stale`.
 APPEND row TO revisions.
 CALL FUNCTION 'ZOSD_STORE' DESTINATION 'STORE'
 EXPORTING iv_command = 'COMMANDS'
 TABLES et_revision = revisions.
 cl_abap_unit_assert=>assert_initial( act = revisions ).
 ENDMETHOD.
ENDCLASS.
