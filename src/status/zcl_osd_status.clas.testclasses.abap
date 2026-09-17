CLASS ltcl_status DEFINITION FOR TESTING RISK LEVEL HARMLESS DURATION SHORT FINAL.

  PRIVATE SECTION.
    METHODS setup.
    METHODS round_trip FOR TESTING RAISING cx_static_check.
    METHODS second_refresh_replaces FOR TESTING RAISING cx_static_check.
    METHODS malformed_json_keeps_rows FOR TESTING RAISING cx_static_check.

    METHODS snapshot_json
      IMPORTING
        iv_sid         TYPE string
        iv_pid         TYPE string
      RETURNING
        VALUE(rv_json) TYPE string.

    METHODS count_rows
      RETURNING
        VALUE(rv_rows) TYPE i.

ENDCLASS.


CLASS ltcl_status IMPLEMENTATION.

  METHOD setup.
    DELETE FROM zosd_sys WHERE sid <> ''.
    DELETE FROM zosd_proc WHERE pid >= 0.
    DELETE FROM zosd_port WHERE port >= 0.
    DELETE FROM zosd_svc WHERE path <> ''.
    DELETE FROM zosd_pack WHERE name <> ''.
  ENDMETHOD.

  METHOD snapshot_json.
* the contract of tools/osd-status.mjs, written out by hand so that a
* change to either side shows up here
    rv_json =
      '{"system":{"sid":"' && iv_sid && '","host_kind":"node","gen_live":"abc123",' &&
      '"gen_serving":"abc123","synced":true,"workers":2,' &&
      '"started_at":"2026-09-17T09:00:00.000Z","snap_at":"2026-09-17T09:00:01.000Z",' &&
      '"root_hint":"open-steamgate"},' &&
      '"processes":[{"pid":' && iv_pid && ',"role":"work","port":38813,"generation":"abc123",' &&
      '"epoch":1,"since":"2026-09-17T09:00:00.000Z","sockets":0,"rss_mb":180,"alive":true}],' &&
      '"ports":[{"port":3030,"protocol":"HTTP","purpose":"OData, apps, ADT",' &&
      '"state":"listening","note":""},' &&
      '{"port":3300,"protocol":"RFC","purpose":"RFC gateway","state":"absent",' &&
      '"note":"open-rfc-go would serve this"}],' &&
      '"services":[{"path":"/sap/opu/odata/sap/ZSTG_DEMO_SRV","kind":"ODATA",' &&
      '"handler":"ZCL_ZSTG_DEMO_DPC_EXT","pack":""}],' &&
      '"packs":[{"name":"o4d","order":40,"objects":172,"folders":"upstream, src",' &&
      '"description":"the o4d demo"}]}'.
  ENDMETHOD.

  METHOD count_rows.
    DATA lv_count TYPE i.

    SELECT COUNT(*) FROM zosd_sys INTO lv_count.
    rv_rows = lv_count.
    SELECT COUNT(*) FROM zosd_proc INTO lv_count.
    rv_rows = rv_rows + lv_count.
    SELECT COUNT(*) FROM zosd_port INTO lv_count.
    rv_rows = rv_rows + lv_count.
    SELECT COUNT(*) FROM zosd_svc INTO lv_count.
    rv_rows = rv_rows + lv_count.
    SELECT COUNT(*) FROM zosd_pack INTO lv_count.
    rv_rows = rv_rows + lv_count.
  ENDMETHOD.

  METHOD round_trip.
    DATA lv_rows TYPE i.
    DATA lv_json TYPE string.

    lv_rows = zcl_osd_status=>refresh( snapshot_json( iv_sid = 'OSG'
                                                      iv_pid = '4711' ) ).
* one system, one process, two ports, one service, one pack
    cl_abap_unit_assert=>assert_equals( act = lv_rows
                                        exp = 6 ).
    cl_abap_unit_assert=>assert_equals( act = count_rows( )
                                        exp = 6 ).

    lv_json = zcl_osd_status=>snapshot( ).
    cl_abap_unit_assert=>assert_char_cp( act = lv_json
                                         exp = '*"sid":"OSG"*' ).
    cl_abap_unit_assert=>assert_char_cp( act = lv_json
                                         exp = '*"host_kind":"node"*' ).
    cl_abap_unit_assert=>assert_char_cp( act = lv_json
                                         exp = '*"synced":true*' ).
    cl_abap_unit_assert=>assert_char_cp( act = lv_json
                                         exp = '*"pid":4711*' ).
    cl_abap_unit_assert=>assert_char_cp( act = lv_json
                                         exp = '*"rss_mb":180*' ).
    cl_abap_unit_assert=>assert_char_cp( act = lv_json
                                         exp = '*"root_hint":"open-steamgate"*' ).
    cl_abap_unit_assert=>assert_char_cp( act = lv_json
                                         exp = '*"order":40*' ).
    cl_abap_unit_assert=>assert_char_cp( act = lv_json
                                         exp = '*"state":"absent"*' ).
  ENDMETHOD.

  METHOD second_refresh_replaces.
    DATA lv_rows TYPE i.
    DATA lv_sid  TYPE zosd_sys-sid.
    DATA lv_pid  TYPE zosd_proc-pid.

    zcl_osd_status=>refresh( snapshot_json( iv_sid = 'OSG'
                                            iv_pid = '4711' ) ).
    lv_rows = zcl_osd_status=>refresh( snapshot_json( iv_sid = 'TWO'
                                                      iv_pid = '4712' ) ).
    cl_abap_unit_assert=>assert_equals( act = lv_rows
                                        exp = 6 ).
* the second snapshot replaced the first: no duplicates, no leftovers
    cl_abap_unit_assert=>assert_equals( act = count_rows( )
                                        exp = 6 ).

    SELECT SINGLE sid FROM zosd_sys INTO lv_sid.
    cl_abap_unit_assert=>assert_equals( act = lv_sid
                                        exp = 'TWO' ).
    SELECT SINGLE pid FROM zosd_proc INTO lv_pid.
    cl_abap_unit_assert=>assert_equals( act = lv_pid
                                        exp = 4712 ).
  ENDMETHOD.

  METHOD malformed_json_keeps_rows.
    DATA lv_rows TYPE i.
    DATA lv_sid  TYPE zosd_sys-sid.

    zcl_osd_status=>refresh( snapshot_json( iv_sid = 'OSG'
                                            iv_pid = '4711' ) ).

    lv_rows = zcl_osd_status=>refresh( 'not json at all' ).
    cl_abap_unit_assert=>assert_equals( act = lv_rows
                                        exp = 0 ).
    lv_rows = zcl_osd_status=>refresh( '' ).
    cl_abap_unit_assert=>assert_equals( act = lv_rows
                                        exp = 0 ).
    lv_rows = zcl_osd_status=>refresh( '{"system":{"host_kind":"node"}}' ).
    cl_abap_unit_assert=>assert_equals( act = lv_rows
                                        exp = 0 ).
* looks like an object and is cut in half: the parser, not the guard
    lv_rows = zcl_osd_status=>refresh( '{"system":{"sid":"OSG",' ).
    cl_abap_unit_assert=>assert_equals( act = lv_rows
                                        exp = 0 ).

* what was there is still there
    cl_abap_unit_assert=>assert_equals( act = count_rows( )
                                        exp = 6 ).
    SELECT SINGLE sid FROM zosd_sys INTO lv_sid.
    cl_abap_unit_assert=>assert_equals( act = lv_sid
                                        exp = 'OSG' ).
  ENDMETHOD.

ENDCLASS.
