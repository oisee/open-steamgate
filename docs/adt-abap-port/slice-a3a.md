# A3a: sessions and logoff

Three registrations are served by ABAP: `GET core/http/sessions` (poll),
`DELETE core/http/sessions/:id` and `GET /sap/public/bc/icf/logoff`, through
`ZCL_OSD_ADT_SESSIONS` and `ZCL_OSD_ADT_LOGOFF`. Session state keeps one owner,
`ZCL_OSD_ADT_SESSION` in the serving child under one runtime; logoff and the
compatibility `RemoteSessions.end()` both end a session through
`ZCL_OSD_ADT_LOGOFF=>END_SESSION` there.

**Depends on one-runtime B5:** the compatibility bridge for Node callers that
still end sessions stays until the parent kernel is removed. See
[one-runtime-b3.md](one-runtime-b3.md), the A3a section.
