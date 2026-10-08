"! Runtime error boundary, not a host capability. On a system the kernel
"! lines are comments and a non-class-based error is a normal short dump.
CLASS zcl_osd_kernel_guard DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS has_serving_database RETURNING VALUE(rv_available) TYPE abap_bool.
    CLASS-METHODS has_generation RETURNING VALUE(rv_available) TYPE abap_bool.
    CLASS-METHODS call_classrun
      IMPORTING iv_name TYPE string
                io_out TYPE REF TO if_oo_adt_classrun_out
      EXPORTING ev_failed TYPE abap_bool ev_name TYPE string
                ev_message TYPE string ev_stack TYPE string
      RAISING cx_root.
ENDCLASS.
CLASS zcl_osd_kernel_guard IMPLEMENTATION.
  METHOD has_serving_database.
    rv_available = abap_true.
*   The reduced parent kernel holds sessions, not seeded application tables.
    WRITE '@KERNEL if (globalThis.__osdAdtKernel !== undefined) rv_available.set(" ");'.
  ENDMETHOD.
  METHOD has_generation.
    rv_available = abap_true.
*   One-runtime comes from OSD_ADT_ONE_RUNTIME or the request's
*   withSystem oneRuntime binding (STORE->oneRuntimeEnabled).
    WRITE '@KERNEL if (globalThis.__osdAdtKernel !== undefined || !((typeof process !== "undefined" && process.env?.OSD_ADT_ONE_RUNTIME === "1") || abap.context.RFCDestinations.STORE?.oneRuntimeEnabled?.() === true)) rv_available.set(" ");'.
  ENDMETHOD.
  METHOD call_classrun.
    DATA lo_run TYPE REF TO if_oo_adt_classrun.
    CLEAR: ev_failed, ev_name, ev_message, ev_stack.
*   Catch host failures in MAIN as console output, matching Node runClassrun.
    WRITE '@KERNEL try {'.
    CREATE OBJECT lo_run TYPE (iv_name).
    lo_run->main( io_out ).
    WRITE '@KERNEL } catch (e) {'.
    WRITE '@KERNEL ev_failed.set("X");'.
    WRITE '@KERNEL ev_name.set(e?.constructor?.name?.toUpperCase?.() || "");'.
    WRITE '@KERNEL ev_message.set(String(e?.message?.get?.() ?? e?.message ?? e ?? ""));'.
    WRITE '@KERNEL ev_stack.set(String(e?.stack ?? ""));'.
    WRITE '@KERNEL }'.
  ENDMETHOD.
ENDCLASS.
