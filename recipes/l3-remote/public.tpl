{{#remote}}
    CLASS-METHODS remote_receive IMPORTING is_header TYPE {{header}} it_rows TYPE {{rows}}
      RETURNING VALUE(rs_result) TYPE {{receipt}}.
{{/remote}}
