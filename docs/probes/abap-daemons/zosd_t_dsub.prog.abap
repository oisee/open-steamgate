REPORT zosd_t_dsub.
DATA ls TYPE zosd_t_dlog.
TRY.
    ls-logid = cl_system_uuid=>create_uuid_x16_static( ).
  CATCH cx_uuid_error.
ENDTRY.
ls-probe = 'P7'.
GET TIME STAMP FIELD ls-ts.
ls-cb = 'SUBMITTED_RAN'.
ls-uname = sy-uname.
ls-clnt = sy-mandt.
INSERT zosd_t_dlog CONNECTION r/3*osdlog FROM ls.
COMMIT CONNECTION r/3*osdlog.
