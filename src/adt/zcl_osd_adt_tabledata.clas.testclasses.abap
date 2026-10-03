CLASS ltcl_preview DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS case0 FOR TESTING RAISING cx_static_check.
    METHODS case1 FOR TESTING RAISING cx_static_check.
    METHODS case2 FOR TESTING RAISING cx_static_check.
ENDCLASS.
CLASS ltcl_preview IMPLEMENTATION.
  METHOD case0.
    DATA lo_json TYPE REF TO zcl_ajson.
    lo_json = zcl_ajson=>parse( `{"count":0,"columns":[],"ms":0}` ).
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_adt_tabledata=>document( lo_json )
      exp = `<?xml version="1.0" encoding="utf-8"?>` && cl_abap_char_utilities=>newline && `<dataPreview:tableData xmlns:dataPreview="http://www.sap.com/adt/dataPreview">` && cl_abap_char_utilities=>newline && `  <dataPreview:totalRows>0</dataPreview:totalRows>` && cl_abap_char_utilities=>newline && `` && cl_abap_char_utilities=>newline && `  <dataPreview:isHanaAnalyticalView>false</dataPreview:isHanaAnalyticalView>` && cl_abap_char_utilities=>newline && `  <dataPreview:executedQueryString></dataPreview:executedQueryString>` && cl_abap_char_utilities=>newline && `  <dataPreview:queryExecutionTime>0</dataPreview:queryExecutionTime>` && cl_abap_char_utilities=>newline && `` && cl_abap_char_utilities=>newline && `</dataPreview:tableData>` && cl_abap_char_utilities=>newline ).
  ENDMETHOD.
  METHOD case1.
    DATA lo_json TYPE REF TO zcl_ajson.
    lo_json = zcl_ajson=>parse( `{"count":1,"columns":[{"name":"a","upper":"A","letter":"C","cells":["&<>\""]}],"ms":0}` ).
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_adt_tabledata=>document( lo_json )
      exp = `<?xml version="1.0" encoding="utf-8"?>` && cl_abap_char_utilities=>newline && `<dataPreview:tableData xmlns:dataPreview="http://www.sap.com/adt/dataPreview">` && cl_abap_char_utilities=>newline && `  <dataPreview:totalRows>1</dataPreview:totalRows>` && cl_abap_char_utilities=>newline && `` && cl_abap_char_utilities=>newline && `  <dataPreview:isHanaAnalyticalView>false</dataPreview:isHanaAnalyticalView>` && cl_abap_char_utilities=>newline && `  <dataPreview:executedQueryString></dataPreview:executedQueryString>` && cl_abap_char_utilities=>newline && `  <dataPreview:queryExecutionTime>0</dataPreview:queryExecutionTime>` && cl_abap_char_utilities=>newline && `  <dataPreview:columns>` && cl_abap_char_utilities=>newline && `    <dataPreview:metadata dataPreview:name="A" dataPreview:type="C" dataPreview:description="A" dataPreview:keyAttribute="false" dataPreview:colType="" dataPreview:isKeyFigure="false"/>` && cl_abap_char_utilities=>newline && `    <dataPreview:dataSet>` && cl_abap_char_utilities=>newline && `      <dataPreview:data>&amp;&lt;&gt;&quot;</dataPreview:data>` && cl_abap_char_utilities=>newline && `    </dataPreview:dataSet>` && cl_abap_char_utilities=>newline && `  </dataPreview:columns>` && cl_abap_char_utilities=>newline && `</dataPreview:tableData>` && cl_abap_char_utilities=>newline ).
  ENDMETHOD.
  METHOD case2.
    DATA lo_json TYPE REF TO zcl_ajson.
    lo_json = zcl_ajson=>parse( `{"count":0,"columns":[{"name":"a","upper":"A","letter":"C","cells":[]}],"ms":0}` ).
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_adt_tabledata=>document( lo_json )
      exp = `<?xml version="1.0" encoding="utf-8"?>` && cl_abap_char_utilities=>newline && `<dataPreview:tableData xmlns:dataPreview="http://www.sap.com/adt/dataPreview">` && cl_abap_char_utilities=>newline && `  <dataPreview:totalRows>0</dataPreview:totalRows>` && cl_abap_char_utilities=>newline && `` && cl_abap_char_utilities=>newline && `  <dataPreview:isHanaAnalyticalView>false</dataPreview:isHanaAnalyticalView>` && cl_abap_char_utilities=>newline && `  <dataPreview:executedQueryString></dataPreview:executedQueryString>` && cl_abap_char_utilities=>newline && `  <dataPreview:queryExecutionTime>0</dataPreview:queryExecutionTime>` && cl_abap_char_utilities=>newline && `  <dataPreview:columns>` && cl_abap_char_utilities=>newline && `    <dataPreview:metadata dataPreview:name="A" dataPreview:type="C" dataPreview:description="A" dataPreview:keyAttribute="false" dataPreview:colType="" dataPreview:isKeyFigure="false"/>` && cl_abap_char_utilities=>newline && `    <dataPreview:dataSet>` && cl_abap_char_utilities=>newline && `` && cl_abap_char_utilities=>newline && `    </dataPreview:dataSet>` && cl_abap_char_utilities=>newline && `  </dataPreview:columns>` && cl_abap_char_utilities=>newline && `</dataPreview:tableData>` && cl_abap_char_utilities=>newline ).
  ENDMETHOD.
ENDCLASS.
