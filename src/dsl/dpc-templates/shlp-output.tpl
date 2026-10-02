{{! Each returned field emits a WHEN and assignment; result components use the final path segment, while input selection names keep the full upper-case path. }}
    WHEN '{{component | upper}}'.
      {{target}}-{{field}} = ls_result_list-field_value.
