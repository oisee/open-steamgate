{{! Only keys are copied for update and delete. }}
{{#inputs}}{{#key}} {{parameter}}{{#component}}-{{component}}{{/component}} = ls_converted_keys-{{field}}.
{{/key}}
{{/inputs}}
