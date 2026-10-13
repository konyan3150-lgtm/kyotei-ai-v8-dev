// Durable storage of the pre-close purchase journal between runs, using workflow artifacts (kept 7 days),
// not the dependency cache (which may be evicted). Each run uploads its journal, when it still has entries, as
// "preclose-journal-<run_id>-<run_attempt>" (unique, so a re-run never collides and nothing is overwritten).
// The next run restores the union of every unexpired journal artifact made by the production update workflow on
// main (the old fixed name "preclose-journal" is also accepted). Merging never drops an entry: entries are closed
// only by confirm (origin holds the purchase) in the update cycle.
// Any failed listing / incomplete listing / download / missing or invalid journal in an artifact is an error (exit 2),
// never "no purchases".
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {readJournal,writeJournal,emptyJournal,SCHEMA} from './carry_preclose_saves.mjs';

export const ARTIFACT='preclose-journal',FILE='preclose-journal.json',MAX_PAGES=200;
export const artifactName=(runId,attempt)=>`${ARTIFACT}-${runId}-${attempt}`;
export const isJournalArtifact=name=>name===ARTIFACT||new RegExp(`^${ARTIFACT}-\\d+-\\d+$`).test(String(name));

export function mergeJournals(journals){
  const out=emptyJournal();
  for(const j of journals){
    if(j?.schema!==SCHEMA||j.version!==1||!j.entries||typeof j.entries!=='object'||Array.isArray(j.entries))throw Error('Invalid journal in merge');
    for(const part of ['entries','unrecoverable'])for(const [key,e] of Object.entries(j[part]||{})){
      const cur=out[part][key];
      if(!cur||String(e.captured_at||'')<String(cur.captured_at||''))out[part][key]=e;
    }
  }
  return out;
}

// Every page until the reported total is reached; hitting the page cap first is an error (a partial list is never "all").
export async function listAll(fetchPage,maxPages=MAX_PAGES){
  const out=[];let total=null;
  for(let page=1;page<=maxPages;page++){
    const r=await fetchPage(page);
    if(!Number.isInteger(r?.total_count)||!Array.isArray(r?.artifacts))throw Error('Unexpected artifact list response');
    total??=r.total_count;out.push(...r.artifacts);
    if(r.artifacts.length===0||out.length>=total)return out;
  }
  throw Error(`artifact list incomplete after ${maxPages} pages (${out.length}/${total})`);
}

export async function restore({listArtifacts,isProductionRun,downloadJournal,attempts=3,wait=ms=>new Promise(r=>setTimeout(r,ms))}){
  let last;
  for(let i=0;i<attempts;i++){
    try{
      const list=[];
      for(const a of await listArtifacts())if(isJournalArtifact(a.name)&&!a.expired&&await isProductionRun(a))list.push(a);
      const journals=[];
      for(const a of list)journals.push(await downloadJournal(a));
      return {journal:mergeJournals(journals),artifacts:list.length};
    }catch(e){last=e;if(i+1<attempts)await wait(2000*(i+1));}
  }
  throw Error(`journal restore failed: ${last?.message||last}`);
}

// Inside a downloaded artifact the journal file must exist and be a regular file (a missing one is an error,
// unlike a local journal that was simply never written).
export function readArtifactJournal(dir){
  const f=path.join(dir,FILE);let st;
  try{st=fs.lstatSync(f);}catch{throw Error(`artifact has no ${FILE}`);}
  if(!st.isFile())throw Error(`${FILE} in artifact is not a regular file`);
  return readJournal(f);
}

function gh(args){return execFileSync('gh',args,{encoding:'utf8',maxBuffer:1<<30});}
async function main(){
  const [mode,file]=process.argv.slice(2),repo=process.env.GITHUB_REPOSITORY;
  const workflowPath=process.env.JOURNAL_WORKFLOW_PATH||'.github/workflows/update-live-odds.yml',branch=process.env.JOURNAL_BRANCH||'main';
  if(mode==='restore'){
    const local=fs.existsSync(file)?readJournal(file):emptyJournal();
    const runs=new Map();
    const {journal,artifacts}=await restore({
      listArtifacts:()=>listAll(page=>JSON.parse(gh(['api',`repos/${repo}/actions/artifacts?per_page=100&page=${page}`]))),
      // Only journals made by the production update workflow on main.
      isProductionRun:async a=>{
        if(a.workflow_run?.head_branch!==branch)return false;
        const id=a.workflow_run?.id;if(!runs.has(id))runs.set(id,JSON.parse(gh(['api',`repos/${repo}/actions/runs/${id}`])));
        const run=runs.get(id);return run.path===workflowPath&&run.head_branch===branch;
      },
      downloadJournal:async a=>{
        const dir=fs.mkdtempSync(path.join(os.tmpdir(),'journal-'));const zip=path.join(dir,'a.zip'),out=path.join(dir,'x');
        try{fs.writeFileSync(zip,execFileSync('gh',['api',a.archive_download_url],{maxBuffer:1<<30}));
          execFileSync('unzip',['-q','-o',zip,'-d',out]);return readArtifactJournal(out);}
        finally{fs.rmSync(dir,{recursive:true,force:true});}
      }
    });
    const merged=mergeJournals([local,journal]);writeJournal(file,merged);
    console.log(JSON.stringify({journal_restored_from_artifacts:artifacts,journal_entries:Object.keys(merged.entries).length,journal_unrecoverable:Object.keys(merged.unrecoverable).length}));
  }else if(mode==='status'){
    const j=readJournal(file),n=Object.keys(j.entries).length,u=Object.keys(j.unrecoverable).length;
    if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,`entries=${n}\nunrecoverable=${u}\nkeep=${n+u>0?'true':'false'}\nname=${artifactName(process.env.GITHUB_RUN_ID||'0',process.env.GITHUB_RUN_ATTEMPT||'1')}\n`);
    console.log(JSON.stringify({journal_entries:n,journal_unrecoverable:u}));
    if(u)console.log(`::error::${u} pre-close purchases could not be added to origin; see the journal artifact`);
  }else throw Error('Usage: journal_store.mjs restore|status JOURNAL_FILE');
}
if(import.meta.url===`file://${process.argv[1]}`){
  try{await main();}catch(e){console.error(`::error::${e?.message||e}`);process.exit(2);}
}
