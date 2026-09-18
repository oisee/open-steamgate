INTERFACE if_amdp_marker_hdb PUBLIC.
* The marker a class implements to say that some of its methods are AMDP for
* HDB. It is empty on a real system too -- the compiler reads the marker, not
* its content -- but it has to exist, or a class implementing it does not
* parse at all: "Implemented interface IF_AMDP_MARKER_HDB not found".
*
* Clean room: this is the interface's name and nothing else. There is no SAP
* source here to copy, because there is nothing in it.
ENDINTERFACE.
