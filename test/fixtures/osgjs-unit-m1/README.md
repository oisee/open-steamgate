# Generated-class CI fixture

The ABAPiti M1 add and factorial classes supplied for the folder-runner task,
with their generated ABAP Unit includes (seven methods per owner). Expected
values in the includes come from wazero, as their generator comments record.
No `.clas.xml` is included: both CI commands must stage missing metadata.

The suite prefers the launcher's `.local/abapiti/` folder when present and uses
these templates in a fresh checkout, staging them under their abapGit names in
a temporary caller folder. This keeps fixture templates out of checkout-object
override diagnostics while running the same 14-test check in CI.
