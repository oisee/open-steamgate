{{! Create includes key inputs; update excludes them. }}
{{#inputs}}{{#is_c}} {{parameter}}{{#component}}-{{component}}{{/component}} = ls_request_input_data-{{field}}.
{{/is_c}}{{^is_c}}{{^key}} {{parameter}}{{#component}}-{{component}}{{/component}} = ls_request_input_data-{{field}}.
{{/key}}
{{/is_c}}
{{/inputs}}
