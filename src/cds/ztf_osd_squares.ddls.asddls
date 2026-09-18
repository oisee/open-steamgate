@EndUserText.label: 'Squares, computed by an AMDP table function'
@ClientHandling.type: #CLIENT_INDEPENDENT
define table function ZTF_OSD_SQUARES
  with parameters
    p_count : abap.int4
  returns {
    id     : abap.int4;
    label  : abap.char(40);
    square : abap.int4;
  }
  implemented by method zcl_osd_amdp_demo=>squares_tf;
