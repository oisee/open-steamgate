INTERFACE zif_gogen_t_rf PUBLIC.
  CONSTANTS co_k TYPE i VALUE 1.
  DATA mv_v TYPE i VALUE 5.
  DATA mv_ro TYPE i READ-ONLY.
  DATA value TYPE i.
  DATA: BEGIN OF ms,
          mv_x TYPE i,
        END OF ms.
  DATA mv_x TYPE i READ-ONLY.
ENDINTERFACE.
