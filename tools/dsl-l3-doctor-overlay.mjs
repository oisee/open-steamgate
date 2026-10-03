// Doctor recipes apply after the governor, twin and cockpit overlays.
import {readFileSync} from "node:fs";
import {governorTemplate} from "./dsl-l3-governor.mjs";
export function doctorOverlay(model, text, kind) {
  if (kind === "runner" && model.resilience?.doctor.explicit_every) {
      text = text.replace("    lv_period = ( gs_settings-vals-stale + 30 ) DIV 60.", "    lv_period = {{resilience.doctor.every}}.");
    }
  if (model.autodoctor && kind === "job") {
    const tail = "  WRITE: / ls_rule-rule, ls_rule-status, ls_rule-alerts.\n";
    const at = text.indexOf(tail);
    if (at < 0) throw new Error("doctor recipe needs the pile report's tail anchor");
    text = text.slice(0, at + tail.length) + readFileSync("recipes/l3-doctor/job-tail.tpl", "utf8");
  }
  if (model.autodoctor && kind === "runner") {
    text = governorTemplate(text, JSON.parse(readFileSync("recipes/l3-doctor/runner.patch.json", "utf8")));
    if (model.governor) {
      const flow = "    IF ls_pile-job_count IS NOT INITIAL AND rs_rule-status <> 'GLASS'.";
      text = text.replace(flow, "{{^autodoctor}}\n" + flow).replace("    ENDIF.\n{{/governor}}\n  ENDMETHOD.\n\n  METHOD write.", "    ENDIF.\n{{/autodoctor}}\n{{/governor}}\n  ENDMETHOD.\n\n  METHOD write.");
      const dispatch = `{{#autodoctor}}
    LOOP AT lt_gates INTO ls_gate WHERE status = 'OPEN'.
      flow( iv_run = iv_run iv_date = iv_date iv_stage = ls_gate-stage_no iv_bind = iv_bind{{^with_params}} ).{{/with_params}}
{{#with_params}}
            is_params = is_params ).
{{/with_params}}
    ENDLOOP.
{{/autodoctor}}
`;
      text = text.replace(/(  METHOD heal\.[\s\S]*?)(  ENDMETHOD\.)/, (_, body, end) => body.replace("{{#settings}}\n    gs_settings-vals = ls_pass.", dispatch + "{{#settings}}\n    gs_settings-vals = ls_pass.") + end);
    }
    if (model.release_event) text = governorTemplate(text, JSON.parse(readFileSync("recipes/l3-doctor/release.patch.json", "utf8")).filter((p) => !p.governor || model.governor));
    if (model.autodoctor.arm_job) text = text.replace(/(  METHOD run\.[\s\S]*?)(  ENDMETHOD\.)/, "$1    IF iv_mode = c_parallel AND rs_result-status = 'SUBMITTED'.\n      arm_doctor_job( ).\n    ENDIF.\n$2");
    if (model.daemon) text = text.replace(/(  METHOD run\.[\s\S]*?)(  ENDMETHOD\.)/, "$1{{#daemon}}\n    IF iv_mode = c_parallel AND rs_result-status = 'SUBMITTED'.\n      start_daemon( ).\n    ENDIF.\n{{/daemon}}\n$2");
    if (!model.resilience.doctor.job) text = text.replace("    schedule_doctor( ).", "").replace("    rs_deleted = unschedule_doctor( ).", "");
    text = text.replace(/ENDCLASS\.\s*$/, readFileSync("recipes/l3-doctor/runner.tpl", "utf8") + "ENDCLASS.\n");
  }
  return text;
}

// Keep the watcher artefacts beside their overlays; the main renderer owns XML and traces.
export async function renderDoctor(model, {renderRecipe, sidecar, progXml, classXml}) {
  const results = [], files = {};
  if (model.autodoctor) {
    const report = await renderRecipe(model, "recipes/l3-doctor/report.tpl", {profile: "abap"});
    results.push([`${model.autodoctor.doctor_report}.prog.abap`, report]);
    files[`${model.autodoctor.doctor_report}.prog.trace.json`] = sidecar(model, "recipes/l3-doctor/report.tpl", report);
    files[`${model.autodoctor.doctor_report}.prog.abap`] = report.text;
    files[`${model.autodoctor.doctor_report}.prog.xml`] = progXml({...model, report: model.autodoctor.doctor_report});
    if (model.daemon) {
      const daemon = await renderRecipe(model, "recipes/l3-doctor/daemon.tpl", {profile: "abap"});
      results.push([`${model.daemon.daemon_class}.clas.abap`, daemon]);
      files[`${model.daemon.daemon_class}.clas.trace.json`] = sidecar(model, "recipes/l3-doctor/daemon.tpl", daemon);
      files[`${model.daemon.daemon_class}.clas.abap`] = daemon.text;
      files[`${model.daemon.daemon_class}.clas.xml`] = classXml(model, model.daemon.daemon_class);
    }
  }
  return {results, files};
}
