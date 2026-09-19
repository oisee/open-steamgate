FUNCTION zosd_store.
* Never runs here. DESTINATION 'STORE' routes the call to the object store the
* host holds (tools/osd-store-destination.mjs, backlog G.8) before it reaches
* this body. The store is the tree this system was built from -- files, the
* abaplint registry over them, and the activation -- none of which exists
* inside the transpiled runtime, so there is nothing for this body to do but
* say that the call went nowhere. A call without the destination is a mistake
* worth a dump rather than a silent empty answer, which would read as "the
* system has no objects".
  RAISE EXCEPTION TYPE cx_sy_dyn_call_illegal_func.
ENDFUNCTION.
