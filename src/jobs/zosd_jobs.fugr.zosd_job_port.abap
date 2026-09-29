FUNCTION zosd_job_port.
* This body is never entered: the private JOBS destination owns pending
* definitions for the current execution context. No operations DB write here.
  RAISE EXCEPTION TYPE cx_sy_dyn_call_illegal_func.
ENDFUNCTION.
