DATA {{lookup}} TYPE HASHED TABLE OF {{source.table}} WITH UNIQUE KEY{{#source.keys}} {{column}}{{/source.keys}}.
FIELD-SYMBOLS {{hit}} LIKE LINE OF {{lookup}}.
IF {{loop.table}} IS NOT INITIAL.
  SELECT{{#source.keys}} {{column}}{{/source.keys}}{{#fields}} {{column}}{{/fields}} FROM {{source.table}}
    INTO CORRESPONDING FIELDS OF TABLE {{lookup}}
    FOR ALL ENTRIES IN {{loop.table}}
    WHERE {{#source.keys}}{{column}} = {{loop.table}}-{{component}}{{^@last}} AND {{/@last}}{{/source.keys}}.
ENDIF.
LOOP AT {{loop.table}} ASSIGNING {{loop.row}}.
{{#before}}  {{text}}
{{/before}}
  READ TABLE {{lookup}} ASSIGNING {{hit}} WITH TABLE KEY{{#source.keys}} {{column}} = {{loop.row}}-{{component}}{{/source.keys}}.
  IF sy-subrc = 0.
{{#fields}}
    {{loop.row}}-{{component}} = {{hit}}-{{column}}.
{{/fields}}
  ENDIF.
{{#after}}  {{text}}
{{/after}}
ENDLOOP.
