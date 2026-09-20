CLASS zcl_osd_icf DEFINITION PUBLIC CREATE PUBLIC.
* The ICF registry, read from the tables a system keeps it in.
*
* `ICFSERVICE`, `ICFHANDLER` and `ICFDOCU` are ICF-SHAPED tables of ours,
* reimplemented in src/osd/ddic/ the way CROSS and WBCROSSGT already are.
*
* **They are not SAP's, and an earlier version of this comment said they
* were.** `ICF_NAME` (CHAR 15) and `ICFPARGUID` (CHAR 25) match; `URL` does
* not exist on a system at all -- a node's path IS the parent chain, and
* abapGit reconstructs it with `cl_icf_tree=>service_from_url` precisely
* because it is not stored. We denormalise it because this runtime has no
* ICF tree to walk. So "ABAP that reads SICF the way a system does works
* here unchanged" was false, and is withdrawn: this class would not compile
* on a system. Deriving the path from ICFPARGUID is the truer thing and is
* a later step. Found by an adversarial review, 2026-09-20.
*
* Why it exists at all: until now "who answers this path" could only be
* answered by a JavaScript host parsing *.sicf.xml files. That made the
* registry inspectable from outside the system and not from inside it, which
* is the wrong way round for a thing whose whole claim is that it is the
* system's own inventory (docs/icf-as-the-registry.md, backlog G.5).
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_node,
             icf_name   TYPE icfservice-icf_name,
             icfparguid TYPE icfservice-icfparguid,
             url        TYPE icfservice-url,
             icfactive  TYPE icfservice-icfactive,
             icf_docu   TYPE icfdocu-icf_docu,
             handler    TYPE icfhandler-icfhandler,
             icftyp     TYPE icfhandler-icftyp,
           END OF ty_node.
    TYPES tt_node TYPE STANDARD TABLE OF ty_node WITH DEFAULT KEY.

*   Every node, longest URL first -- the order a lookup needs and the order
*   `services()` in tools/osd-icf.mjs has sorted in since it was written,
*   for the same reason: /sap/bc/a/b must not be swallowed by /sap/bc/a.
    CLASS-METHODS nodes
      RETURNING
        VALUE(rt_nodes) TYPE tt_node.

*   The class that answers a URL, **inherited down the tree** -- and
*   nothing at all if any node on the way is switched off.
*
*   This is ICF's own rule and not a convenience: a UI5 application's node
*   carries no handler at all and is served by the handler on the branch
*   above it. Measured on A4H on 2026-09-19 -- /sap/bc/ui5_ui5/sap/ has the
*   handler and /sap/bc/ui5_ui5/sap/arsrvc_upb_admn/ answers 200 under it
*   with none of its own. A lookup that only matched whole nodes would call
*   every deployed Fiori application unserved.
    CLASS-METHODS handler_of
      IMPORTING
        iv_url            TYPE string
      RETURNING
        VALUE(rv_handler) TYPE icfhandler-icfhandler.

*   The node a URL is answered by, handler or not: what SICF shows when you
*   navigate to a path rather than what runs.
    CLASS-METHODS node_of
      IMPORTING
        iv_url         TYPE string
      RETURNING
        VALUE(rs_node) TYPE ty_node.
  PROTECTED SECTION.
  PRIVATE SECTION.
ENDCLASS.

CLASS zcl_osd_icf IMPLEMENTATION.

  METHOD nodes.
    DATA lt_service TYPE STANDARD TABLE OF icfservice.
    DATA ls_service LIKE LINE OF lt_service.
    DATA lt_handler TYPE STANDARD TABLE OF icfhandler.
    DATA ls_handler LIKE LINE OF lt_handler.
    DATA lt_docu    TYPE STANDARD TABLE OF icfdocu.
    DATA ls_docu    LIKE LINE OF lt_docu.
    DATA ls_node    TYPE ty_node.

    SELECT * FROM icfservice INTO TABLE lt_service.
    SELECT * FROM icfhandler INTO TABLE lt_handler.
