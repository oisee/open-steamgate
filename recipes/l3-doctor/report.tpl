REPORT {{autodoctor.doctor_report}}.
* Dispatcher step: a daemon callback cannot execute SUBMIT on a system.
START-OF-SELECTION.
  DATA lt_report TYPE {{class}}=>tt_doctor.
  lt_report = {{class}}=>doctor( ).
{{#release_event}}
* then the release: the claims are committed before their events are raised
  DATA lt_released TYPE {{class}}=>tt_pile.
  COMMIT WORK.
  lt_released = {{class}}=>release_claim( ).
  COMMIT WORK.
  {{class}}=>release_raise( lt_released ).
  COMMIT WORK.
{{/release_event}}
{{#autodoctor.wake_retry}}
  {{class}}=>arm_retry( ).
{{/autodoctor.wake_retry}}
