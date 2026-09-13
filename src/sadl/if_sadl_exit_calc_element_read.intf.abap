INTERFACE if_sadl_exit_calc_element_read PUBLIC.
* The read exit of a virtual element: a CDS element annotated
*
*   @ObjectModel.virtualElement: true
*   @ObjectModel.virtualElementCalculatedBy: 'ABAP:ZCL_...'
*
* has no column behind it. After the SELECT, the SADL runtime asks this class
* which original elements it needs (so a $select does not drop them) and then
* to fill the calculated ones.
*
* Clean-room reimplementation of the interface signature; the implementation
* is the developer's, exactly as on a system.

  INTERFACES if_sadl_exit.

  TYPES ty_s_element_info TYPE if_sadl_exit=>ty_s_element_info.
  TYPES ty_t_element_info TYPE if_sadl_exit=>ty_t_element_info.

  METHODS get_calculation_info
    IMPORTING
      iv_entity                  TYPE string
      it_requested_calc_elements TYPE if_sadl_exit=>ty_t_element_info
    CHANGING
      ct_requested_orig_elements TYPE if_sadl_exit=>ty_t_element_info
    RAISING
      cx_sadl_contract_violation.

  METHODS calculate
    IMPORTING
      it_original_data           TYPE STANDARD TABLE
      it_requested_calc_elements TYPE if_sadl_exit=>ty_t_element_info
    CHANGING
      ct_calculated_data         TYPE STANDARD TABLE
    RAISING
      cx_sadl_contract_violation.

ENDINTERFACE.
