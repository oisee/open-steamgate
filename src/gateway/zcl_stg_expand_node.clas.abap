CLASS zcl_stg_expand_node DEFINITION PUBLIC CREATE PUBLIC.
* The io_expand tree a DPC receives on deep insert / get_expanded_*: which
* navigation properties the request carries, one level per node.
  PUBLIC SECTION.
    INTERFACES /iwbep/if_mgw_odata_expand.

    METHODS add_child
      IMPORTING
        iv_name TYPE string
        io_node TYPE REF TO zcl_stg_expand_node.
  PRIVATE SECTION.
    DATA mt_children TYPE /iwbep/if_mgw_odata_expand=>ty_t_node_children.
ENDCLASS.

CLASS zcl_stg_expand_node IMPLEMENTATION.

  METHOD add_child.
    DATA ls_child TYPE /iwbep/if_mgw_odata_expand=>ty_s_node_child.

    ls_child-tech_nav_prop_name = iv_name.
    ls_child-node               = io_node.
    APPEND ls_child TO mt_children.
  ENDMETHOD.

  METHOD /iwbep/if_mgw_odata_expand~get_children.
    rt_children = mt_children.
  ENDMETHOD.

ENDCLASS.