*   the description is a row of its own, keyed by language, because that is
*   where a real system keeps it -- every *.sicf.xml in the corpus carries
*   it in an <ICFDOCU> block and not inside <ICFSERVICE>
    SELECT * FROM icfdocu INTO TABLE lt_docu.

    LOOP AT lt_service INTO ls_service.
      CLEAR ls_node.
      ls_node-icf_name   = ls_service-icf_name.
      ls_node-icfparguid = ls_service-icfparguid.
      ls_node-url        = ls_service-url.
      ls_node-icfactive  = ls_service-icfactive.
      READ TABLE lt_docu INTO ls_docu
        WITH KEY icf_name = ls_service-icf_name icfparguid = ls_service-icfparguid.
      IF sy-subrc = 0.
        ls_node-icf_docu = ls_docu-icf_docu.
      ELSE.
        CLEAR ls_node-icf_docu.
      ENDIF.
*     the last of the chain answers; the earlier rows are the inherited ones
      LOOP AT lt_handler INTO ls_handler
        WHERE icf_name = ls_service-icf_name AND icfparguid = ls_service-icfparguid.
        ls_node-handler = ls_handler-icfhandler.
        ls_node-icftyp  = ls_handler-icftyp.
      ENDLOOP.
      APPEND ls_node TO rt_nodes.
    ENDLOOP.

    SORT rt_nodes BY url DESCENDING.
  ENDMETHOD.

  METHOD node_of.
    DATA lt_nodes TYPE tt_node.
    DATA ls_node  LIKE LINE OF lt_nodes.
    DATA lv_url   TYPE string.

    CLEAR rs_node.
    lv_url = iv_url.
*   a node's URL ends in a slash, so the lookup compares like with like
    IF lv_url IS NOT INITIAL AND substring( val = lv_url off = strlen( lv_url ) - 1 len = 1 ) <> '/'.
      lv_url = lv_url && '/'.
    ENDIF.

    lt_nodes = nodes( ).
*   longest first, so the deepest node that is a prefix of the URL wins --
*   which is what walking up the tree amounts to when the tree is rows
    LOOP AT lt_nodes INTO ls_node.
      IF ls_node-url IS INITIAL.
        CONTINUE.
      ENDIF.
      IF lv_url CP |{ ls_node-url }*|.
        rs_node = ls_node.
        RETURN.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD handler_of.
*   **Deactivating a node takes its subtree with it.**
*
*   The first version skipped an inactive node and carried on up the tree,
*   so a deactivated node was served by its parent's handler and a
*   deactivated BRANCH kept answering through every child that had a
*   handler of its own. That is the opposite of what SICF's switch is for.
*
*   Said plainly about its own evidence: this is reasoned from what
*   deactivation MEANS and is **not measured on a system** -- unlike the
*   inheritance rule two methods up, which was measured on A4H on
*   2026-09-19 and says so. The earlier version asserted the wrong
*   behaviour with a comment claiming it was what SICF does, which is the
*   shape of claim this tree keeps paying for.
    DATA lt_nodes TYPE tt_node.
    DATA ls_node  LIKE LINE OF lt_nodes.
    DATA lv_url   TYPE string.

    CLEAR rv_handler.
    lv_url = iv_url.
    IF lv_url IS NOT INITIAL AND substring( val = lv_url off = strlen( lv_url ) - 1 len = 1 ) <> '/'.
      lv_url = lv_url && '/'.
    ENDIF.

    lt_nodes = nodes( ).
*   first pass: anything on the path from the root to this request that is
*   switched off ends the search, whatever is below it
    LOOP AT lt_nodes INTO ls_node.
      IF ls_node-url IS INITIAL.
        CONTINUE.
      ENDIF.
      IF lv_url CP |{ ls_node-url }*| AND ls_node-icfactive <> 'X'.
        RETURN.
      ENDIF.
    ENDLOOP.

*   second pass: the deepest node that is a prefix AND has a handler. A
*   node with none does not end the search -- on a system it inherits one
*   from its branch, which is what makes a deployed Fiori application work
    LOOP AT lt_nodes INTO ls_node.
      IF ls_node-url IS INITIAL OR ls_node-handler IS INITIAL.
        CONTINUE.
      ENDIF.
      IF lv_url CP |{ ls_node-url }*|.
        rv_handler = ls_node-handler.
        RETURN.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

ENDCLASS.
