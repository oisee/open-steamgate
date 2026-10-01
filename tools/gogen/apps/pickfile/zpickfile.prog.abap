REPORT zpickfile.

PARAMETERS p_in TYPE string.
PARAMETERS p_dir TYPE string.
PARAMETERS p_out TYPE string.
PARAMETERS p_fm1 TYPE string.
PARAMETERS p_fm2 TYPE string.

AT SELECTION-SCREEN ON VALUE-REQUEST FOR p_in.
  DATA lt_files TYPE filetable.
  DATA lv_rc TYPE i.
  DATA lv_action TYPE i.
  cl_gui_frontend_services=>file_open_dialog(
    EXPORTING initial_directory = p_dir
    CHANGING file_table = lt_files rc = lv_rc user_action = lv_action ).
  IF lv_action = cl_gui_frontend_services=>action_ok AND lv_rc > 0.
    READ TABLE lt_files INDEX 1 INTO DATA(ls_file).
    p_in = ls_file-filename.
  ENDIF.

AT SELECTION-SCREEN ON VALUE-REQUEST FOR p_dir.
  cl_gui_frontend_services=>directory_browse(
    CHANGING selected_folder = p_dir ).

AT SELECTION-SCREEN ON VALUE-REQUEST FOR p_out.
  DATA lv_name TYPE string.
  DATA lv_path TYPE string.
  DATA lv_full TYPE string.
  cl_gui_frontend_services=>file_save_dialog(
    EXPORTING default_file_name = 'output.txt'
    CHANGING filename = lv_name path = lv_path fullpath = lv_full user_action = lv_action ).
  IF lv_action = cl_gui_frontend_services=>action_ok.
    p_out = lv_full.
  ENDIF.

AT SELECTION-SCREEN ON VALUE-REQUEST FOR p_fm1.
  CALL FUNCTION 'F4_FILENAME'
    IMPORTING file_name = p_fm1.

AT SELECTION-SCREEN ON VALUE-REQUEST FOR p_fm2.
  CALL FUNCTION 'KD_GET_FILENAME_ON_F4'
    CHANGING file_name = p_fm2.

START-OF-SELECTION.
  WRITE: / p_in, / p_dir, / p_out.
