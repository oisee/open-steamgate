# Character sections

Splice a validated REPLACE SECTION span, counting characters and fitting fixed
character targets. Uses the shared bounds check; has no dependency on go/abap.

`Replace` accepts a narrow `Text` interface for UTF-16 fitting, slicing and joining.
The host supplies those operations; bounds are checked before assignment.
