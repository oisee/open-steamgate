DATA {{names.all}} TYPE STANDARD TABLE OF {{source.table}} WITH DEFAULT KEY.
FIELD-SYMBOLS {{names.all_row}} LIKE LINE OF {{names.all}}.
DATA {{names.work}} LIKE LINE OF {{result.table}}.
DATA {{names.saved_subrc}} TYPE i.
DATA {{names.saved_dbcnt}} TYPE i.
DATA {{names.saved_tabix}} TYPE i.
{{names.saved_subrc}} = sy-subrc.
{{names.saved_dbcnt}} = sy-dbcnt.
IF {{loop.table}} IS NOT INITIAL.
  SELECT{{#source.fields}} {{column}}{{/source.fields}} FROM {{source.table}}
    INTO CORRESPONDING FIELDS OF TABLE {{names.all}}
    FOR ALL ENTRIES IN {{loop.table}}
    WHERE {{#source.keys}}{{column}} = {{loop.table}}-{{component}}{{^@last}} AND {{/@last}}{{/source.keys}}{{#source.conditions}} AND {{text}}{{/source.conditions}}.
ENDIF.
SORT {{names.all}} BY{{#source.sort}} {{column}}{{/source.sort}}.
sy-subrc = {{names.saved_subrc}}.
sy-dbcnt = {{names.saved_dbcnt}}.
LOOP AT {{loop.table}} ASSIGNING {{loop.row}}.
{{#before}}  {{text}}
{{/before}}  {{names.saved_tabix}} = sy-tabix.
  CLEAR {{result.table}}.
  LOOP AT {{names.all}} ASSIGNING {{names.all_row}} WHERE {{#source.keys}}{{column}} = {{loop.row}}-{{component}}{{^@last}} AND {{/@last}}{{/source.keys}}.
    CLEAR {{names.work}}.
{{#result.assignments}}    {{names.work}}-{{component}} = {{names.all_row}}-{{column}}.
{{/result.assignments}}    APPEND {{names.work}} TO {{result.table}}.
  ENDLOOP.
  IF {{result.table}} IS INITIAL.
    sy-subrc = 4.
  ELSE.
    sy-subrc = 0.
  ENDIF.
  sy-dbcnt = lines( {{result.table}} ).
  sy-tabix = {{names.saved_tabix}}.
{{#after}}  {{text}}
{{/after}}ENDLOOP.
