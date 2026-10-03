REPORT {{autodoctor.doctor_report}}.
* Dispatcher step: a daemon callback cannot execute SUBMIT on a system.
START-OF-SELECTION.
  DATA lt_report TYPE {{class}}=>tt_doctor.
  lt_report = {{class}}=>doctor( ).
{{#autodoctor.wake_retry}}
  {{class}}=>arm_retry( ).
{{/autodoctor.wake_retry}}
