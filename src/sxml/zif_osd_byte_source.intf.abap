"! A byte stream handed out in chunks. An empty xstring means end of
"! stream, and every later call answers empty again. A chunk is never
"! empty before that, and its length says nothing: one byte and the whole
"! stream are both legal.
INTERFACE zif_osd_byte_source PUBLIC.
  METHODS next
    RETURNING VALUE(rv) TYPE xstring.
ENDINTERFACE.
