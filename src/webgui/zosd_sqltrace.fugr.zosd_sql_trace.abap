FUNCTION zosd_sql_trace.
* Never runs here. DESTINATION 'SQLTRACE' routes the call to the ring the
* host holds (tools/osd-sql-trace-buffer.mjs, backlog G.10) before it reaches
* this body. The trace cannot live in a table: the tracer sits on the one
* connection every statement goes through, so a trace row would trace itself,
* and a row written inside an open LUW is lost when that LUW rolls back and
* changes the commit shape when it does not -- which is the thing being
* measured. A call without the destination is a mistake worth a dump rather
* than a silent empty answer.
  RAISE EXCEPTION TYPE cx_sy_dyn_call_illegal_func.
ENDFUNCTION.
