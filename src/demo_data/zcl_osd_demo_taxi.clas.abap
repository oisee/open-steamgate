* Synthetic NYC taxi facts in the shape of ZOSD_TAXIFACT, made without a
* database: the same rows on every host for the same size and seed
* (ZCL_OSD_DEMO_RANDOM). ZCL_OSD_DEMO_DATA writes them; this class needs no
* table, which is how its rows were compared with A4H's while ZOSD_TAXIFACT
* could not be created there (its column was ZONE, a reserved word in the
* dictionary, ANORMALIES zone-reserved-word; it is PICKUP_ZONE since #67).
*
* Shape. A row is an aggregate in the table's grain: one pickup day of
* C_MONTH, one hour, one zone, one payment method, with the trips of that
* group and their summed fare, tip and distance. No two rows share a group.
* The distributions are the constants below: the hour-of-day curve, the
* weekday curve, the zone weights (Manhattan dominant, its busiest zones
* heavier, JFK and LaGuardia with long trips), the payment split, the trip
* distance per zone, fare = base + per mile with noise (JFK's flat fare for
* most of its trips), and a tip of 15 to 25 per cent on most card trips,
* almost never on cash.
*
* Synthetic rows are marked by their key: FACT_ID 9000000001 and up
* (C_SYNTHETIC_MIN). tools/import-nyc-taxi.mjs numbers real facts from
* 0001000001 and the bundled sample rows sit in that range too, so a real
* import would need 8.99 billion groups to reach it. ENSURE_TAXI never
* reads, changes or deletes a row below C_SYNTHETIC_MIN.
*
* Zones. ZONE_LINES is the NYC TLC taxi zone lookup (taxi_zone_lookup.csv,
* https://d37ci6vzurychx.cloudfront.net/misc/taxi_zone_lookup.csv, the
* table of the NYC Open Data dataset "NYC Taxi Zones", 8meu-9t5y),
* published by the NYC Taxi and Limousine Commission. Version: the file as
* downloaded 2026-09-24, 265 rows, sha256 1a99e105092230f8620f301edcca7f8
* 0d3080642ff404d28ed957d3fa222c8ed. Modifications: only LocationID
* (kept as the row number), Borough (as a one-letter code) and Zone are
* kept; service_zone is dropped. NYC Open Data is published without
* registration, licence requirement or restriction on use (NYC Open Data
* Law, Local Law 11 of 2012; Open Data Policy and Technical Standards
* Manual), republishers may be asked to name source, version and
* modifications, which is what this paragraph does, and the City gives no
* warranty of completeness or accuracy. The weights, distances, fares and
* tips below are invented parameters, not TLC figures.
CLASS zcl_osd_demo_taxi DEFINITION PUBLIC FINAL CREATE PUBLIC.

  PUBLIC SECTION.
    " ZOSD_TAXIFACT's row, component for component
    TYPES:
      BEGIN OF ty_fact,
        mandt       TYPE c LENGTH 3,
        fact_id     TYPE n LENGTH 10,
        pickup_day  TYPE c LENGTH 8,
        pickup_hour TYPE i,
        borough     TYPE c LENGTH 20,
        pickup_zone TYPE c LENGTH 80,
        payment     TYPE c LENGTH 12,
        trips       TYPE i,
        fare        TYPE p LENGTH 8 DECIMALS 2,
        tip         TYPE p LENGTH 8 DECIMALS 2,
        distance    TYPE p LENGTH 8 DECIMALS 2,
      END OF ty_fact.
    TYPES ty_facts TYPE STANDARD TABLE OF ty_fact WITH DEFAULT KEY.
    TYPES ty_strings TYPE STANDARD TABLE OF string WITH DEFAULT KEY.

    " the lower bound of the synthetic range: every FACT_ID >= this is ours.
    " The value itself is never generated; the first row is 9000000001
    CONSTANTS c_synthetic_min TYPE n LENGTH 10 VALUE '9000000000'.
    CONSTANTS c_default_seed TYPE i VALUE 20250101.
    CONSTANTS c_max_rows TYPE i VALUE 200000.

    " iv_rows groups (at most C_MAX_ROWS), keys 9000000001 and up, the
    " client left empty
    CLASS-METHODS generate
      IMPORTING
        iv_rows         TYPE i
        iv_seed         TYPE i
      RETURNING
        VALUE(rt_facts) TYPE ty_facts.
    " a number over every row, in the order given: the key, the client,
    " day, hour, trips, cents of fare and tip, hundredths of a mile, the
    " zone (borough and name) and the payment -- every column
    " ENSURE_TAXI compares is in it
    CLASS-METHODS checksum
      IMPORTING
        it_facts      TYPE ty_facts
      RETURNING
        VALUE(rv_sum) TYPE i.
    " the first iv_first rows and the totals as one line of text, for
    " comparing hosts
    CLASS-METHODS describe
      IMPORTING
        it_facts       TYPE ty_facts
        iv_first       TYPE i
      RETURNING
        VALUE(rv_text) TYPE string.
    " the TLC zone lookup, row n = LocationID n: borough code + zone name
    CLASS-METHODS zone_lines
      RETURNING
        VALUE(rt_lines) TYPE ty_strings.

  PRIVATE SECTION.
    TYPES:
      BEGIN OF ty_zone,
        borough TYPE c LENGTH 20,
        zone    TYPE c LENGTH 80,
        weight  TYPE i,
        miles   TYPE i,
        flat    TYPE i,
      END OF ty_zone.
    TYPES ty_zones TYPE STANDARD TABLE OF ty_zone WITH DEFAULT KEY.

    " the month the rows fall in; 2025-01-01 is a Wednesday (0 = Monday)
    CONSTANTS c_month TYPE c LENGTH 6 VALUE '202501'.
    CONSTANTS c_days TYPE i VALUE 31.
    CONSTANTS c_first_weekday TYPE i VALUE 2.
    " relative pickups per hour 0..23: low at night, peak in the evening
    CONSTANTS c_hour_curve TYPE string
      VALUE `8 5 3 2 2 3 6 10 12 12 12 13 14 14 15 15 15 16 17 16 15 15 14 11`.
    " per weekday, Monday to Sunday
    CONSTANTS c_weekday_curve TYPE string VALUE `10 10 11 11 12 11 9`.
    " payment methods 1..5 (PAYMENT_NAME): share of groups, and the trips of
    " a group relative to a card group of the same zone and hour
    CONSTANTS c_payments TYPE i VALUE 5.
    CONSTANTS c_payment_split TYPE string VALUE `70 15 10 3 2`.
    CONSTANTS c_payment_trips TYPE string VALUE `100 45 60 10 10`.
    " zone weight: a busy Manhattan zone, and the zones picked up almost never
    CONSTANTS c_weight_hot TYPE i VALUE 40.
    CONSTANTS c_hot_zones TYPE string
      VALUE `237 161 236 162 186 230 142 170 239 163 234 68 48 79 141 107 140 249 100 164`.
    CONSTANTS c_quiet_zones TYPE string VALUE `1 103 265`.
    " the airports: LocationID, weight, mean trip in hundredths of a mile
    CONSTANTS c_jfk TYPE i VALUE 132.
    CONSTANTS c_jfk_weight TYPE i VALUE 40.
    CONSTANTS c_jfk_miles TYPE i VALUE 1780.
    CONSTANTS c_lga TYPE i VALUE 138.
    CONSTANTS c_lga_weight TYPE i VALUE 30.
    CONSTANTS c_lga_miles TYPE i VALUE 1050.
    " fares in cents: the flag drop, per mile (time in traffic folded in),
    " JFK's flat fare and the share of JFK trips that take it
    CONSTANTS c_fare_base TYPE i VALUE 300.
    CONSTANTS c_fare_per_mile TYPE i VALUE 450.
    CONSTANTS c_fare_flat TYPE i VALUE 7000.
    CONSTANTS c_flat_share TYPE i VALUE 60.
    " tips: per cent of card trips without one, the range on the others;
    " per cent of cash groups with a recorded tip
    CONSTANTS c_card_no_tip TYPE i VALUE 10.
    CONSTANTS c_tip_min TYPE i VALUE 15.
    CONSTANTS c_tip_spread TYPE i VALUE 11.
    CONSTANTS c_cash_tip TYPE i VALUE 3.

    CLASS-METHODS zones
      RETURNING
        VALUE(rt_zones) TYPE ty_zones.
    CLASS-METHODS payment_name
      IMPORTING
        iv_payment     TYPE i
      RETURNING
        VALUE(rv_name) TYPE string.
ENDCLASS.



CLASS zcl_osd_demo_taxi IMPLEMENTATION.

  METHOD generate.
    DATA lo_gen TYPE REF TO zcl_osd_demo_random.
    DATA lt_zones TYPE ty_zones.
    DATA ls_zone TYPE ty_zone.
    DATA lt_weights TYPE zcl_osd_demo_random=>ty_ints.
    DATA lt_zone_pick TYPE zcl_osd_demo_random=>ty_ints.
    DATA lt_hours TYPE zcl_osd_demo_random=>ty_ints.
    DATA lt_hour_pick TYPE zcl_osd_demo_random=>ty_ints.
    DATA lt_week TYPE zcl_osd_demo_random=>ty_ints.
    DATA lt_days TYPE zcl_osd_demo_random=>ty_ints.
    DATA lt_day_pick TYPE zcl_osd_demo_random=>ty_ints.
    DATA lt_pays TYPE zcl_osd_demo_random=>ty_ints.
    DATA lt_pay_pick TYPE zcl_osd_demo_random=>ty_ints.
    DATA lt_pay_trips TYPE zcl_osd_demo_random=>ty_ints.
    DATA lt_count TYPE zcl_osd_demo_random=>ty_ints.
    DATA lt_stamp TYPE zcl_osd_demo_random=>ty_ints.
    DATA ls_fact TYPE ty_fact.
    DATA lv_rows TYPE i.
    DATA lv_w TYPE i.
    DATA lv_weekday TYPE i.
    DATA lv_day TYPE i.
    DATA lv_hour TYPE i.
    DATA lv_slot TYPE i.
    DATA lv_count TYPE i.
    DATA lv_cells TYPE i.
    DATA lv_cell TYPE i.
    DATA lv_found TYPE i.
    DATA lv_stamp TYPE i.
    DATA lv_zone TYPE i.
    DATA lv_pay TYPE i.
    DATA lv_hw TYPE i.
    DATA lv_dw TYPE i.
    DATA lv_pf TYPE i.
    DATA lv_mean TYPE i.
    DATA lv_trips TYPE i.
    DATA lv_miles TYPE i.
    DATA lv_fare TYPE i.
    DATA lv_tip TYPE i.
    DATA lv_r1 TYPE i.
    DATA lv_r2 TYPE i.
    DATA lv_key TYPE i.
    DATA lv_n9 TYPE n LENGTH 9.
    DATA lv_n2 TYPE n LENGTH 2.
    DATA lv_c10 TYPE c LENGTH 10.

    lv_rows = iv_rows.
    IF lv_rows < 0.
      lv_rows = 0.
    ELSEIF lv_rows > c_max_rows.
      lv_rows = c_max_rows.
    ENDIF.
    CREATE OBJECT lo_gen
      EXPORTING
        iv_seed = iv_seed.

    lt_zones = zones( ).
    LOOP AT lt_zones INTO ls_zone.
      APPEND ls_zone-weight TO lt_weights.
    ENDLOOP.
    lt_zone_pick = zcl_osd_demo_random=>expand( lt_weights ).
    lt_hours = zcl_osd_demo_random=>curve( c_hour_curve ).
    lt_hour_pick = zcl_osd_demo_random=>expand( lt_hours ).
    lt_week = zcl_osd_demo_random=>curve( c_weekday_curve ).
    DO c_days TIMES.
      lv_weekday = ( sy-index - 1 + c_first_weekday ) MOD 7 + 1.
      READ TABLE lt_week INTO lv_w INDEX lv_weekday.
      APPEND lv_w TO lt_days.
    ENDDO.
    lt_day_pick = zcl_osd_demo_random=>expand( lt_days ).
    lt_pays = zcl_osd_demo_random=>curve( c_payment_split ).
    lt_pay_pick = zcl_osd_demo_random=>expand( lt_pays ).
    lt_pay_trips = zcl_osd_demo_random=>curve( c_payment_trips ).

    " how many groups each day-hour gets: a weighted draw per row
    lv_count = c_days * 24.
    DO lv_count TIMES.
      APPEND 0 TO lt_count.
    ENDDO.
    DO lv_rows TIMES.
      lv_day = lo_gen->pick( lt_day_pick ).
      lv_hour = lo_gen->pick( lt_hour_pick ).
      lv_slot = ( lv_day - 1 ) * 24 + lv_hour.
      READ TABLE lt_count INTO lv_count INDEX lv_slot.
      lv_count = lv_count + 1.
      MODIFY lt_count FROM lv_count INDEX lv_slot.
    ENDDO.

    " then, day-hour by day-hour, that many distinct (zone, payment) cells;
    " lt_stamp remembers the day-hour that last took a cell
    lv_cells = lines( lt_zones ) * c_payments.
    DO lv_cells TIMES.
      APPEND 0 TO lt_stamp.
    ENDDO.
    LOOP AT lt_count INTO lv_count.
      lv_slot = sy-tabix.
      lv_day = ( lv_slot - 1 ) DIV 24 + 1.
      lv_hour = ( lv_slot - 1 ) MOD 24.
      DO lv_count TIMES.
        lv_found = 0.
        DO 30 TIMES.
          lv_zone = lo_gen->pick( lt_zone_pick ).
          lv_pay = lo_gen->pick( lt_pay_pick ).
          lv_cell = ( lv_zone - 1 ) * c_payments + lv_pay.
          READ TABLE lt_stamp INTO lv_stamp INDEX lv_cell.
          IF lv_stamp <> lv_slot.
            lv_found = lv_cell.
            EXIT.
          ENDIF.
        ENDDO.
        IF lv_found = 0.
          " a crowded hour: the next free cell of a zone that is drawn at all
          DO lv_cells TIMES.
            lv_cell = lv_cell MOD lv_cells + 1.
            READ TABLE lt_stamp INTO lv_stamp INDEX lv_cell.
            lv_zone = ( lv_cell - 1 ) DIV c_payments + 1.
            READ TABLE lt_zones INTO ls_zone INDEX lv_zone.
            IF lv_stamp <> lv_slot AND ls_zone-weight > 0.
              lv_found = lv_cell.
              EXIT.
            ENDIF.
          ENDDO.
          IF lv_found = 0.
            " every drawable cell of this day-hour is taken: it gets fewer
            " groups, and the table fewer than iv_rows. Not reached below
            " C_MAX_ROWS; ZCL_OSD_DEMO_DATA=>ENSURE_TAXI says so if it is
            EXIT.
          ENDIF.
          lv_pay = ( lv_found - 1 ) MOD c_payments + 1.
        ENDIF.
        MODIFY lt_stamp FROM lv_slot INDEX lv_found.
        READ TABLE lt_zones INTO ls_zone INDEX lv_zone.

        " trips: 1 plus a triangular spread around an intensity that grows
        " with the zone's weight, the hour, the weekday and the payment
        lv_key = lv_hour + 1.
        READ TABLE lt_hours INTO lv_hw INDEX lv_key.
        READ TABLE lt_days INTO lv_dw INDEX lv_day.
        READ TABLE lt_pay_trips INTO lv_pf INDEX lv_pay.
        lv_mean = ls_zone-weight * lv_hw * lv_dw * lv_pf DIV 800.
        " (one draw per statement, so that no host's order of evaluation
        " inside an expression can matter)
        lv_r1 = lo_gen->draw( 1000 ).
        lv_r2 = lo_gen->draw( 1000 ).
        lv_trips = 1 + lv_mean * ( lv_r1 + lv_r2 ) DIV 100000.
        " a trip of this group: its distance, then its fare
        lv_r1 = lo_gen->draw( 81 ).
        lv_miles = ls_zone-miles * ( 60 + lv_r1 ) DIV 100.
        lv_r1 = lo_gen->draw( 100 ).
        lv_r2 = lo_gen->draw( 26 ).
        IF ls_zone-flat > 0 AND lv_r1 < c_flat_share.
          lv_fare = ls_zone-flat.
        ELSE.
          lv_fare = c_fare_base + lv_miles * c_fare_per_mile DIV 100.
          lv_fare = lv_fare * ( 95 + lv_r2 ) DIV 100.
        ENDIF.
        lv_fare = lv_fare * lv_trips.
        " the tip: two draws for every group, used or not
        lv_r1 = lo_gen->draw( 100 ).
        lv_r2 = lo_gen->draw( c_tip_spread ).
        lv_tip = 0.
        IF lv_pay = 1 AND lv_r1 >= c_card_no_tip.
          lv_tip = lv_fare * ( c_tip_min + lv_r2 ) DIV 100.
        ELSEIF lv_pay = 2 AND lv_r1 < c_cash_tip.
          lv_tip = lv_fare * ( 5 + lv_r2 DIV 2 ) DIV 100.
        ENDIF.

        CLEAR ls_fact.
        " no client: the rows are the same on every system;
        " ZCL_OSD_DEMO_DATA puts sy-mandt in before it compares and writes
        lv_key = lines( rt_facts ) + 1.
        lv_n9 = lv_key.
        CONCATENATE '9' lv_n9 INTO lv_c10.
        ls_fact-fact_id = lv_c10.
        lv_n2 = lv_day.
        CONCATENATE c_month lv_n2 INTO ls_fact-pickup_day.
        ls_fact-pickup_hour = lv_hour.
        ls_fact-borough = ls_zone-borough.
        ls_fact-pickup_zone = ls_zone-zone.
        ls_fact-payment = payment_name( lv_pay ).
        ls_fact-trips = lv_trips.
        ls_fact-fare = lv_fare / 100.
        ls_fact-tip = lv_tip / 100.
        lv_miles = lv_miles * lv_trips.
        ls_fact-distance = lv_miles / 100.
        APPEND ls_fact TO rt_facts.
      ENDDO.
    ENDLOOP.
  ENDMETHOD.

  METHOD checksum.
    TYPES:
      BEGIN OF ty_code,
        borough TYPE c LENGTH 20,
        zone    TYPE c LENGTH 80,
        code    TYPE i,
      END OF ty_code.
    DATA lt_codes TYPE SORTED TABLE OF ty_code WITH UNIQUE KEY borough zone.
    DATA ls_code TYPE ty_code.
    DATA lt_zones TYPE ty_zones.
    DATA ls_zone TYPE ty_zone.
    DATA ls_fact TYPE ty_fact.
    DATA lv_n9 TYPE n LENGTH 9.
    DATA lv_v TYPE i.
    DATA lv_pay TYPE i.
    DATA lv_name TYPE string.
* the texts go in as numbers: a zone as its LocationID (the first one for a
* name the lookup lists twice, 0 for a text not in the lookup), a payment
* as its number in PAYMENT_NAME (0 for any other text), the client as its
* digits. Every text a generated row can hold has its own number, so
* changing a borough, a zone or a payment to another value changes the
* sum; no character codes are needed, which keeps it the same on every host
    lt_zones = zones( ).
    LOOP AT lt_zones INTO ls_zone.
      ls_code-borough = ls_zone-borough.
      ls_code-zone = ls_zone-zone.
      ls_code-code = sy-tabix.
      READ TABLE lt_codes TRANSPORTING NO FIELDS
        WITH TABLE KEY borough = ls_code-borough zone = ls_code-zone.
      IF sy-subrc <> 0.
        INSERT ls_code INTO TABLE lt_codes.
      ENDIF.
    ENDLOOP.
    rv_sum = 1.
    LOOP AT it_facts INTO ls_fact.
      lv_n9 = ls_fact-fact_id+1(9).
      lv_v = lv_n9.
      rv_sum = zcl_osd_demo_random=>fold( iv_sum = rv_sum iv_value = lv_v ).
      lv_v = 0.
      IF ls_fact-mandt IS NOT INITIAL AND ls_fact-mandt CO '0123456789'.
        lv_v = ls_fact-mandt.
      ENDIF.
      rv_sum = zcl_osd_demo_random=>fold( iv_sum = rv_sum iv_value = lv_v ).
      lv_v = ls_fact-pickup_day.
      rv_sum = zcl_osd_demo_random=>fold( iv_sum = rv_sum iv_value = lv_v ).
      rv_sum = zcl_osd_demo_random=>fold( iv_sum = rv_sum iv_value = ls_fact-pickup_hour ).
      rv_sum = zcl_osd_demo_random=>fold( iv_sum = rv_sum iv_value = ls_fact-trips ).
      lv_v = ls_fact-fare * 100.
      rv_sum = zcl_osd_demo_random=>fold( iv_sum = rv_sum iv_value = lv_v ).
      lv_v = ls_fact-tip * 100.
      rv_sum = zcl_osd_demo_random=>fold( iv_sum = rv_sum iv_value = lv_v ).
      lv_v = ls_fact-distance * 100.
      rv_sum = zcl_osd_demo_random=>fold( iv_sum = rv_sum iv_value = lv_v ).
      READ TABLE lt_codes INTO ls_code
        WITH TABLE KEY borough = ls_fact-borough zone = ls_fact-pickup_zone.
      IF sy-subrc = 0.
        lv_v = ls_code-code.
      ELSE.
        lv_v = 0.
      ENDIF.
      rv_sum = zcl_osd_demo_random=>fold( iv_sum = rv_sum iv_value = lv_v ).
      lv_v = 0.
      DO c_payments TIMES.
        lv_pay = sy-index.
        lv_name = payment_name( lv_pay ).
        IF lv_name = ls_fact-payment.
          lv_v = lv_pay.
          EXIT.
        ENDIF.
      ENDDO.
      rv_sum = zcl_osd_demo_random=>fold( iv_sum = rv_sum iv_value = lv_v ).
    ENDLOOP.
  ENDMETHOD.

  METHOD describe.
    DATA ls_fact TYPE ty_fact.
    DATA lv_rows TYPE i.
    DATA lv_trips TYPE i.
    DATA lv_fare TYPE p LENGTH 15 DECIMALS 2.
    DATA lv_tip TYPE p LENGTH 15 DECIMALS 2.
    DATA lv_distance TYPE p LENGTH 15 DECIMALS 2.
    DATA lv_sum TYPE i.
    LOOP AT it_facts INTO ls_fact.
      IF sy-tabix <= iv_first.
        rv_text = rv_text && |{ ls_fact-fact_id } { ls_fact-pickup_day } { ls_fact-pickup_hour } | &&
          |{ ls_fact-borough }/{ ls_fact-pickup_zone }/{ ls_fact-payment } | &&
          |{ ls_fact-trips } { ls_fact-fare } { ls_fact-tip } { ls_fact-distance }; |.
      ENDIF.
      lv_trips = lv_trips + ls_fact-trips.
      lv_fare = lv_fare + ls_fact-fare.
      lv_tip = lv_tip + ls_fact-tip.
      lv_distance = lv_distance + ls_fact-distance.
    ENDLOOP.
    lv_rows = lines( it_facts ).
    lv_sum = checksum( it_facts ).
    rv_text = rv_text && |rows { lv_rows } trips { lv_trips } fare { lv_fare } tip { lv_tip } | &&
      |distance { lv_distance } checksum { lv_sum }|.
  ENDMETHOD.

  METHOD payment_name.
    CASE iv_payment.
      WHEN 1.
        rv_name = `Card`.
      WHEN 2.
        rv_name = `Cash`.
      WHEN 3.
        rv_name = `Other`.
      WHEN 4.
        rv_name = `Disputed`.
      WHEN OTHERS.
        rv_name = `No charge`.
    ENDCASE.
  ENDMETHOD.

  METHOD zones.
    DATA lt_lines TYPE ty_strings.
    DATA lv_line TYPE string.
    DATA lv_code TYPE c LENGTH 1.
    DATA ls_zone TYPE ty_zone.
    DATA lt_ids TYPE zcl_osd_demo_random=>ty_ints.
    DATA lv_id TYPE i.
    FIELD-SYMBOLS <ls_zone> TYPE ty_zone.
    lt_lines = zone_lines( ).
    LOOP AT lt_lines INTO lv_line.
      CLEAR ls_zone.
      lv_code = lv_line(1).
      ls_zone-zone = lv_line+1.
      " per borough: weight of one of its zones, mean trip in hundredths of a mile
      CASE lv_code.
        WHEN 'M'.
          ls_zone-borough = 'Manhattan'.
          ls_zone-weight = 12.
          ls_zone-miles = 190.
        WHEN 'Q'.
          ls_zone-borough = 'Queens'.
          ls_zone-weight = 1.
          ls_zone-miles = 480.
        WHEN 'K'.
          ls_zone-borough = 'Brooklyn'.
          ls_zone-weight = 1.
          ls_zone-miles = 420.
        WHEN 'X'.
          ls_zone-borough = 'Bronx'.
          ls_zone-weight = 1.
          ls_zone-miles = 520.
        WHEN 'S'.
          ls_zone-borough = 'Staten Island'.
          ls_zone-weight = 1.
          ls_zone-miles = 950.
        WHEN 'E'.
          ls_zone-borough = 'EWR'.
          ls_zone-weight = 1.
          ls_zone-miles = 1750.
        WHEN 'U'.
          ls_zone-borough = 'Unknown'.
          ls_zone-weight = 8.
          ls_zone-miles = 320.
        WHEN OTHERS.
          ls_zone-borough = 'N/A'.
          ls_zone-weight = 2.
          ls_zone-miles = 600.
      ENDCASE.
      " a name the lookup lists twice (Corona, the islands) is one group
      READ TABLE rt_zones TRANSPORTING NO FIELDS
        WITH KEY borough = ls_zone-borough zone = ls_zone-zone.
      IF sy-subrc = 0.
        ls_zone-weight = 0.
      ENDIF.
      APPEND ls_zone TO rt_zones.
    ENDLOOP.
    lt_ids = zcl_osd_demo_random=>curve( c_hot_zones ).
    LOOP AT lt_ids INTO lv_id.
      READ TABLE rt_zones ASSIGNING <ls_zone> INDEX lv_id.
      <ls_zone>-weight = c_weight_hot.
    ENDLOOP.
    lt_ids = zcl_osd_demo_random=>curve( c_quiet_zones ).
    LOOP AT lt_ids INTO lv_id.
      READ TABLE rt_zones ASSIGNING <ls_zone> INDEX lv_id.
      IF <ls_zone>-weight > 1.
        <ls_zone>-weight = 1.
      ENDIF.
    ENDLOOP.
    READ TABLE rt_zones ASSIGNING <ls_zone> INDEX c_jfk.
    <ls_zone>-weight = c_jfk_weight.
    <ls_zone>-miles = c_jfk_miles.
    <ls_zone>-flat = c_fare_flat.
    READ TABLE rt_zones ASSIGNING <ls_zone> INDEX c_lga.
    <ls_zone>-weight = c_lga_weight.
    <ls_zone>-miles = c_lga_miles.
  ENDMETHOD.

  METHOD zone_lines.
* NYC TLC taxi_zone_lookup.csv (see the header): LocationID = row number,
* first character the borough (M Manhattan, Q Queens, K Brooklyn, X Bronx,
* S Staten Island, E EWR, U Unknown, N N/A), then the zone name
    APPEND `ENewark Airport` TO rt_lines. " 1
    APPEND `QJamaica Bay` TO rt_lines. " 2
    APPEND `XAllerton/Pelham Gardens` TO rt_lines. " 3
    APPEND `MAlphabet City` TO rt_lines. " 4
    APPEND `SArden Heights` TO rt_lines. " 5
    APPEND `SArrochar/Fort Wadsworth` TO rt_lines. " 6
    APPEND `QAstoria` TO rt_lines. " 7
    APPEND `QAstoria Park` TO rt_lines. " 8
    APPEND `QAuburndale` TO rt_lines. " 9
    APPEND `QBaisley Park` TO rt_lines. " 10
    APPEND `KBath Beach` TO rt_lines. " 11
    APPEND `MBattery Park` TO rt_lines. " 12
    APPEND `MBattery Park City` TO rt_lines. " 13
    APPEND `KBay Ridge` TO rt_lines. " 14
    APPEND `QBay Terrace/Fort Totten` TO rt_lines. " 15
    APPEND `QBayside` TO rt_lines. " 16
    APPEND `KBedford` TO rt_lines. " 17
    APPEND `XBedford Park` TO rt_lines. " 18
    APPEND `QBellerose` TO rt_lines. " 19
    APPEND `XBelmont` TO rt_lines. " 20
    APPEND `KBensonhurst East` TO rt_lines. " 21
    APPEND `KBensonhurst West` TO rt_lines. " 22
    APPEND `SBloomfield/Emerson Hill` TO rt_lines. " 23
    APPEND `MBloomingdale` TO rt_lines. " 24
    APPEND `KBoerum Hill` TO rt_lines. " 25
    APPEND `KBorough Park` TO rt_lines. " 26
    APPEND `QBreezy Point/Fort Tilden/Riis Beach` TO rt_lines. " 27
    APPEND `QBriarwood/Jamaica Hills` TO rt_lines. " 28
    APPEND `KBrighton Beach` TO rt_lines. " 29
    APPEND `QBroad Channel` TO rt_lines. " 30
    APPEND `XBronx Park` TO rt_lines. " 31
    APPEND `XBronxdale` TO rt_lines. " 32
    APPEND `KBrooklyn Heights` TO rt_lines. " 33
    APPEND `KBrooklyn Navy Yard` TO rt_lines. " 34
    APPEND `KBrownsville` TO rt_lines. " 35
    APPEND `KBushwick North` TO rt_lines. " 36
    APPEND `KBushwick South` TO rt_lines. " 37
    APPEND `QCambria Heights` TO rt_lines. " 38
    APPEND `KCanarsie` TO rt_lines. " 39
    APPEND `KCarroll Gardens` TO rt_lines. " 40
    APPEND `MCentral Harlem` TO rt_lines. " 41
    APPEND `MCentral Harlem North` TO rt_lines. " 42
    APPEND `MCentral Park` TO rt_lines. " 43
    APPEND `SCharleston/Tottenville` TO rt_lines. " 44
    APPEND `MChinatown` TO rt_lines. " 45
    APPEND `XCity Island` TO rt_lines. " 46
    APPEND `XClaremont/Bathgate` TO rt_lines. " 47
    APPEND `MClinton East` TO rt_lines. " 48
    APPEND `KClinton Hill` TO rt_lines. " 49
    APPEND `MClinton West` TO rt_lines. " 50
    APPEND `XCo-Op City` TO rt_lines. " 51
    APPEND `KCobble Hill` TO rt_lines. " 52
    APPEND `QCollege Point` TO rt_lines. " 53
    APPEND `KColumbia Street` TO rt_lines. " 54
    APPEND `KConey Island` TO rt_lines. " 55
    APPEND `QCorona` TO rt_lines. " 56
    APPEND `QCorona` TO rt_lines. " 57
    APPEND `XCountry Club` TO rt_lines. " 58
    APPEND `XCrotona Park` TO rt_lines. " 59
    APPEND `XCrotona Park East` TO rt_lines. " 60
    APPEND `KCrown Heights North` TO rt_lines. " 61
    APPEND `KCrown Heights South` TO rt_lines. " 62
    APPEND `KCypress Hills` TO rt_lines. " 63
    APPEND `QDouglaston` TO rt_lines. " 64
    APPEND `KDowntown Brooklyn/MetroTech` TO rt_lines. " 65
    APPEND `KDUMBO/Vinegar Hill` TO rt_lines. " 66
    APPEND `KDyker Heights` TO rt_lines. " 67
    APPEND `MEast Chelsea` TO rt_lines. " 68
    APPEND `XEast Concourse/Concourse Village` TO rt_lines. " 69
    APPEND `QEast Elmhurst` TO rt_lines. " 70
    APPEND `KEast Flatbush/Farragut` TO rt_lines. " 71
    APPEND `KEast Flatbush/Remsen Village` TO rt_lines. " 72
    APPEND `QEast Flushing` TO rt_lines. " 73
    APPEND `MEast Harlem North` TO rt_lines. " 74
    APPEND `MEast Harlem South` TO rt_lines. " 75
    APPEND `KEast New York` TO rt_lines. " 76
    APPEND `KEast New York/Pennsylvania Avenue` TO rt_lines. " 77
    APPEND `XEast Tremont` TO rt_lines. " 78
    APPEND `MEast Village` TO rt_lines. " 79
    APPEND `KEast Williamsburg` TO rt_lines. " 80
    APPEND `XEastchester` TO rt_lines. " 81
    APPEND `QElmhurst` TO rt_lines. " 82
    APPEND `QElmhurst/Maspeth` TO rt_lines. " 83
    APPEND `SEltingville/Annadale/Prince's Bay` TO rt_lines. " 84
    APPEND `KErasmus` TO rt_lines. " 85
    APPEND `QFar Rockaway` TO rt_lines. " 86
    APPEND `MFinancial District North` TO rt_lines. " 87
    APPEND `MFinancial District South` TO rt_lines. " 88
    APPEND `KFlatbush/Ditmas Park` TO rt_lines. " 89
    APPEND `MFlatiron` TO rt_lines. " 90
    APPEND `KFlatlands` TO rt_lines. " 91
    APPEND `QFlushing` TO rt_lines. " 92
    APPEND `QFlushing Meadows-Corona Park` TO rt_lines. " 93
    APPEND `XFordham South` TO rt_lines. " 94
    APPEND `QForest Hills` TO rt_lines. " 95
    APPEND `QForest Park/Highland Park` TO rt_lines. " 96
    APPEND `KFort Greene` TO rt_lines. " 97
    APPEND `QFresh Meadows` TO rt_lines. " 98
    APPEND `SFreshkills Park` TO rt_lines. " 99
    APPEND `MGarment District` TO rt_lines. " 100
    APPEND `QGlen Oaks` TO rt_lines. " 101
    APPEND `QGlendale` TO rt_lines. " 102
    APPEND `MGovernor's Island/Ellis Island/Liberty Island` TO rt_lines. " 103
    APPEND `MGovernor's Island/Ellis Island/Liberty Island` TO rt_lines. " 104
    APPEND `MGovernor's Island/Ellis Island/Liberty Island` TO rt_lines. " 105
    APPEND `KGowanus` TO rt_lines. " 106
    APPEND `MGramercy` TO rt_lines. " 107
    APPEND `KGravesend` TO rt_lines. " 108
    APPEND `SGreat Kills` TO rt_lines. " 109
    APPEND `SGreat Kills Park` TO rt_lines. " 110
    APPEND `KGreen-Wood Cemetery` TO rt_lines. " 111
    APPEND `KGreenpoint` TO rt_lines. " 112
    APPEND `MGreenwich Village North` TO rt_lines. " 113
    APPEND `MGreenwich Village South` TO rt_lines. " 114
    APPEND `SGrymes Hill/Clifton` TO rt_lines. " 115
    APPEND `MHamilton Heights` TO rt_lines. " 116
    APPEND `QHammels/Arverne` TO rt_lines. " 117
    APPEND `SHeartland Village/Todt Hill` TO rt_lines. " 118
    APPEND `XHighbridge` TO rt_lines. " 119
    APPEND `MHighbridge Park` TO rt_lines. " 120
    APPEND `QHillcrest/Pomonok` TO rt_lines. " 121
    APPEND `QHollis` TO rt_lines. " 122
    APPEND `KHomecrest` TO rt_lines. " 123
    APPEND `QHoward Beach` TO rt_lines. " 124
    APPEND `MHudson Sq` TO rt_lines. " 125
    APPEND `XHunts Point` TO rt_lines. " 126
    APPEND `MInwood` TO rt_lines. " 127
    APPEND `MInwood Hill Park` TO rt_lines. " 128
    APPEND `QJackson Heights` TO rt_lines. " 129
    APPEND `QJamaica` TO rt_lines. " 130
    APPEND `QJamaica Estates` TO rt_lines. " 131
    APPEND `QJFK Airport` TO rt_lines. " 132
    APPEND `KKensington` TO rt_lines. " 133
    APPEND `QKew Gardens` TO rt_lines. " 134
    APPEND `QKew Gardens Hills` TO rt_lines. " 135
    APPEND `XKingsbridge Heights` TO rt_lines. " 136
    APPEND `MKips Bay` TO rt_lines. " 137
    APPEND `QLaGuardia Airport` TO rt_lines. " 138
    APPEND `QLaurelton` TO rt_lines. " 139
    APPEND `MLenox Hill East` TO rt_lines. " 140
    APPEND `MLenox Hill West` TO rt_lines. " 141
    APPEND `MLincoln Square East` TO rt_lines. " 142
    APPEND `MLincoln Square West` TO rt_lines. " 143
    APPEND `MLittle Italy/NoLiTa` TO rt_lines. " 144
    APPEND `QLong Island City/Hunters Point` TO rt_lines. " 145
    APPEND `QLong Island City/Queens Plaza` TO rt_lines. " 146
    APPEND `XLongwood` TO rt_lines. " 147
    APPEND `MLower East Side` TO rt_lines. " 148
    APPEND `KMadison` TO rt_lines. " 149
    APPEND `KManhattan Beach` TO rt_lines. " 150
    APPEND `MManhattan Valley` TO rt_lines. " 151
    APPEND `MManhattanville` TO rt_lines. " 152
    APPEND `MMarble Hill` TO rt_lines. " 153
    APPEND `KMarine Park/Floyd Bennett Field` TO rt_lines. " 154
    APPEND `KMarine Park/Mill Basin` TO rt_lines. " 155
    APPEND `SMariners Harbor` TO rt_lines. " 156
    APPEND `QMaspeth` TO rt_lines. " 157
    APPEND `MMeatpacking/West Village West` TO rt_lines. " 158
    APPEND `XMelrose South` TO rt_lines. " 159
    APPEND `QMiddle Village` TO rt_lines. " 160
    APPEND `MMidtown Center` TO rt_lines. " 161
    APPEND `MMidtown East` TO rt_lines. " 162
    APPEND `MMidtown North` TO rt_lines. " 163
    APPEND `MMidtown South` TO rt_lines. " 164
    APPEND `KMidwood` TO rt_lines. " 165
    APPEND `MMorningside Heights` TO rt_lines. " 166
    APPEND `XMorrisania/Melrose` TO rt_lines. " 167
    APPEND `XMott Haven/Port Morris` TO rt_lines. " 168
    APPEND `XMount Hope` TO rt_lines. " 169
    APPEND `MMurray Hill` TO rt_lines. " 170
    APPEND `QMurray Hill-Queens` TO rt_lines. " 171
    APPEND `SNew Dorp/Midland Beach` TO rt_lines. " 172
    APPEND `QNorth Corona` TO rt_lines. " 173
    APPEND `XNorwood` TO rt_lines. " 174
    APPEND `QOakland Gardens` TO rt_lines. " 175
    APPEND `SOakwood` TO rt_lines. " 176
    APPEND `KOcean Hill` TO rt_lines. " 177
    APPEND `KOcean Parkway South` TO rt_lines. " 178
    APPEND `QOld Astoria` TO rt_lines. " 179
    APPEND `QOzone Park` TO rt_lines. " 180
    APPEND `KPark Slope` TO rt_lines. " 181
    APPEND `XParkchester` TO rt_lines. " 182
    APPEND `XPelham Bay` TO rt_lines. " 183
    APPEND `XPelham Bay Park` TO rt_lines. " 184
    APPEND `XPelham Parkway` TO rt_lines. " 185
    APPEND `MPenn Station/Madison Sq West` TO rt_lines. " 186
    APPEND `SPort Richmond` TO rt_lines. " 187
    APPEND `KProspect-Lefferts Gardens` TO rt_lines. " 188
    APPEND `KProspect Heights` TO rt_lines. " 189
    APPEND `KProspect Park` TO rt_lines. " 190
    APPEND `QQueens Village` TO rt_lines. " 191
    APPEND `QQueensboro Hill` TO rt_lines. " 192
    APPEND `QQueensbridge/Ravenswood` TO rt_lines. " 193
    APPEND `MRandalls Island` TO rt_lines. " 194
    APPEND `KRed Hook` TO rt_lines. " 195
    APPEND `QRego Park` TO rt_lines. " 196
    APPEND `QRichmond Hill` TO rt_lines. " 197
    APPEND `QRidgewood` TO rt_lines. " 198
    APPEND `XRikers Island` TO rt_lines. " 199
    APPEND `XRiverdale/North Riverdale/Fieldston` TO rt_lines. " 200
    APPEND `QRockaway Park` TO rt_lines. " 201
    APPEND `MRoosevelt Island` TO rt_lines. " 202
    APPEND `QRosedale` TO rt_lines. " 203
    APPEND `SRossville/Woodrow` TO rt_lines. " 204
    APPEND `QSaint Albans` TO rt_lines. " 205
    APPEND `SSaint George/New Brighton` TO rt_lines. " 206
    APPEND `QSaint Michaels Cemetery/Woodside` TO rt_lines. " 207
    APPEND `XSchuylerville/Edgewater Park` TO rt_lines. " 208
    APPEND `MSeaport` TO rt_lines. " 209
    APPEND `KSheepshead Bay` TO rt_lines. " 210
    APPEND `MSoHo` TO rt_lines. " 211
    APPEND `XSoundview/Bruckner` TO rt_lines. " 212
    APPEND `XSoundview/Castle Hill` TO rt_lines. " 213
    APPEND `SSouth Beach/Dongan Hills` TO rt_lines. " 214
    APPEND `QSouth Jamaica` TO rt_lines. " 215
    APPEND `QSouth Ozone Park` TO rt_lines. " 216
    APPEND `KSouth Williamsburg` TO rt_lines. " 217
    APPEND `QSpringfield Gardens North` TO rt_lines. " 218
    APPEND `QSpringfield Gardens South` TO rt_lines. " 219
    APPEND `XSpuyten Duyvil/Kingsbridge` TO rt_lines. " 220
    APPEND `SStapleton` TO rt_lines. " 221
    APPEND `KStarrett City` TO rt_lines. " 222
    APPEND `QSteinway` TO rt_lines. " 223
    APPEND `MStuy Town/Peter Cooper Village` TO rt_lines. " 224
    APPEND `KStuyvesant Heights` TO rt_lines. " 225
    APPEND `QSunnyside` TO rt_lines. " 226
    APPEND `KSunset Park East` TO rt_lines. " 227
    APPEND `KSunset Park West` TO rt_lines. " 228
    APPEND `MSutton Place/Turtle Bay North` TO rt_lines. " 229
    APPEND `MTimes Sq/Theatre District` TO rt_lines. " 230
    APPEND `MTriBeCa/Civic Center` TO rt_lines. " 231
    APPEND `MTwo Bridges/Seward Park` TO rt_lines. " 232
    APPEND `MUN/Turtle Bay South` TO rt_lines. " 233
    APPEND `MUnion Sq` TO rt_lines. " 234
    APPEND `XUniversity Heights/Morris Heights` TO rt_lines. " 235
    APPEND `MUpper East Side North` TO rt_lines. " 236
    APPEND `MUpper East Side South` TO rt_lines. " 237
    APPEND `MUpper West Side North` TO rt_lines. " 238
    APPEND `MUpper West Side South` TO rt_lines. " 239
    APPEND `XVan Cortlandt Park` TO rt_lines. " 240
    APPEND `XVan Cortlandt Village` TO rt_lines. " 241
    APPEND `XVan Nest/Morris Park` TO rt_lines. " 242
    APPEND `MWashington Heights North` TO rt_lines. " 243
    APPEND `MWashington Heights South` TO rt_lines. " 244
    APPEND `SWest Brighton` TO rt_lines. " 245
    APPEND `MWest Chelsea/Hudson Yards` TO rt_lines. " 246
    APPEND `XWest Concourse` TO rt_lines. " 247
    APPEND `XWest Farms/Bronx River` TO rt_lines. " 248
    APPEND `MWest Village` TO rt_lines. " 249
    APPEND `XWestchester Village/Unionport` TO rt_lines. " 250
    APPEND `SWesterleigh` TO rt_lines. " 251
    APPEND `QWhitestone` TO rt_lines. " 252
    APPEND `QWillets Point` TO rt_lines. " 253
    APPEND `XWilliamsbridge/Olinville` TO rt_lines. " 254
    APPEND `KWilliamsburg (North Side)` TO rt_lines. " 255
    APPEND `KWilliamsburg (South Side)` TO rt_lines. " 256
    APPEND `KWindsor Terrace` TO rt_lines. " 257
    APPEND `QWoodhaven` TO rt_lines. " 258
    APPEND `XWoodlawn/Wakefield` TO rt_lines. " 259
    APPEND `QWoodside` TO rt_lines. " 260
    APPEND `MWorld Trade Center` TO rt_lines. " 261
    APPEND `MYorkville East` TO rt_lines. " 262
    APPEND `MYorkville West` TO rt_lines. " 263
    APPEND `UN/A` TO rt_lines. " 264
    APPEND `NOutside of NYC` TO rt_lines. " 265
  ENDMETHOD.

ENDCLASS.
