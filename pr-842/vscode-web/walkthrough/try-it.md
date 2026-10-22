## Try the extension

1. Run [OSD: Open sample](command:osd.openSample), choose a notebook, and run a cell. In an osg-demo workspace, choose **ZOSD_DEMO_HELLO** and press **F9**. If OSD is stopped, choose **Start system** when offered.
2. Open **Testing** and run an ABAP Unit class.
3. Open a class with a matching reader or a SEGW `_DPC_EXT`; click one of its CodeLens actions.
4. Open a `*.tabl.xml` file and press **F8** to preview rows.
5. Run [osd: New SQL notebook](command:osd.newSqlNotebook), add a `SELECT`, and run the cell.
6. Open the Fiori launchpad from the OSD view or the System overview page.

The status row in the OSD view opens the same overview page, combining the status service with the System information app.

Set an `.abap` breakpoint and press **F9** or the classrun **▷** to debug.
OSD starts its debugger on demand and needs no launch configuration; starting
the system does not start a debug session. ABAP-FS “Attach to server” and
“ABAP on server” are SAP debuggers. See [What connects to what](../README.md#what-connects-to-what).
