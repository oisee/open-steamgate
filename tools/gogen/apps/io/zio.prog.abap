REPORT zio.

PARAMETERS p_input TYPE string LOWER CASE.
PARAMETERS p_output TYPE string LOWER CASE.

DATA gt_lines TYPE STANDARD TABLE OF string WITH DEFAULT KEY.
DATA gv_size TYPE i.
DATA gv_env TYPE string.

START-OF-SELECTION.
  IF cl_gui_frontend_services=>file_exist( p_input ) = abap_false.
    WRITE: / 'Missing', p_input.
    RETURN.
  ENDIF.
  cl_gui_frontend_services=>file_get_size(
    EXPORTING file_name = p_input
    IMPORTING file_size = gv_size ).
  cl_gui_frontend_services=>gui_upload(
    EXPORTING filename = p_input filetype = 'ASC'
    CHANGING data_tab = gt_lines ).
  cl_gui_frontend_services=>gui_download(
    EXPORTING filename = p_output filetype = 'ASC' write_lf = abap_true
    CHANGING data_tab = gt_lines ).
  WRITE: / 'Copied', lines( gt_lines ), 'lines', gv_size, 'bytes'.
  gv_env = zcl_osabap_runtime=>getenv( 'OSABAP_TEST_ENV' ).
  WRITE: / 'Env', gv_env.
