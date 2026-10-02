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
  "! percent-decoded after the split; query and headers as the ICF has them
  TYPES: BEGIN OF ty_request,
           method  TYPE string,
           path    TYPE string,
           params  TYPE tt_param,
           query   TYPE tihttpnvp,
           headers TYPE tihttpnvp,
           body    TYPE xstring,
         END OF ty_request.

  "! content_type is written exactly as given, charset included: the wire
  "! value is part of the contract (Gate 1 compares it byte for byte)
  TYPES: BEGIN OF ty_response,
           status       TYPE i,
           content_type TYPE string,
           headers      TYPE tihttpnvp,
           body         TYPE string,
         END OF ty_response.

  METHODS handle
    IMPORTING is_request         TYPE ty_request
    RETURNING VALUE(rs_response) TYPE ty_response
    RAISING   zcx_osd_adt.

ENDINTERFACE.
