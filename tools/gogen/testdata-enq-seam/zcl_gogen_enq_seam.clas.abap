CLASS zcl_gogen_enq_seam DEFINITION PUBLIC FINAL CREATE PUBLIC.
 PUBLIC SECTION.
 CLASS-METHODS all_keys.
 CLASS-METHODS generic_keys.
 CLASS-METHODS literal_and_numc_zero.
 CLASS-METHODS defaults.
 CLASS-METHODS foreign_lock.
 CLASS-METHODS system_failure.
 CLASS-METHODS collect.
 CLASS-METHODS dequeue.
 CLASS-METHODS dequeue_all.
ENDCLASS.
CLASS zcl_gogen_enq_seam IMPLEMENTATION.
 METHOD all_keys.
 DATA name TYPE zgogen_enq_tab-name.
 DATA num TYPE zgogen_enq_tab-num.
 name = 'OBJ'. num = '0017'.
 CALL FUNCTION 'ENQUEUE_EZGOGEN_ENQ'
 EXPORTING mandt = '100' name = name num = num
 mode_zgogen_enq_tab = 'X' _scope = '3' _wait = 'X'
 EXCEPTIONS foreign_lock = 1 system_failure = 2 OTHERS = 3.
 ENDMETHOD.
 METHOD generic_keys.
 DATA name TYPE zgogen_enq_tab-name.
 DATA num TYPE zgogen_enq_tab-num.
 CLEAR: name, num.
 CALL FUNCTION 'ENQUEUE_EZGOGEN_ENQ' EXPORTING name = name num = num.
 ENDMETHOD.
 METHOD literal_and_numc_zero.
 DATA name TYPE zgogen_enq_tab-name.
 DATA num TYPE zgogen_enq_tab-num.
 num = '0000'.
 CALL FUNCTION 'ENQUEUE_EZGOGEN_ENQ' EXPORTING name = name x_name = 'X' num = num.
 ENDMETHOD.
 METHOD defaults.
 DATA name TYPE zgogen_enq_tab-name.
 name = 'OBJ'.
 CALL FUNCTION 'ENQUEUE_EZGOGEN_ENQ' EXPORTING name = name.
 ENDMETHOD.
 METHOD foreign_lock.
 DATA name TYPE zgogen_enq_tab-name.
 name = 'HELD'.
 CALL FUNCTION 'ENQUEUE_EZGOGEN_ENQ' EXPORTING name = name
 EXCEPTIONS foreign_lock = 1 system_failure = 2 OTHERS = 3.
 ENDMETHOD.
 METHOD system_failure.
 DATA name TYPE zgogen_enq_tab-name.
 name = 'FAIL'.
 CALL FUNCTION 'ENQUEUE_EZGOGEN_ENQ' EXPORTING name = name
 EXCEPTIONS foreign_lock = 1 system_failure = 2 OTHERS = 3.
 ENDMETHOD.
 METHOD collect.
 DATA name TYPE zgogen_enq_tab-name.
 name = 'COLLECT'.
 CALL FUNCTION 'ENQUEUE_EZGOGEN_ENQ' EXPORTING name = name _collect = 'X'
 EXCEPTIONS foreign_lock = 1 system_failure = 2 OTHERS = 3.
 ENDMETHOD.
 METHOD dequeue.
 DATA name TYPE zgogen_enq_tab-name.
 DATA num TYPE zgogen_enq_tab-num.
 name = 'OBJ'. num = '0017'.
 CALL FUNCTION 'DEQUEUE_EZGOGEN_ENQ' EXPORTING mandt = '100' name = name num = num.
 ENDMETHOD.
 METHOD dequeue_all.
 CALL FUNCTION 'DEQUEUE_ALL'.
 ENDMETHOD.
ENDCLASS.
