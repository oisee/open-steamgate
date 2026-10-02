"! The ADT session (ADR 0007, slice 3): what tools/adt-session.mjs Sessions
"! does in Node, in ABAP. A client logs on, gets a CSRF token and cookies,
"! may ask for state, locks objects under handles, and logs off or expires.
"!
"! The split of slice 3: this interface and its implementation are the
"! session (the cookies, statefulness, the end, the lock handles, and the
"! ENQ session the lock route takes its locks in); the CSRF check
"! (fetch / Required / 403) is the handler's and reads only TOKEN_VALID and
"! the token RESOLVE answers.
"!
"! The state lives in tables, so it outlives a warm swap and is the same for
"! every work process. On a system ICF owns the session, and this interface
"! is implemented over it instead.
"!
"! Who the system is (the system id in the session cookie's name, the
"! client, the default user) is never a constant here: it is the host's
"! identity (ZCL_OSD_ADT_HOST=>IDENTITY), one configurable id per system.
"!
"! Sessions expire after an idle time (Node: 30 minutes). RESOLVE first
"! ends every expired session, as the Node middleware sweeps before each
"! request, so an abandoned session's locks do not outlive it. Looking at a
"! session without being its request (TOKEN_VALID, ALIVE) never touches it
"! and never revives an expired one.
"!
"! A dump ends a bound context's ENQ session (tools/osd-enq-host.mjs) and
"! with it the session's locks; its handles must go too (ENQ_CONTEXT_ENDED),
"! while the logon session and its token stay, as in Node.
"!
"! Header names, the value stateful and object types and names compare
"! without case.
"!
"! Two things an implementation must keep in mind:
"!   - The handler fences session writes before route work, so a route
"!     exception rolls back its work while the resolved session stays.
"!   - RESOLVE touches the session on every request, a database write. The
"!     touch must not wait on, or take, a lock another step holds: it is a
"!     row of the session table only, never the ENQ lock table.
INTERFACE zif_osd_adt_session PUBLIC.

  "! the stateful context's cookie; the session cookie's name comes from the
  "! identity: SAP_SESSIONID_<system id>_<client>
  CONSTANTS c_context_cookie TYPE string VALUE `sap-contextid`.

  TYPES: BEGIN OF ty_session,
           "! 24 lower-case hex characters
           id       TYPE string,
           "! the Basic header's user, upper case, else the identity's user; taken
  "! when the session opens, never replaced by a later request's header
           user     TYPE string,
           "! the CSRF token: never the word fetch
           token    TYPE string,
           stateful TYPE abap_bool,
           "! opened by this request
           fresh    TYPE abap_bool,
         END OF ty_session.

  "! The request's session. A non-empty context cookie wins; an empty or
  "! missing one falls back to the session cookie, as Node's sessionIdOf
  "! (context || session); when neither names a live session, a new one
  "! opens; the header
  "! x-sap-adt-sessiontype = stateful marks it stateful (nothing unmarks it).
  "! The session is touched. A stateful session's step is bound to its ENQ
  "! session with the session's user, so its locks outlive the request.
  METHODS resolve
    IMPORTING it_cookies        TYPE tihttpnvp
              it_headers        TYPE tihttpnvp
    RETURNING VALUE(rs_session) TYPE ty_session
    RAISING   zcx_osd_adt.

  "! the Set-Cookie values to send: both cookies when the session is fresh
  "! or stateful, none otherwise; the context cookie with Path=/sap/bc/adt,
  "! the session cookie with Path=/, both HttpOnly; SameSite=Strict
  METHODS cookies
    IMPORTING is_session        TYPE ty_session
    RETURNING VALUE(rt_cookies) TYPE string_table
    RAISING   zcx_osd_adt.

  "! whether iv_token is the CSRF token of session iv_id; false for a
  "! missing or expired session, which this does not revive
  METHODS token_valid
    IMPORTING iv_id           TYPE string
              iv_token        TYPE string
    RETURNING VALUE(rv_valid) TYPE abap_bool.

  "! Logoff, the session DELETE or expiry: the session, its handles and its
  "! ENQ session go, and with the ENQ session every lock it held.
  METHODS end
    IMPORTING iv_id TYPE string.

  "! The lock route's question about a holder (Node: Sessions.holderOf): is
  "! the session iv_id, which the lock server names as holding an object,
  "! still alive? Looked at without touching it. A session this system issued
  "! that is gone or expired is ended on the way (its locks go) and answers
  "! false; an id this system did not issue (another facade's session, ABAP
  "! outside any ADT session) is not ours to end and answers true.
  METHODS alive
    IMPORTING iv_id           TYPE string
    RETURNING VALUE(rv_alive) TYPE abap_bool.

  "! A dump ended the bound context of session iv_id: its handles go, the
  "! session and its token stay (the host calls this through
  "! onEnqContextEnded)
  METHODS enq_context_ended
    IMPORTING iv_id TYPE string.

  "! the session's handle for an object it has just locked: the one it has,
  "! or a new one
  METHODS adopt_handle
    IMPORTING iv_id            TYPE string
              iv_type          TYPE string
              iv_name          TYPE string
    RETURNING VALUE(rv_handle) TYPE string.

  "! forget a handle; the object it named, initial when the session had no
  "! such handle (not an error)
  METHODS release_handle
    IMPORTING iv_id     TYPE string
              iv_handle TYPE string
    EXPORTING ev_type   TYPE string
              ev_name   TYPE string.

  "! Forget this session's handle for one object, without ending the
  "! session or releasing its ENQ lock (the caller owns that operation).
  METHODS release_object
    IMPORTING iv_id   TYPE string
              iv_type TYPE string
              iv_name TYPE string.

  "! whether the handle is the session's for that object; whether the lock
  "! server still holds the lock is the caller's second question
  METHODS holds
    IMPORTING iv_id           TYPE string
              iv_handle       TYPE string
              iv_type         TYPE string
              iv_name         TYPE string
    RETURNING VALUE(rv_holds) TYPE abap_bool.

ENDINTERFACE.
