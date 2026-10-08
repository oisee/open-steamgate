CLASS ltcl_pwhere DEFINITION FOR TESTING RISK LEVEL HARMLESS DURATION SHORT.
 PRIVATE SECTION.
 METHODS packed_where FOR TESTING.
 METHODS precision_parity FOR TESTING.
ENDCLASS.
CLASS ltcl_pwhere IMPLEMENTATION.
 METHOD packed_where.
 zcl_adt_pwhere=>run( ).
 ENDMETHOD.
 METHOD precision_parity.
 zcl_adt_pwhere=>precision_parity( ).
 ENDMETHOD.
ENDCLASS.
