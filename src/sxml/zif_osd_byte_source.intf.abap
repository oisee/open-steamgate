"! A byte stream handed out in chunks. An empty xstring means end of
"! stream, and every later call answers empty again. A chunk is never
"! empty before that, and its length says nothing: one byte and the whole
"! stream are both legal. A source that cannot go on (a file that cannot
"! be read, a limit exceeded) raises ZCX_OSD_BYTE_SOURCE, unchecked, rather
"! than ending the stream early; whoever opened a source closes it.
INTERFACE zif_osd_byte_source PUBLIC.
  METHODS next
    RETURNING VALUE(rv) TYPE xstring.
ENDINTERFACE.
