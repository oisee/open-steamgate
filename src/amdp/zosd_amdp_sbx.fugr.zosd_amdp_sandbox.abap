FUNCTION zosd_amdp_sandbox.
* Never runs here. DESTINATION 'AMDP' routes the call to HANA before it
* reaches this body (tools/amdp-destination.mjs, backlog G.8); a call without
* the destination is a mistake worth a dump rather than a silent empty answer.
  RAISE EXCEPTION TYPE cx_sy_dyn_call_illegal_func.
ENDFUNCTION.
