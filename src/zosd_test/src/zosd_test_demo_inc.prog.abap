*&---------------------------------------------------------------------*
*& Include ZOSD_TEST_DEMO_INC
*&---------------------------------------------------------------------*
* An include is a program without a header. ZOSD_TEST_DEMO_PROG reaches
* this one with INCLUDE, so the package carries the PROG/I kind as an
* object a client can be asked to show and to open, and not only as a
* row in a table of types.

CONSTANTS gc_unit TYPE string VALUE 'pcs'.

FORM describe_total
  USING    iv_total TYPE i
  CHANGING cv_text  TYPE string.

  DATA lv_total TYPE string.

  lv_total = iv_total.
  CONCATENATE lv_total gc_unit INTO cv_text SEPARATED BY space.

ENDFORM.
