INTERFACE zif_osd_transaction PUBLIC.

* What a transaction of this system is (backlog G.3, docs/webgui.md).
*
* A transaction code in a *.tran.xml names a class the way SE93 names one --
* TSTCP-PARAM = \CLASS=..\METHOD=.. -- and the class is enterable when it
* implements this interface. The METHOD of the tran object is this
* interface's rather than a name of its own: the object says which class,
* the contract says which methods.
*
* One dialog step is the dynpro cycle, and ZCL_OSD_TRAN drives it:
*
*   ROLL_IN    the state the last step left, as a string; empty the first time
*   PBO        build the controls for that state (a container, a
*              cl_gui_html_viewer with the document, SET HANDLER for sapevent)
*   PAI        cl_gui_html_viewer=>dispatch_sapevent raises the event on the
*              viewer PBO built, and the handler of this class changes its
*              own state. Nothing calls a method of this interface for it:
*              the click arrives as the ABAP event it is
*   PBO        again, so what is rendered is the state after the click
*   ROLL_OUT   the state, as a string, back into the session row
*
* The state is a string and not an object graph, and that is the price of
* the session design: a row in ZOSD_TSES survives a work process dying and
* works in the browser deployment, where there is no pool to pin to, but
* nothing can be carried between two steps that does not survive being
* serialised. docs/webgui.md says what that gave up.

* what the last dialog step left behind; initial on the first step
  METHODS roll_in
    IMPORTING
      iv_state TYPE string.

* what this step leaves for the next one
  METHODS roll_out
    RETURNING
      VALUE(rv_state) TYPE string.

* build the controls for the state this instance is in. Called once before
* the event is dispatched and once after it, so it must be repeatable.
  METHODS pbo.

* what the screen puts in its title, beside the transaction code
  METHODS title
    RETURNING
      VALUE(rv_title) TYPE string.

* one line for the status bar, or initial to leave the screen's own there
  METHODS message
    RETURNING
      VALUE(rv_message) TYPE string.

ENDINTERFACE.
