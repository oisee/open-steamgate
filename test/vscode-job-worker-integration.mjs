import {expect} from 'chai';
import {createRequire} from 'node:module';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const require = createRequire(import.meta.url);
const {Launcher} = require('../editors/vscode/launcher.js');
const {Osd} = require('../editors/vscode/lib.js');
describe('extension server and automatic job worker', function () {
  this.timeout(240000);
  it('SUBMITs through HTTP and reaches FINISHED without a manual worker command', async () => {
    const storageDir = mkdtempSync(join(tmpdir(), 'vsix-jobs-e2e-'));
    const scratch = join(storageDir, 'packs/notebook-scratch/src');
    mkdirSync(scratch, {recursive:true});
    writeFileSync(join(scratch,'zcl_vs_jobs_probe.clas.abap'), `CLASS zcl_vs_jobs_probe DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
ENDCLASS.
CLASS zcl_vs_jobs_probe IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.
    DATA count TYPE c LENGTH 8.
    DATA finished TYPE c LENGTH 1.
    SELECT SINGLE jobcount FROM zosd_job_identity INTO count WHERE jobname = 'VSIX_PROOF'.
    IF count IS NOT INITIAL.
      CALL FUNCTION 'SHOW_JOBSTATE' EXPORTING jobname = 'VSIX_PROOF' jobcount = count IMPORTING finished = finished.
      IF finished = 'X'.
        out->write( 'FINISHED' ).
      ELSE.
        out->write( 'WAITING' ).
      ENDIF.
      RETURN.
    ENDIF.
    CALL FUNCTION 'JOB_OPEN' EXPORTING jobname = 'VSIX_PROOF' IMPORTING jobcount = count.
    SUBMIT zosd_job_e2e WITH p_run = 'VSIX_PROOF' VIA JOB 'VSIX_PROOF' NUMBER count AND RETURN.
    CALL FUNCTION 'JOB_CLOSE' EXPORTING jobname = 'VSIX_PROOF' jobcount = count strtimmed = 'X'.
    out->write( 'SUBMITTED' ).
  ENDMETHOD.
ENDCLASS.`);
    const port = Number(process.env.STG_PORT);
    const launcher = new Launcher({osdHome:process.cwd(), storageDir, warm:'on', jobsWorker:process.env.OSD_TEST_WORKER_OFF ? 'off':'auto',
      portRange:{from:port,to:port}});
    let log = '';
    launcher.on('log', s => { log += s; }); launcher.on('jobsLog', s => { log += s; });
    try {
      try { await launcher.start(); } catch (error) { throw new Error(log, {cause:error}); }
      const base = `http://127.0.0.1:${launcher.port}`;
      const submit = await fetch(`${base}/osd/classrun`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'ZCL_VS_JOBS_PROBE'})});
      const submitted = await submit.json();
      expect(submit.status, JSON.stringify(submitted)).to.equal(200);
      expect(submitted.text).to.include('SUBMITTED');
      let run;
      for (let i=0;i<100;i++) {
        const response = await fetch(`${base}/osd/batch-runs`, {headers:{Authorization:`Bearer ${launcher.env.OSD_BATCH_READ_TOKEN}`}});
        expect(response.status).to.equal(200);
        run = (await response.json()).runs.find(r => r.jobName === 'VSIX_PROOF');
        if (run?.state === 'COMPLETED') break;
        await new Promise(r => setTimeout(r,200));
      }
      expect(run?.state, log.slice(-3000)).to.equal('COMPLETED');
      const finished = await fetch(`${base}/osd/classrun`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'ZCL_VS_JOBS_PROBE'})});
      expect((await finished.json()).text.trim()).to.equal('FINISHED');
      expect(run.resultStatus).to.equal('COMPLETED');
      const counts = await (await fetch(`${base}/osd/job-counts`, {headers:{Authorization:`Bearer ${launcher.env.OSD_BATCH_READ_TOKEN}`}})).json();
      expect(counts.counts).to.deep.equal({running:0,queued:0});
      expect(launcher.jobWorker.running).to.equal(true);
      expect(launcher.jobWorker.env).to.equal(launcher.env);
      // Change the serving generation through the same activation door as VS Code.
      // A primed runtime swaps warm; an unavailable warm runtime recycles cold.
      const oldGeneration = launcher.generation;
      const oldGuard = launcher.jobWorker.child.pid;
      const file = join(scratch, 'zcl_vs_jobs_probe.clas.abap');
      writeFileSync(file, readFileSync(file, 'utf8').replaceAll('VSIX_PROOF', 'VSIX_NEW_GENERATION'));
      const activation = await new Osd(base).activate({type:'CLAS',name:'ZCL_VS_JOBS_PROBE',base:'zcl_vs_jobs_probe'});
      expect(activation.ok, JSON.stringify(activation)).to.equal(true);
      const nextSubmit = await fetch(`${base}/osd/classrun`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'ZCL_VS_JOBS_PROBE'})});
      expect((await nextSubmit.json()).text).to.include('SUBMITTED');
      let nextRun;
      for (let i=0;i<150;i++) {
        const answer = await fetch(`${base}/osd/batch-runs`, {headers:{Authorization:`Bearer ${launcher.env.OSD_BATCH_READ_TOKEN}`}});
        nextRun = (await answer.json()).runs.find(r=>r.jobName === 'VSIX_NEW_GENERATION');
        if (nextRun?.state === 'COMPLETED' || nextRun?.state === 'FAILED') break;
        await new Promise(r=>setTimeout(r,200));
      }
      expect(nextRun?.state, log.slice(-4000)).to.equal('COMPLETED');
      expect(nextRun.generation).not.to.equal(oldGeneration);
      expect(launcher.generation).to.equal(nextRun.generation);
      expect(launcher.jobWorker.child.pid).not.to.equal(oldGuard);
      console.log(`job worker activation: ${activation.build}`);

    } finally {
      await launcher.stop();
      expect(launcher.jobWorker?.running ?? false).to.equal(false);
      rmSync(storageDir,{recursive:true,force:true});
    }
  });
});
