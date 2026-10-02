{{! Canonical integers and strings use literal; validated raw tokens retain oracle spelling. }}
{{#has_constants}}

* Maps constant value to function module parameters
{{#constants}} {{#via_line}}ls_{{/via_line}}{{parameter}}{{#component}}-{{component}}{{/component}} = {{#raw_token}}{{raw_token}}{{/raw_token}}{{^raw_token}}{{value | literal}}{{/raw_token}}.
{{/constants}}
{{/has_constants}}
