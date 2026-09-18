INTERFACE zif_stg_cds_composition PUBLIC.
* What a CDS entity says about the parts it is made of (backlog B.2).
*
* RAP calls a part a composition and something merely pointed at an
* association, and the difference is not decoration: a part is created,
* deleted and locked with its parent. We enter that vocabulary through the
* CDS annotation rather than through a behaviour definition, because
* abaplint parses @ObjectModel in full and a BDEF with one regular
* expression -- the decision is in docs/backlog.md B.2.
*
* Only a generated source class whose view has at least one
* @ObjectModel.association.type: [#TO_COMPOSITION_CHILD] implements this.
* Everything else does not, so the SADL DPC asks with a cast and carries on
* when the cast fails. That is why this is a second interface and not three
* more methods on ZIF_STG_CDS_SOURCE, which five hand-written classes in
* src/segw implement and which has no compositions in it.

  TYPES:
*   one child of this entity: the navigation a client sees, the view the
*   rows belong to, and how a parent key becomes a child key
    BEGIN OF ty_key_pair,
      parent TYPE string,
      child  TYPE string,
    END OF ty_key_pair,
    tt_key_pair TYPE STANDARD TABLE OF ty_key_pair WITH DEFAULT KEY,
    BEGIN OF ty_child,
      navigation TYPE string,
      view       TYPE string,
      keys       TYPE tt_key_pair,
    END OF ty_child,
    tt_child TYPE STANDARD TABLE OF ty_child WITH DEFAULT KEY.

* the parts, in the order the view declares them
  METHODS children
    RETURNING
      VALUE(rt_children) TYPE tt_child.

ENDINTERFACE.
