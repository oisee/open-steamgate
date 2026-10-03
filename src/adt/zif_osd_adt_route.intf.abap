"! One route of the ADT facade (ADR 0007): a request in, a response out.
"! The router (ZCL_OSD_ADT_ROUTER) picks the class by its route table and
"! creates it by name, so a route class has no constructor parameters.
"! A refusal is ZCX_OSD_ADT, which the handler turns into the exception
"! document; a route never writes an error body itself.
INTERFACE zif_osd_adt_route PUBLIC.

  TYPES: BEGIN OF ty_param,
           name  TYPE string,
           value TYPE string,
         END OF ty_param.
  TYPES tt_param TYPE STANDARD TABLE OF ty_param WITH DEFAULT KEY.

  "! method is upper case; path is the full path (/sap/bc/adt/...), not
  "! decoded; params are the :name segments of the matched pattern,
  "! percent-decoded after the split; query and headers as the ICF has them.
  "! uri is ~request_uri, including the query; pattern is the matched row.
  "! session is resolved only under /sap/bc/adt; sessions is available also
  "! outside that base, so logoff can end a session without resolving one.
  TYPES: BEGIN OF ty_request,
           method   TYPE string,
           path     TYPE string,
           uri      TYPE string,
           pattern  TYPE string,
           session  TYPE zif_osd_adt_session=>ty_session,
           sessions TYPE REF TO zif_osd_adt_session,
           params   TYPE tt_param,
           query    TYPE tihttpnvp,
           headers  TYPE tihttpnvp,
           body     TYPE xstring,
         END OF ty_request.

  "! What a host does after the step, when a route asks for it
  "! (docs/adt-abap-port/slice-3-front.md, "The continuation"): kind names
  "! a handler the host registered, payload is JSON for it. An initial kind
  "! is no continuation.
  TYPES: BEGIN OF ty_continuation,
           kind    TYPE string,
           payload TYPE string,
         END OF ty_continuation.

  "! content_type is written exactly as given, charset included: the wire
  "! value is part of the contract (Gate 1 compares it byte for byte).
  "! A response with a continuation is the handler's HOST verdict: on Node
  "! the host runs the continuation after the step; on a system, where no
  "! host stands behind the handler, this response is the answer.
  TYPES: BEGIN OF ty_response,
           status       TYPE i,
           content_type TYPE string,
           headers      TYPE tihttpnvp,
           body         TYPE string,
           continuation TYPE ty_continuation,
*          FENCE consumes this after dispatch; the route never rolls back.
           rollback     TYPE abap_bool,
         END OF ty_response.

  METHODS handle
    IMPORTING is_request         TYPE ty_request
    RETURNING VALUE(rs_response) TYPE ty_response
    RAISING   zcx_osd_adt.

ENDINTERFACE.
