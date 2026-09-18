INTERFACE zif_osd_luw PUBLIC.
* The transactional buffer: what has changed, held until it is saved
* (backlog B.2, docs/luw-buffer.md).
*
* The shape is decided and the reason is worth keeping, because it is what
* stops the draft from being a rewrite of this. A buffer and a draft are two
* levels, not one thing with two lifetimes:
*
*   the buffer   lives one LUW. MODIFY collects, the save sequence runs -
*                determinations, validations, then the write - and only then
*                do rows reach the database.
*   a draft      lives *between* requests, in its own table, and is activated
*                by an action -- and that activation itself runs **in the
*                buffer**, because activating re-runs the behaviour.
*
* So a draft stands on a buffer rather than replacing it. What carries between
* them is the **delta**: entity, key, operation, the row after. It is designed
* serialisable from the first day, so persisting it later is a change of
* storage and not of model.

  TYPES:
*   C create, U update, D delete. A named type, because `TYPE c LENGTH 1` in a
*   method signature is not what this ABAP version parses.
    ty_operation TYPE c LENGTH 1,
*   what one change is
    BEGIN OF ty_change,
      entity    TYPE string,
      key       TYPE string,
      operation TYPE ty_operation,
      row       TYPE REF TO data,
    END OF ty_change,
    tt_change TYPE STANDARD TABLE OF ty_change WITH DEFAULT KEY.

* record a change. The key is the entity's key rendered as text, which is what
* makes two changes to the same row recognisable without knowing its type.
  METHODS modify
    IMPORTING
      iv_entity    TYPE string
      iv_key       TYPE string
      iv_operation TYPE ty_operation
      ir_row       TYPE REF TO data OPTIONAL.

* what is in the buffer, in the order it was recorded
  METHODS delta
    RETURNING
      VALUE(rt_delta) TYPE tt_change.

* what the buffer says about one row: 'C', 'U', 'D', or initial when it says
* nothing and the database answers instead
  METHODS operation_of
    IMPORTING
      iv_entity           TYPE string
      iv_key              TYPE string
    RETURNING
      VALUE(rv_operation) TYPE ty_operation.

* the row as the buffer has it, or an initial reference when it has none
  METHODS row_of
    IMPORTING
      iv_entity     TYPE string
      iv_key        TYPE string
    RETURNING
      VALUE(rr_row) TYPE REF TO data.

* forget everything without writing it
  METHODS discard.

* how many changes are held
  METHODS count
    RETURNING
      VALUE(rv_count) TYPE i.

ENDINTERFACE.
