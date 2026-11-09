// Publish/copy base images atomically without ever overwriting a file another
// runtime has already opened. The image is optimization, never recovery.
import {existsSync, mkdirSync, copyFileSync, linkSync, rmSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fingerprintOf} from './osd-persist.mjs';
import {BASE_DIR} from './sqlite-file-client.mjs';
export function baseImage(ddl, insert, seed) {
  return join(BASE_DIR, `${fingerprintOf([ddl, ...insert, ...seed])}.sqlite`);
}
export function copyBase(base, path) {
  if (existsSync(path) || !existsSync(base)) return;
  mkdirSync(dirname(path), {recursive:true});
  const temporary = `${path}.${process.pid}.base-copy`;
  try {
    copyFileSync(base, temporary);
    try {linkSync(temporary,path);} catch(error) {if(error.code !== 'EEXIST') throw error;}
  } finally {rmSync(temporary,{force:true});}
}
export function publishBase(db, base, result, tables) {
  if (existsSync(base) || Number(process.env.STG_DATA_SCALE ?? 0) > 0 || result.created.length !== tables) return;
  const temporary = `${base}.${process.pid}.base-build`;
  try {
    db.fork(temporary);
    const image = new DatabaseSync(temporary);
    try {image.exec('DROP TABLE IF EXISTS zosd_job_source_instance');} finally {image.close();}
    try {linkSync(temporary,base);} catch(error) {if(error.code !== 'EEXIST') throw error;}
  } catch(error) {console.error(`The base image could not be written: ${error.message}`);}
  finally {rmSync(temporary,{force:true});rmSync(`${temporary}.forking`,{force:true});}
}
