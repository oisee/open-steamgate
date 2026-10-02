{{! Constants keep their lexical type; literal adds quotes and doubles embedded apostrophes. }}
{{#has_constants}}

* Maps constant value to function module parameters
{{#constants}} {{#via_line}}ls_{{/via_line}}{{parameter}}{{#component}}-{{component}}{{/component}} = {{value | literal}}.
{{/constants}}
{{/has_constants}}
