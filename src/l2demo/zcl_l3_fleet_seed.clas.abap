CLASS zcl_l3_fleet_seed DEFINITION PUBLIC FINAL CREATE PUBLIC.
* A synthetic fleet for the L3 demo sets (docs/dsl-l3.md, "Simulated twin"):
* ships with voyages, crew and cargo drawn from a seed, so a run of fleet or
* fleet2 has enough piles to watch in the cockpit. The same seed and date give
* the same fleet. Report ZL3_FLEET_SEED is the selection screen over it.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_counts,
             ships   TYPE i,
             voyages TYPE i,
             crew    TYPE i,
             cargo   TYPE i,
           END OF ty_counts.
    CLASS-METHODS generate
      IMPORTING iv_ships         TYPE i
                iv_seed          TYPE i
                iv_date          TYPE d
                iv_wipe          TYPE abap_bool DEFAULT abap_true
      RETURNING VALUE(rs_counts) TYPE ty_counts.
  PRIVATE SECTION.
    CLASS-DATA gv_state TYPE i.
    CLASS-METHODS next
      IMPORTING iv_max          TYPE i
      RETURNING VALUE(rv_value) TYPE i.
ENDCLASS.

CLASS zcl_l3_fleet_seed IMPLEMENTATION.
  METHOD next.
*   Park-Miller minimal standard, the generator the simulated twin uses
    DATA lv_next TYPE p LENGTH 16 DECIMALS 0.
    lv_next = gv_state.
    lv_next = lv_next * 16807.
    lv_next = lv_next MOD 2147483647.
    gv_state = lv_next.
    rv_value = gv_state MOD iv_max.
  ENDMETHOD.

  METHOD generate.
    DATA ls_ship TYPE zosd_l2_ship.
    DATA lt_ship TYPE STANDARD TABLE OF zosd_l2_ship.
    DATA ls_voy TYPE zosd_l2_voy.
    DATA lt_voy TYPE STANDARD TABLE OF zosd_l2_voy.
    DATA ls_crew TYPE zosd_l2_crew.
    DATA lt_crew TYPE STANDARD TABLE OF zosd_l2_crew.
    DATA ls_cargo TYPE zosd_l2_cargo.
    DATA lt_cargo TYPE STANDARD TABLE OF zosd_l2_cargo.
    DATA lv_n TYPE i.
    DATA lv_k TYPE i.
    DATA lv_r TYPE i.
    DATA lv_num TYPE n LENGTH 5.
    DATA lv_num3 TYPE n LENGTH 3.

    gv_state = iv_seed.
    IF gv_state <= 0.
      gv_state = 1.
    ENDIF.
    IF iv_wipe = abap_true.
      DELETE FROM zosd_l2_cargo.
      DELETE FROM zosd_l2_crew.
      DELETE FROM zosd_l2_voy.
      DELETE FROM zosd_l2_ship.
    ENDIF.

    DO iv_ships TIMES.
      lv_num3 = sy-index.
      CLEAR ls_ship.
      CONCATENATE 'S' lv_num3 INTO ls_ship-ship_id.
      CONCATENATE 'Ship' lv_num3 INTO ls_ship-name SEPARATED BY space.
*     one ship in ten is in maintenance
      lv_r = next( 10 ).
      IF lv_r = 0.
        ls_ship-status = 'M'.
      ELSE.
        ls_ship-status = 'A'.
      ENDIF.
      APPEND ls_ship TO lt_ship.

*     zero to four voyages, departing from ten days back to thirty ahead
      lv_n = next( 5 ).
      DO lv_n TIMES.
        rs_counts-voyages = rs_counts-voyages + 1.
        lv_num = rs_counts-voyages.
        CLEAR ls_voy.
        CONCATENATE 'V' lv_num INTO ls_voy-voyage_id.
        ls_voy-ship_id = ls_ship-ship_id.
        lv_r = next( 41 ).
        ls_voy-dep_date = iv_date + lv_r - 10.
        APPEND ls_voy TO lt_voy.
      ENDDO.

*     zero to five crew; the first is often the captain, sometimes signed on late
      lv_n = next( 6 ).
      DO lv_n TIMES.
        lv_k = sy-index.
        rs_counts-crew = rs_counts-crew + 1.
        lv_num = rs_counts-crew.
        CLEAR ls_crew.
        CONCATENATE 'C' lv_num INTO ls_crew-crew_id.
        ls_crew-ship_id = ls_ship-ship_id.
        lv_r = next( 4 ).
        IF lv_k = 1 AND lv_r <> 0.
          ls_crew-role = 'C'.
        ELSE.
          ls_crew-role = 'E'.
        ENDIF.
        lv_r = next( 60 ).
        ls_crew-since = iv_date + lv_r - 50.
        APPEND ls_crew TO lt_crew.
      ENDDO.

*     zero to three cargo items of up to 600.00
      lv_n = next( 4 ).
      DO lv_n TIMES.
        rs_counts-cargo = rs_counts-cargo + 1.
        lv_num = rs_counts-cargo.
        CLEAR ls_cargo.
        CONCATENATE 'K' lv_num INTO ls_cargo-cargo_id.
        ls_cargo-ship_id = ls_ship-ship_id.
        lv_r = next( 60001 ).
        ls_cargo-weight = lv_r / 100.
        APPEND ls_cargo TO lt_cargo.
      ENDDO.
    ENDDO.
    rs_counts-ships = lines( lt_ship ).

    MODIFY zosd_l2_ship FROM TABLE lt_ship.
    MODIFY zosd_l2_voy FROM TABLE lt_voy.
    MODIFY zosd_l2_crew FROM TABLE lt_crew.
    MODIFY zosd_l2_cargo FROM TABLE lt_cargo.
  ENDMETHOD.
ENDCLASS.
