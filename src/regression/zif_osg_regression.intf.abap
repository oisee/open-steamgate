INTERFACE zif_osg_regression PUBLIC.
  CONSTANTS:
    BEGIN OF outcome,
      passed TYPE string VALUE 'passed',
      failed TYPE string VALUE 'failed',
      error  TYPE string VALUE 'error',
    END OF outcome.

  CONSTANTS:
    BEGIN OF finding_kind,
      missing          TYPE string VALUE 'missing-value',
      unexpected       TYPE string VALUE 'unexpected-value',
      type_mismatch    TYPE string VALUE 'type-mismatch',
      value_mismatch   TYPE string VALUE 'value-mismatch',
      invalid_json     TYPE string VALUE 'invalid-json',
      invalid_mask     TYPE string VALUE 'invalid-mask',
      invalid_case     TYPE string VALUE 'invalid-case',
      invalid_response TYPE string VALUE 'invalid-response',
    END OF finding_kind.

  TYPES:
    BEGIN OF ty_path_rule,
      path   TYPE string,
      reason TYPE string,
    END OF ty_path_rule.
  TYPES tt_path_rules TYPE STANDARD TABLE OF ty_path_rule WITH DEFAULT KEY.

  TYPES:
    BEGIN OF ty_json_node,
      path  TYPE string,
      kind  TYPE string,
      value TYPE string,
    END OF ty_json_node.
  TYPES tt_json_nodes TYPE SORTED TABLE OF ty_json_node WITH UNIQUE KEY path.

  TYPES:
    BEGIN OF ty_finding,
      kind     TYPE string,
      scope    TYPE string,
      path     TYPE string,
      expected TYPE string,
      actual   TYPE string,
      message  TYPE string,
    END OF ty_finding.
  TYPES tt_findings TYPE STANDARD TABLE OF ty_finding WITH DEFAULT KEY.

  TYPES:
    BEGIN OF ty_header,
      name  TYPE string,
      value TYPE string,
    END OF ty_header.
  TYPES tt_headers TYPE STANDARD TABLE OF ty_header WITH DEFAULT KEY.

  TYPES:
    BEGIN OF ty_case,
      schema_version        TYPE i,
      id                    TYPE string,
      version               TYPE string,
      description           TYPE string,
      destination           TYPE string,
      request_method        TYPE string,
      request_path          TYPE string,
      request_accept        TYPE string,
      requested_mode        TYPE string,
      timeout_ms            TYPE i,
      session_mode          TYPE string,
      expected_status       TYPE i,
      expected_content_type TYPE string,
      expected_body_format  TYPE string,
      expected_json         TYPE string,
      masks                 TYPE tt_path_rules,
    END OF ty_case.

  TYPES:
    BEGIN OF ty_response,
      status      TYPE i,
      headers     TYPE tt_headers,
      body_format TYPE string,
      body_json   TYPE string,
    END OF ty_response.

  TYPES:
    BEGIN OF ty_verdict,
      outcome  TYPE string,
      findings TYPE tt_findings,
    END OF ty_verdict.
ENDINTERFACE.
