// abapGit's repository layout, shared by import and source layers.
import {existsSync, readFileSync} from 'node:fs';
import {join, resolve, relative, isAbsolute} from 'node:path';
export const ABAPGIT_XML = '.abapgit.xml';
export function repositoryConfig(folder) {
  const file = join(folder, ABAPGIT_XML);
  const declared = existsSync(file);
  const text = declared ? readFileSync(file, 'utf8') : '';
  const value = tag => new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i').exec(text)?.[1];
  const config = {startingFolder: value('STARTING_FOLDER') ?? '/src/',
    folderLogic: (value('FOLDER_LOGIC') ?? 'PREFIX').toUpperCase(),
    masterLanguage: value('MASTER_LANGUAGE') ?? 'E', declared};
  if (!['FULL', 'PREFIX'].includes(config.folderLogic)) throw new Error(`unsupported abapGit folder logic: ${config.folderLogic}`);
  sourceFolder(folder, config);
  return config;
}
export function sourceFolder(folder, config) {
  const wanted = config.startingFolder.replace(/^\/+|\/+$/g, '');
  if (wanted.includes('\\') || wanted.split('/').includes('..') || /^[A-Za-z]:/.test(wanted)) {
    throw new Error(`unsafe abapGit starting folder: ${config.startingFolder}`);
  }
  const source = resolve(folder, wanted);
  const rel = relative(resolve(folder), source);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('../')) throw new Error('abapGit starting folder escapes repository');
  return source;
}
