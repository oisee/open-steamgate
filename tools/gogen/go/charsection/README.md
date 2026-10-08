# Character sections

Splice a validated REPLACE SECTION span, counting characters and fitting fixed
character targets. Uses the shared bounds check; has no dependency on go/abap: the character
runtime comes in as `Text` (lengths, sections, fit, pad, join), which
go/abap provides as `abap.Text16`.
