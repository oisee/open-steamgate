* A progress indicator with nobody watching.
*
* abapGit's own class calls SAPGUI_PROGRESS_INDICATOR, which is a screen a
* user is sitting in front of. Off stack there is no screen and no
* function module, so the call ends the pack decode with
* CX_SY_DYN_CALL_ILLEGAL_FUNC halfway through a clone.
*
* Nothing else about progress matters here: a fetch either answers or
* raises. So this keeps abapGit's interface and does nothing with it. The
* name is abapGit's because zcl_abapgit_git_pack and zcl_abapgit_git_delta
* ask for the instance by name; the real class is excluded from the
* library in abap_transpile.json.
CLASS zcl_abapgit_progress DEFINITION
  PUBLIC
  FINAL
  CREATE PROTECTED .

  PUBLIC SECTION.

    INTERFACES zif_abapgit_progress .

    CLASS-METHODS set_instance
      IMPORTING
        !ii_progress TYPE REF TO zif_abapgit_progress .
    CLASS-METHODS get_instance
      IMPORTING
        !iv_total          TYPE i
      RETURNING
        VALUE(ri_progress) TYPE REF TO zif_abapgit_progress .

  PROTECTED SECTION.
    CLASS-DATA gi_progress TYPE REF TO zif_abapgit_progress .
  PRIVATE SECTION.
ENDCLASS.



CLASS zcl_abapgit_progress IMPLEMENTATION.


  METHOD get_instance.

    IF gi_progress IS NOT BOUND.
      CREATE OBJECT gi_progress TYPE zcl_abapgit_progress.
    ENDIF.
    gi_progress->set_total( iv_total ).
    ri_progress = gi_progress.

  ENDMETHOD.


  METHOD set_instance.

    gi_progress = ii_progress.

  ENDMETHOD.


  METHOD zif_abapgit_progress~off.

    RETURN.

  ENDMETHOD.


  METHOD zif_abapgit_progress~set_total.

    RETURN.

  ENDMETHOD.


  METHOD zif_abapgit_progress~show.

    RETURN.

  ENDMETHOD.

ENDCLASS.
