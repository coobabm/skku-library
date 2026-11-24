// Executed by ego-browser nodejs with a JSON-serialized args object.
const fs = await import('node:fs/promises');
const path = await import('node:path');
const {randomUUID} = await import('node:crypto');
const origin = 'https://lib.skku.edu';
let task;
function fail(code, message) { throw Object.assign(new Error(message), {code}); }
async function api(page, route, params) {
  const result = await page.evaluate(async url => {
    const response = await fetch(url, {credentials:'same-origin',signal:AbortSignal.timeout(25000)});
    const json = await response.json().catch(() => null);
    if (!response.ok || !json?.success || !json.data) return null;
    delete json.data.sessionToken;
    return json.data;
  }, route+'?'+new URLSearchParams(params));
  if (!result) fail('api_error','图书馆接口未返回有效数据。');
  return result;
}
function summary(record) {
  const fields = Object.fromEntries((record.Items || []).map(i=>[i.Name,i.Data]));
  const full = record.FullText || {};
  const links = (full.CustomLinks || []).filter(x=>x.Url && /^fulltext$/i.test(x.Category));
  return {id:record.Header.DbId+':'+record.Header.An, title:fields.Title, author:fields.Author,
    source:fields.TitleSource, database:record.Header.DbLabel, providers:links.map(x=>x.Text || x.Name),
    pdf_link:(full.Links || []).some(x=>x.Type?.toLowerCase()==='pdflink'), links};
}
async function cleanFields(page, records) {
  return page.evaluate(rows=>rows.map(r=>{
    const clean = s=>{
      const doc = new DOMParser().parseFromString(String(s || ''),'text/html');
      return (doc.body.textContent || '').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
    };
    return {...r,title:clean(r.title),author:clean(r.author),source:clean(r.source)};
  }),records.map(({links,...r})=>r));
}
async function lookup(page) {
  const {query,limit,page:num,kind='papers'}=args;
  if(kind==='books'){
    const data=await api(page,'/pyxis-api/1/collections/'+args.collection+'/search',
      {all:'k|a|'+query,facet:'false',max:limit,offset:(num-1)*limit});
    return {total:data.totalCount,items:data.list.map(({id,titleStatement,author,publication,isbn})=>({id,title:titleStatement,author,publication,isbn}))};
  }
  if(kind==='journals'){
    const data=await api(page,'/api/ebsco-publication-iq/search',
      {query,offset:1+(num-1)*limit,count:limit,orderby:'relevance',searchfield:'titlename',searchtype:'contains'});
    return {total:data.totalCount,items:data.publications.map(r=>Object.fromEntries(Object.entries(r).filter(([k])=>/^(id|title|titlename|name|issn|publisher|publicationid|isxnprnt|isxnonline)$/i.test(k))))};
  }
  const data=await api(page,'/api/ebsco-eds/search',{query,page:num,pageSize:limit,sort:'relevance',includeFacets:false});
  return {total:data.totalHits,items:data.records.map(summary)};
}
async function saveValidated(file,dest){
  const handle=await fs.open(file,'r');
  let size;
  try {
    size=(await handle.stat()).size;
    const header=Buffer.alloc(5), tail=Buffer.alloc(Math.min(size,8192));
    await handle.read(header,0,5,0); await handle.read(tail,0,tail.length,size-tail.length);
    if(header.toString()!=='%PDF-' || !tail.includes('%%EOF')) fail('invalid_pdf','返回文件不是完整的 PDF。');
  } finally { await handle.close(); }
  try {await fs.link(file,dest);}
  catch(e){if(e.code==='EEXIST')fail('file_exists','目标文件已经存在。');throw e;}
  return {id:args.id,path:dest,bytes:size};
}
async function follow(page, url, file) {
  let artifact = null;
  const waiting = new Set();
  function arm(p){
    if(waiting.has(p.label))return;
    waiting.add(p.label);
    p.waitForEvent('download',{timeout:58000}).then(d=>{artifact=d;},()=>{});
  }
  arm(page);
  try {await page.goto(url,{timeout:22000});}catch(e){if(!artifact && !/download|abort/i.test(e.message))throw e;}
  const clicked=new Set();
  const deadline=Date.now()+45000;
  let loginSince=0;
  while(Date.now()<deadline){
    if(artifact){await artifact.saveAs(file);return;}
    const here=new URL(await page.url());
    if(here.hostname==='lib.skku.edu' && /\/login\b/.test(here.pathname)){
      loginSince ||= Date.now();
      if(Date.now()-loginSince>2500){await task.handOff();fail('login_required','请在 Ego Lite 当前窗口完成学校登录，然后使用返回的 space 继续。');}
    } else {loginSince=0;}
    const snap=await page.snapshot({scope:'full_page'});
    // Use exact visible action names, including the DBpia institutional-login dismissal.
    const labels=['바로 이용하기','원본 다운받기','PDF 다운로드','Download PDF','다운받기','PDF Download','Download full text','원문보기','View PDF','PDF'];
    let acted=false;
    for(const label of labels){
      const mark=page.label+' '+here.pathname+' '+label;
      const lines=snap.split('\n');
      const matching=lines.find(s=>s.includes('"'+label+'"') && /\b(button|anchor)\b/.test(s) && s.includes('[ref='));
      if(clicked.has(mark) || (!matching && !lines.some(s=>s.trim()==='text "'+label+'"')))continue;
      const selector=matching?'@'+matching.match(/\[ref=(\d+)/)[1]:'text="'+label+'"';
      clicked.add(mark);
      const priorTabs=new Set((await task.tabs()).map(t=>t.targetId));
      await page.click(selector,{label:'打开论文下载选项'});
      if(label==='원문보기'||label==='View PDF'||label==='PDF'){
        for(let i=0;i<16&&!artifact;i++){
          const child=(await task.tabs()).find(t=>!priorTabs.has(t.targetId)&&t.openedBy!=='user');
          if(child){page=child.label?task.page(child.label):await task.adopt(child.page);arm(page);break;}
          await new Promise(r=>setTimeout(r,200));
        }
      }
      acted=true;break;
    }
    if(!acted){
      const pdf=await page.evaluate(()=>document.contentType==='application/pdf' || !!document.querySelector('embed[type="application/pdf"]'));
      if(pdf && /^https?:$/.test(here.protocol)){
        await page.fetch(here.href,{saveAs:file,timeout:25000});return;
      }
      await new Promise(r=>setTimeout(r,400));
    }
  }
  fail('no_download','出版社页面未提供可自动保存的 PDF。');
}
async function download(page,record){
  if(!record)fail('record_not_found','该页找不到此 ID，请沿用搜索时的关键词、页码和条数。');
  const urls=[];
  if(record.pdf_link){
    const idx=record.id.indexOf(':');
    const data=await api(page,'/api/ebsco-eds/retrieve',{dbId:record.id.slice(0,idx),an:record.id.slice(idx+1)});
    if(data.pdfUrl)urls.push(data.pdfUrl);
  }
  urls.push(...record.links.map(x=>x.Url));
  if(!urls.length)fail('no_full_text','此记录没有提供全文入口。');
  await fs.mkdir(path.dirname(args.out),{recursive:true});
  const dir=await fs.mkdtemp(path.join(path.dirname(args.out),'.skku-'));
  const tmp=path.join(dir,'download');
  try{
    for(const raw of new Set(urls)){
      const u=new URL(raw);
      if(!['http:','https:'].includes(u.protocol))continue;
      const campus=/^\/(suwon|nsc)/.test(new URL(await page.url()).pathname)?2:1;
      const route=u.origin===origin?u.href:origin+'/pyxis-api/'+campus+'/proxy-redirect?'+new URLSearchParams({returnUrl:u.href});
      const pub=await task.newPage();
      try{await follow(pub,route,tmp);return await saveValidated(tmp,args.out);}
      catch(e){if(e.code!=='no_download'&&e.code!=='invalid_pdf')throw e;}
    }
    fail('no_download','记录提供的全文入口均未返回可保存的 PDF。');
  }finally{await fs.rm(dir,{recursive:true,force:true});}
}
async function main(){
  if(args.space){
    const entry=(await listTaskSpaces()).find(s=>s.id===args.space);
    if(!entry)fail('space_missing','该任务空间已结束，请去掉 --space 重试。');
    task=entry.ownership==='agentDelegatedToUser'?await takeOverTaskSpace(args.space):entry.ownership==='user'?await claimTaskSpace(args.space):await taskSpace(args.space);
  }else{task=await taskSpace('SKKU library '+randomUUID().slice(0,8));}
  const tabs=await task.tabs();
  const tab=tabs.find(t=>t.url.startsWith(origin+'/search'))||tabs.find(t=>t.url==='about:blank');
  const page=tab?(tab.label?task.page(tab.label):await task.adopt(tab.page)):await task.newPage();
  if(!((await page.url()).startsWith(origin+'/')))await page.goto(origin+'/search?'+new URLSearchParams({q:args.query}));
  const results=await lookup(page);
  if(args.action==='download')return await download(page,results.items.find(r=>r.id===args.id));
  const items=args.kind==='papers'?await cleanFields(page,results.items):results.items;
  return {kind:args.kind,query:args.query,page:args.page,limit:args.limit,total:results.total,items};
}
try{
  const result=await main();
  console.log('SKKU_RESULT '+JSON.stringify({status:'ok',...result,...(!args.space?{_finish:task.spaceId}:{space:task.spaceId})}));
}catch(e){
  const known=['api_error','invalid_pdf','file_exists','login_required','no_download','record_not_found','no_full_text','space_missing'];
  console.log('SKKU_RESULT '+JSON.stringify({status:'error',code:known.includes(e.code)?e.code:'ego_error',message:known.includes(e.code)?e.message:'Ego Lite 未能完成页面操作，请检查当前窗口。',space:task?.spaceId}));
}
