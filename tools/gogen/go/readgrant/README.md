# readgrant — explicit user input grants startup reads

`Apply` pins reads from the build-selected PARAMETERS and explicit CLI,
positional or JSON values before report construction. Parameter VALUES resolve
against cwd at startup, independently of DATASET's existing home/root rules.
Files grant exactly their resolved path and pinned identity; directories grant
reads below their checked root. Failed pinning warns on stderr and successful
grants appear in one startup summary. Empty input and `-no-default-reads` do nothing.
ABAP has no API here; defaults, INITIALIZATION, selection-screen changes and later
rewrites of list/JSON input cannot widen the grants in this invocation.

Supplying a list means the user vouches for every path in it, including absolute
and `../` entries and directories containing secrets. A list the report itself
wrote earlier is still the user's choice to pass. Relative entries resolve against
the supplied list's directory. Self-listing grants the file without recursion.
The list is parsed from the same descriptor retained by its file grant; installing
it never reopens the path or turns a replaced list into a directory grant.

`ParseList` strips an initial UTF-8 BOM, supports CRLF, trims lines and ignores
blank lines and comments. The entire stream is limited to 4 MiB (including BOM,
comments and whitespace) and 10,000 non-comment entries, with a 1 MiB line limit.
An unreadable or over-limit list produces one warning and installs no grants from
that list, including its own file grant. These bounds also limit retained grants
per list. Individual entries that fail to pin warn and grant nothing. Writes
remain separately authorized by explicit write roots.
