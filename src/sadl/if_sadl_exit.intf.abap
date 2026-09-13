INTERFACE if_sadl_exit PUBLIC.
* Clean-room: the shape a SADL exit class is written against, so that an exit
* a developer wrote for a system compiles and runs here unchanged. Only what
* the calculated-element read exit needs.
*
* Both spellings of the element-info table are declared: SAP's own type is
* ty_t_element_info, exit classes in the wild also write tt_element_info.

  TYPES: BEGIN OF ty_s_element_info,
           name TYPE string,
         END OF ty_s_element_info.
  TYPES ty_t_element_info TYPE STANDARD TABLE OF ty_s_element_info WITH DEFAULT KEY.
  TYPES tt_element_info TYPE ty_t_element_info.

ENDINTERFACE.
