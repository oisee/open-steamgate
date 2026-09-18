CLASS zcl_osd_luw DEFINITION
  PUBLIC
  CREATE PUBLIC.
* The transactional buffer of backlog B.2 (docs/luw-buffer.md).
*
* It holds what has changed and answers what a reader should see, and it does
* both **against the delta** rather than against a store. That is deliberate:
* a draft is the same delta written somewhere that survives a request, so
* anything written against the storage would have to be written a second time
* when the draft arrives.
*
* Two changes to the same row collapse, the way a buffer must:
*
*   create then update  -> still a create, with the later row
*   create then delete  -> nothing at all; the row never existed
*   update then delete  -> a delete
*   delete then create  -> an update; the row is there and different
*
* The last of those is the one that is easy to get wrong. A delete followed by
* a create of the same key is not "two changes", it is a row that ends up
* present with new content, and a save that replayed both would delete what it
* had just written.

  PUBLIC SECTION.
    INTERFACES zif_osd_luw.

  PROTECTED SECTION.
  PRIVATE SECTION.
    DATA mt_delta TYPE zif_osd_luw=>tt_change.

    METHODS index_of
      IMPORTING
        iv_entity       TYPE string
        iv_key          TYPE string
      RETURNING
        VALUE(rv_index) TYPE i.
ENDCLASS.

CLASS zcl_osd_luw IMPLEMENTATION.

  METHOD index_of.
    FIELD-SYMBOLS <ls_change> TYPE zif_osd_luw=>ty_change.

    rv_index = 0.
    LOOP AT mt_delta ASSIGNING <ls_change>.
      IF <ls_change>-entity = iv_entity AND <ls_change>-key = iv_key.
        rv_index = sy-tabix.
        RETURN.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD zif_osd_luw~modify.
    DATA ls_change TYPE zif_osd_luw=>ty_change.
    DATA lv_index  TYPE i.
    FIELD-SYMBOLS <ls_held> TYPE zif_osd_luw=>ty_change.

    lv_index = index_of( iv_entity = iv_entity iv_key = iv_key ).

    IF lv_index = 0.
      ls_change-entity    = iv_entity.
      ls_change-key       = iv_key.
      ls_change-operation = iv_operation.
      ls_change-row       = ir_row.
      APPEND ls_change TO mt_delta.
      RETURN.
    ENDIF.

    READ TABLE mt_delta INDEX lv_index ASSIGNING <ls_held>.

*   a create that is then deleted never happened
    IF <ls_held>-operation = 'C' AND iv_operation = 'D'.
      DELETE mt_delta INDEX lv_index.
      RETURN.
    ENDIF.

*   a delete and then a create of the same key is an update: the row is there
*   and it is different. Replaying both would delete what was just written.
    IF <ls_held>-operation = 'D' AND iv_operation = 'C'.
      <ls_held>-operation = 'U'.
      <ls_held>-row       = ir_row.
      RETURN.
    ENDIF.

*   a create stays a create however often it is updated; everything else takes
*   the later operation
    IF <ls_held>-operation <> 'C'.
      <ls_held>-operation = iv_operation.
    ENDIF.
    IF iv_operation <> 'D'.
      <ls_held>-row = ir_row.
    ENDIF.
  ENDMETHOD.

  METHOD zif_osd_luw~delta.
    rt_delta = mt_delta.
  ENDMETHOD.

  METHOD zif_osd_luw~operation_of.
    DATA lv_index TYPE i.
    FIELD-SYMBOLS <ls_change> TYPE zif_osd_luw=>ty_change.

    lv_index = index_of( iv_entity = iv_entity iv_key = iv_key ).
    IF lv_index = 0.
      RETURN.
    ENDIF.
    READ TABLE mt_delta INDEX lv_index ASSIGNING <ls_change>.
    rv_operation = <ls_change>-operation.
  ENDMETHOD.

  METHOD zif_osd_luw~row_of.
    DATA lv_index TYPE i.
    FIELD-SYMBOLS <ls_change> TYPE zif_osd_luw=>ty_change.

    lv_index = index_of( iv_entity = iv_entity iv_key = iv_key ).
    IF lv_index = 0.
      RETURN.
    ENDIF.
    READ TABLE mt_delta INDEX lv_index ASSIGNING <ls_change>.
    rr_row = <ls_change>-row.
  ENDMETHOD.

  METHOD zif_osd_luw~discard.
    CLEAR mt_delta.
  ENDMETHOD.

  METHOD zif_osd_luw~count.
    rv_count = lines( mt_delta ).
  ENDMETHOD.

ENDCLASS.
