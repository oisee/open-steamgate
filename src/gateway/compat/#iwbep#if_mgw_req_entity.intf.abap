INTERFACE /iwbep/if_mgw_req_entity PUBLIC.

  METHODS get_entity_set_name
    RETURNING
      VALUE(rv_entity_set) TYPE /iwbep/mgw_tech_name.

  METHODS get_entity_type_name
    RETURNING
      VALUE(rv_entity_type) TYPE /iwbep/mgw_tech_name.

  METHODS get_source_entity_set_name
    RETURNING
      VALUE(rv_entity_set) TYPE /iwbep/mgw_tech_name.

  METHODS get_converted_keys
    EXPORTING
      es_key_values TYPE data.

  METHODS get_converted_source_keys
    EXPORTING
      es_key_values TYPE data.

* Overlay (H5x-3): the navigation path the URL carried, the member the SEGW
* sample calls on this facet and on the entity-set facet (its
* RESOLVE_NAVIGATION_PATH receives both contexts and calls the getter on
* each; framework-gaps.json of bed run 18 -- private evidence). Table type
* the interface's own operations already carry (it_navigation_path).
  METHODS get_navigation_path
    RETURNING
      VALUE(rt_navigation_path) TYPE /iwbep/t_mgw_navigation_path.
ENDINTERFACE.
