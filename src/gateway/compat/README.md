The pinned open-abap-odata action contract lacks the standard text-label
method and its parameter alias used by SEGW output. These contract overlays
add the item interface and aliases. The local action implementation stores
metadata and creates parameter objects; its public fields are the runtime
contract, independently implemented here under this repository's MIT licence.
They are local runtime compatibility objects and do not travel to SAP.
The library input excludes exactly these three objects while the overlay
is present. Remove the overlays and exclusions when the pin carries them.
