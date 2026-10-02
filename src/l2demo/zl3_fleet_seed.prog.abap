REPORT zl3_fleet_seed.
* A synthetic fleet for the L3 demo sets: zcl_l3_fleet_seed=>generate behind a
* selection screen. p_wipe empties the four fleet tables of this client first.

PARAMETERS p_ships TYPE i DEFAULT 200.
PARAMETERS p_seed TYPE i DEFAULT 42.
PARAMETERS p_date TYPE d.
PARAMETERS p_wipe AS CHECKBOX DEFAULT 'X'.

START-OF-SELECTION.
  DATA ls_counts TYPE zcl_l3_fleet_seed=>ty_counts.
  DATA lv_date TYPE d.
  IF p_ships < 1 OR p_ships > 999.
    MESSAGE 'p_ships is 1 to 999: a ship id is S and three digits' TYPE 'E'.
  ENDIF.
  lv_date = p_date.
  IF lv_date IS INITIAL.
    lv_date = sy-datum.
  ENDIF.
  ls_counts = zcl_l3_fleet_seed=>generate( iv_ships = p_ships iv_seed = p_seed
                                           iv_date = lv_date iv_wipe = p_wipe ).
  COMMIT WORK.
  WRITE: / 'ships', ls_counts-ships, 'voyages', ls_counts-voyages,
           'crew', ls_counts-crew, 'cargo', ls_counts-cargo.
