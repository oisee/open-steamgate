Usage: {{name}} [report options] [--] [positionals]
Report options:
{{#elements}}  {{cli_label}} ({{facts}}{{#default}}, default {{default | literal}}{{/default}}){{#text}}  {{text}}{{/text}}
{{/elements}}{{#groups}}  {{name}}: {{members}}
{{/groups}}Host flags: use -help for host options.
