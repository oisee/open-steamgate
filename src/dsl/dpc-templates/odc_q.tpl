  method {{method}}.
    DATA lo_client TYPE REF TO zcl_stg_odata_client.

* served by {{remote_service}}/{{remote_set}}, another service of this registry
    CREATE OBJECT lo_client
      EXPORTING
        iv_service    = '{{remote_service}}'
        iv_entity_set = '{{remote_set}}'.
    lo_client->get_entityset(
      EXPORTING
        io_tech_request_context = io_tech_request_context
        iv_local_service        = '{{service}}'
        iv_local_set            = iv_entity_set_name
      IMPORTING
        et_entityset            = et_entityset
        es_response_context     = es_response_context ).
  endmethod.
