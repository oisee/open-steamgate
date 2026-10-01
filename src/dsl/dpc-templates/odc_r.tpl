  method {{method}}.
    DATA lo_client TYPE REF TO zcl_stg_odata_client.

* served by {{remote_service}}/{{remote_set}}, another service of this registry
    CREATE OBJECT lo_client
      EXPORTING
        iv_service    = '{{remote_service}}'
        iv_entity_set = '{{remote_set}}'.
    lo_client->get_entity(
      EXPORTING
        it_key_tab       = it_key_tab
        iv_local_service = '{{service}}'
        iv_local_set     = iv_entity_set_name
      IMPORTING
        es_entity        = er_entity ).
  endmethod.
