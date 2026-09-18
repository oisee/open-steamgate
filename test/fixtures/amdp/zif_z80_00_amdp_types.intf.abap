INTERFACE zif_z80_00_amdp_types
  PUBLIC.

  " Memory byte - address and value
  TYPES: BEGIN OF ts_mem,
           addr TYPE int4,
           val  TYPE int4,
         END OF ts_mem.
  TYPES tt_mem TYPE STANDARD TABLE OF ts_mem WITH EMPTY KEY.

  " CPU state - all registers in one row
  TYPES: BEGIN OF ts_cpu_state,
           af      TYPE int4,
           bc      TYPE int4,
           de      TYPE int4,
           hl      TYPE int4,
           af_alt  TYPE int4,
           bc_alt  TYPE int4,
           de_alt  TYPE int4,
           hl_alt  TYPE int4,
           ix      TYPE int4,
           iy      TYPE int4,
           sp      TYPE int4,
           pc      TYPE int4,
           i       TYPE int4,
           r       TYPE int4,
           iff1    TYPE int4,
           iff2    TYPE int4,
           im      TYPE int4,
           cycles  TYPE int8,
           halted  TYPE int4,
         END OF ts_cpu_state.
  TYPES tt_cpu_state TYPE STANDARD TABLE OF ts_cpu_state WITH EMPTY KEY.

  " I/O port - for console output
  TYPES: BEGIN OF ts_io,
           port TYPE int4,
           val  TYPE int4,
         END OF ts_io.
  TYPES tt_io TYPE STANDARD TABLE OF ts_io WITH EMPTY KEY.

  " Output buffer - characters written to port 0
  TYPES: BEGIN OF ts_output,
           seq TYPE int4,
           chr TYPE int4,
         END OF ts_output.
  TYPES tt_output TYPE STANDARD TABLE OF ts_output WITH EMPTY KEY.

  " Flag lookup table (precomputed S/Z/P flags for 0-255)
  TYPES: BEGIN OF ts_flags,
           val   TYPE int4,
           szp   TYPE int4,
           inc_f TYPE int4,
           dec_f TYPE int4,
         END OF ts_flags.
  TYPES tt_flags TYPE STANDARD TABLE OF ts_flags WITH EMPTY KEY.

ENDINTERFACE.