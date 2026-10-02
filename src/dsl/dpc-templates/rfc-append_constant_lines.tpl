{{! Table constants append one nonempty row per parameter after all assignments. }}
{{#has_constant_tables}}

* Append lines of table parameters in the function call
{{#constant_tables}} IF ls_{{name}} IS NOT INITIAL.
   APPEND ls_{{name}} TO {{name}}.
 ENDIF.
{{/constant_tables}}
{{/has_constant_tables}}
