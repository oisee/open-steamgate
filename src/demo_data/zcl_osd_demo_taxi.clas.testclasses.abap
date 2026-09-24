* The generator's contract, on whatever runs this class. The checksum of
* the default size and seed was measured on Node, on OSGo and on A4H and
* agreed (docs/demo-data.md); a host that answers differently is not
* portable, whatever else it does.
CLASS ltcl_taxi DEFINITION FOR TESTING RISK LEVEL HARMLESS DURATION SHORT FINAL.

  PRIVATE SECTION.
    METHODS same_seed_same_rows FOR TESTING RAISING cx_static_check.
    METHODS grain_and_marks FOR TESTING RAISING cx_static_check.
    METHODS pinned_checksum FOR TESTING RAISING cx_static_check.
ENDCLASS.


CLASS ltcl_taxi IMPLEMENTATION.

  METHOD same_seed_same_rows.
    DATA lt_a TYPE zcl_osd_demo_taxi=>ty_facts.
    DATA lt_b TYPE zcl_osd_demo_taxi=>ty_facts.
    DATA lt_c TYPE zcl_osd_demo_taxi=>ty_facts.
    DATA lv_a TYPE i.
    DATA lv_b TYPE i.
    DATA lv_c TYPE i.
    lt_a = zcl_osd_demo_taxi=>generate( iv_rows = 200 iv_seed = zcl_osd_demo_taxi=>c_default_seed ).
    lt_b = zcl_osd_demo_taxi=>generate( iv_rows = 200 iv_seed = zcl_osd_demo_taxi=>c_default_seed ).
    lt_c = zcl_osd_demo_taxi=>generate( iv_rows = 200 iv_seed = 7 ).
    cl_abap_unit_assert=>assert_equals( act = lines( lt_a ) exp = 200 ).
    cl_abap_unit_assert=>assert_equals( act = lt_b exp = lt_a ).
    lv_a = zcl_osd_demo_taxi=>checksum( lt_a ).
    lv_b = zcl_osd_demo_taxi=>checksum( lt_b ).
    lv_c = zcl_osd_demo_taxi=>checksum( lt_c ).
    cl_abap_unit_assert=>assert_equals( act = lv_b exp = lv_a ).
    cl_abap_unit_assert=>assert_differs( act = lv_c exp = lv_a ).
  ENDMETHOD.

  METHOD grain_and_marks.
    TYPES:
      BEGIN OF ty_group,
        pickup_day  TYPE zcl_osd_demo_taxi=>ty_fact-pickup_day,
        pickup_hour TYPE zcl_osd_demo_taxi=>ty_fact-pickup_hour,
        borough     TYPE zcl_osd_demo_taxi=>ty_fact-borough,
        zone        TYPE zcl_osd_demo_taxi=>ty_fact-zone,
        payment     TYPE zcl_osd_demo_taxi=>ty_fact-payment,
      END OF ty_group.
    DATA lt_facts TYPE zcl_osd_demo_taxi=>ty_facts.
    DATA ls_fact TYPE zcl_osd_demo_taxi=>ty_fact.
    DATA lt_groups TYPE STANDARD TABLE OF ty_group WITH DEFAULT KEY.
    DATA ls_group TYPE ty_group.
    DATA lv_rows TYPE i.
    lt_facts = zcl_osd_demo_taxi=>generate( iv_rows = 3000 iv_seed = 1 ).
    cl_abap_unit_assert=>assert_equals( act = lines( lt_facts ) exp = 3000 ).
    LOOP AT lt_facts INTO ls_fact.
      cl_abap_unit_assert=>assert_true( boolc( ls_fact-fact_id > zcl_osd_demo_taxi=>c_synthetic_min ) ).
      cl_abap_unit_assert=>assert_true( boolc( ls_fact-trips >= 1 ) ).
      cl_abap_unit_assert=>assert_true( boolc( ls_fact-pickup_hour >= 0 AND ls_fact-pickup_hour <= 23 ) ).
      MOVE-CORRESPONDING ls_fact TO ls_group.
      APPEND ls_group TO lt_groups.
    ENDLOOP.
* by every component: the default key of this table leaves the i out on a
* system (and not on the transpiler), and the hour is part of the group
    SORT lt_groups BY pickup_day pickup_hour borough zone payment.
    DELETE ADJACENT DUPLICATES FROM lt_groups COMPARING ALL FIELDS.
    lv_rows = lines( lt_groups ).
    cl_abap_unit_assert=>assert_equals( act = lv_rows exp = 3000 ).
  ENDMETHOD.

  METHOD pinned_checksum.
    DATA lt_facts TYPE zcl_osd_demo_taxi=>ty_facts.
    DATA lv_sum TYPE i.
    lt_facts = zcl_osd_demo_taxi=>generate( iv_rows = 20000 iv_seed = zcl_osd_demo_taxi=>c_default_seed ).
    lv_sum = zcl_osd_demo_taxi=>checksum( lt_facts ).
    cl_abap_unit_assert=>assert_equals( act = lv_sum exp = 999629773 ).
  ENDMETHOD.

ENDCLASS.
