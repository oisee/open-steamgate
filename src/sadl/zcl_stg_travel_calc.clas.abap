CLASS zcl_stg_travel_calc DEFINITION PUBLIC CREATE PUBLIC.
* The read exit of the virtual elements of ZC_STG_TRAVEL: Occupancy and
* FreeSeats are not columns, they are computed here from the row that was
* read and from the bookings of that travel. This is ordinary developer
* ABAP, the same class a system would call.
  PUBLIC SECTION.
    INTERFACES if_sadl_exit_calc_element_read.

    CONSTANTS gc_capacity TYPE i VALUE 10 ##NO_TEXT.
  PRIVATE SECTION.
    TYPES: BEGIN OF ty_booked,
             travel_id TYPE c LENGTH 8,
             booked    TYPE i,
           END OF ty_booked.
    TYPES ty_bookeds TYPE STANDARD TABLE OF ty_booked WITH DEFAULT KEY.
ENDCLASS.

CLASS zcl_stg_travel_calc IMPLEMENTATION.

  METHOD if_sadl_exit_calc_element_read~get_calculation_info.
* what the calculation reads from the database row itself
    DATA ls_element TYPE if_sadl_exit=>ty_s_element_info.

    ls_element-name = 'TRAVELID'.
    APPEND ls_element TO ct_requested_orig_elements.
    ls_element-name = 'SEATS'.
    APPEND ls_element TO ct_requested_orig_elements.
  ENDMETHOD.

  METHOD if_sadl_exit_calc_element_read~calculate.
    DATA lt_booked   TYPE ty_bookeds.
    DATA ls_booked   TYPE ty_booked.
    DATA ls_element  TYPE if_sadl_exit=>ty_s_element_info.
    DATA lv_occupancy TYPE i.
    DATA lv_text     TYPE c LENGTH 12.
    FIELD-SYMBOLS <ls_row>    TYPE any.
    FIELD-SYMBOLS <lv_id>     TYPE any.
    FIELD-SYMBOLS <lv_seats>  TYPE any.
    FIELD-SYMBOLS <lv_target> TYPE any.

    SELECT travel_id COUNT( * ) AS booked
      FROM zstg_demo_bk
      INTO TABLE lt_booked
      GROUP BY travel_id.

    LOOP AT ct_calculated_data ASSIGNING <ls_row>.
      ASSIGN COMPONENT 'TRAVEL_ID' OF STRUCTURE <ls_row> TO <lv_id>.
      IF sy-subrc <> 0.
        ASSIGN COMPONENT 'TRAVELID' OF STRUCTURE <ls_row> TO <lv_id>.
      ENDIF.
      ASSIGN COMPONENT 'SEATS' OF STRUCTURE <ls_row> TO <lv_seats>.
      IF <lv_id> IS NOT ASSIGNED OR <lv_seats> IS NOT ASSIGNED.
        CONTINUE.
      ENDIF.

      CLEAR ls_booked.
      READ TABLE lt_booked INTO ls_booked WITH KEY travel_id = <lv_id>.

      LOOP AT it_requested_calc_elements INTO ls_element.
        CASE ls_element-name.
          WHEN 'OCCUPANCY'.
            ASSIGN COMPONENT 'OCCUPANCY' OF STRUCTURE <ls_row> TO <lv_target>.
            IF sy-subrc = 0.
              lv_occupancy = <lv_seats> * 100 / gc_capacity.
              lv_text = |{ lv_occupancy }% of { gc_capacity }|.
              <lv_target> = lv_text.
            ENDIF.
          WHEN 'FREESEATS'.
            ASSIGN COMPONENT 'FREESEATS' OF STRUCTURE <ls_row> TO <lv_target>.
            IF sy-subrc = 0.
              <lv_target> = <lv_seats> - ls_booked-booked.
            ENDIF.
        ENDCASE.
      ENDLOOP.
    ENDLOOP.
  ENDMETHOD.

ENDCLASS.
