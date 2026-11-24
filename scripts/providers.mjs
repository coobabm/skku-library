// Live directory and site-local search for the two SKKU campuses.
// Crossref member IDs identify publisher metadata; platform holdings may differ.
const memberByBrand=[
  [/^ScienceDirect$/i,78],[/^Springer$/i,297],[/^Wiley$/i,311],[/^ACM Digital Library/i,320],
  [/^ACS ?\(/i,316],[/^AIP ?\(/i,317],[/^IEL ?\(IEEE/i,263],[/^Cambridge Journals/i,56],
  [/^Oxford Journals/i,286],[/^Sage Journals/i,179],[/^Taylor (?:&|and) Francis/i,301]
];
async function sourceList(page,campus){
  const data=await api(page,'/pyxis-api/'+campus+'/er-sources',{erSourceTypeId:27});
  if(!Array.isArray(data.list) || data.list.length!==data.totalCount)fail('catalog_incomplete','馆方返回的目录不完整。');
  return data.list.map(r=>{
    const name=r.name.trim();
    const direct=/^arxiv$/i.test(name)?'arxiv':/^pubmed$/i.test(name)?'pubmed':null;
    return {site:campus+':'+r.id,name,campus,listed_entry:Boolean(r.url||r.erSourceSso),
      direct_api:direct,crossref_member:memberByBrand.find(([pattern])=>pattern.test(name))?.[1]??null,categories:(r.erSourceCategories||[]).map(c=>c.name)};
  });
}
async function trackPopup(opener){
  const visited=new Set((await task.tabs()).map(t=>t.targetId));
  let child;
  opener.waitForEvent('popup',{timeout:12000}).then(p=>{child=p;},()=>{});
  return async ()=>{
    if(child)return child;
    for(const tab of await task.tabs()){
      if(visited.has(tab.targetId))continue;
      visited.add(tab.targetId);
      const {targetInfo}=await task.cdp('Target.getTargetInfo',{targetId:tab.targetId});
      if(targetInfo?.openerId!==opener.targetId)continue;
      child=tab.label?task.page(tab.label):await task.adopt(tab.page);
      return child;
    }
    return null;
  };
}
async function openListed(catalog,entry){
  if(!entry.listed_entry)fail('no_entry','此校区没有可打开的数据库入口，请查另一校区或馆内使用说明。');
  const campus=entry.campus===1?'hsc':'nsc';
  await catalog.goto(origin+'/'+campus+'/resources/browse/database');
  await catalog.waitForSelector('a.ikc-er-source-title',{timeout:15000});
  // Select the real catalogue control, preserving the library's SSO and routing.
  const link=await catalog.evaluate(name=>{
    const links=[...document.querySelectorAll('a.ikc-er-source-title')].filter(a=>a.textContent.trim()===name);
    if(links.length!==1)return null;
    links[0].scrollIntoView({block:'center'});
    links[0].setAttribute('data-skku-lib-open','selected');
    return '[data-skku-lib-open="selected"]';
  },entry.name);
  if(!link)fail('no_entry','目录未显示唯一可用入口。');
  const popup=await trackPopup(catalog);
  await catalog.click(link,{label:'打开馆方数据库入口'});
  for(let i=0;i<30;i++){
    const page=await popup();
    if(page){
      await page.waitForLoadState('domcontentloaded',{timeout:15000}).catch(()=>{});
      return page;
    }
    if(!(await catalog.url()).includes('/resources/browse/database'))return catalog;
    await new Promise(r=>setTimeout(r,180));
  }
  fail('no_entry','点击馆方入口后没有打开网站。');
}
async function ensureSiteReady(page){
  const here=new URL(await page.url());
  if(here.hostname==='lib.skku.edu' && /\/login\b/.test(here.pathname)){
    await task.handOff();
    fail('login_required','请在当前 Ego Lite 页面完成学校登录，再带 --space 重试。');
  }
}
async function searchInput(page){
  return page.evaluate(()=>{
    const candidates=[...document.querySelectorAll('input')].filter(el=>
      ['text','search'].includes(el.type) && !el.disabled && !el.readOnly && el.getBoundingClientRect().width>0 &&
      !['hidden','collapse'].includes(getComputedStyle(el).visibility) &&
      !el.form?.querySelector('input[type=password]'));
    const scored=candidates.map(el=>{
      const hint=[el.name,el.id,el.placeholder,el.ariaLabel,el.title,el.form?.action,...[...(el.labels||[])].map(x=>x.textContent)].join(' ');
      const score=(el.type==='search'?6:0)+(/search|검색|keyword|query|检索|搜索|キーワード/i.test(hint)?5:0)+
        (/^(q|term|query|searchTerm|searchKeyword)$/i.test(el.name)?4:0);
      return {el,score};
    }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
    if(!scored.length || (scored[1]?.score===scored[0].score && scored[0].el.form!==scored[1].el.form))return null;
    scored[0].el.setAttribute('data-skku-lib-query','selected');
    return '[data-skku-lib-query="selected"]';
  });
}
async function articleLinks(page){
  return page.evaluate(()=>{
    const article=/\/(?:abs|abstract|article|articles|chapter|document|record|stable|doi(?:\/(?:abs|full))?|detail)\/[^/]|\/journal\/articleDetail|\/detail\/detail|articleDetail|artiId=|p_mat_type=|\/article\/view|scholar\.kyobobook\.co\.kr\/article|pubmed\.ncbi\.nlm\.nih\.gov\/\d+|[?&](?:nodeId|arti_id|art_id|an)=/i;
    const rows=new Map();
    const host=location.hostname;
    const platform=[
      [/sciencedirect[.-]/, /^\/search\/?$/, 'a.result-list-title-link'],
      [/dbpia[.-]/, /^\/search\//, 'a.thesis__pageLink'],
      [/kstudy[.-]/, /^\/search\/result/i, '.title a[href^="javascript:moveDetail"]'],
      [/link[.-]springer[.-]/, /^\/search/, '.app-card-open__heading a[href]']
    ].find(([domain])=>domain.test(host));
    if(platform && !platform[1].test(location.pathname))return [];
    const resultLinks = document.querySelectorAll('.result-list-title-link,.app-card-open__heading a[href],.thesis__pageLink,.title a[href^="javascript:moveDetail"]');
    const candidates = platform ? document.querySelectorAll(platform[2]) : resultLinks.length ? resultLinks : document.querySelectorAll('a[href]');
    for(const a of candidates){
      if(a.closest('header,footer,nav,aside')||!a.getClientRects().length)continue;
      let u;try{u=new URL(a.href);}catch{continue;}
      if (/^(?:help|support)\./i.test(u.hostname) || /\/(?:support|help)\//i.test(u.pathname))continue;
      const title=(a.innerText||a.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim();
      if(/(?:^|[.-])kstudy(?:[.-]|$)/i.test(location.hostname) && a.parentElement?.classList.contains('title')){
        const match=/^javascript:moveDetail\('([a-z]+)','(\d+)','P'\);?$/i.exec(a.getAttribute('href')||'');
        if(match && title){
          const key='kiss-'+match[1]+'-'+match[2];
          a.dataset.skkuPaper=key;
          rows.set(key,{title,key,url:location.href});
          continue;
        }
      }
      if(!/^https?:$/.test(u.protocol)||!article.test(u.href)||title.length<5||/^(?:view|download|full text|abstract|PDF|원문보기|초록보기)$/i.test(title))continue;
      u.hash='';
      if(!rows.has(u.href))rows.set(u.href,{title,url:u.href});
    }
    return [...rows.values()];
  });
}
async function nativeSearch(page,query){
  await ensureSiteReady(page);
  let selector;
  for(let i=0;i<12&&!selector;i++){
    selector=await searchInput(page);if(!selector)await new Promise(r=>setTimeout(r,350));
  }
  if(!selector)fail('site_search_unavailable','当前数据库未显示可识别的站内检索框，可能需要馆内访问或人工操作。');
  const prior=new Set((await articleLinks(page)).map(r=>r.url+' '+r.title));
  const oldURL=await page.url();
  const popup=await trackPopup(page);
  await page.fill(selector,query);
  const submit=await page.evaluate(sel=>{
    if(document.querySelector(sel)?.id==='qs' && /sciencedirect[.-]/.test(location.hostname) && document.querySelector('button[aria-label="Submit quick search"]'))return 'button[aria-label="Submit quick search"]';

    const field=document.querySelector(sel);
    for(const scope of [field?.parentElement,field?.form]){
      if(!scope)continue;
      const matches=[...scope.querySelectorAll('button,input[type=submit]')].filter(b=>b.getClientRects().length &&
        [b.getAttribute('aria-label'),b.title,b.innerText,b.value].some(s=>/^(검색|search|submit quick search|검색하기|检索|搜索)$/i.test(s?.trim()||'')));
      if(matches.length===1){matches[0].dataset.skkuSubmit='true';return '[data-skku-submit="true"]';}
    }
    return null;
  },selector);
  if(submit)await page.click(submit,{label:'提交站内检索'});else await page.press(selector,'Enter');
  let sawEmpty=false;
  for(let i=0;i<28;i++){
    page=(await popup())||page;
    await ensureSiteReady(page);
    const rows=await articleLinks(page);
    const fresh=rows.filter(r=>!prior.has(r.url+' '+r.title));
    if(fresh.length)return {page,rows:fresh};
    if((await page.url())!==oldURL && await page.evaluate(()=>/no results (?:were )?found|검색 결과가 없습니다|검색결과가 없습니다|검색된 결과가 없습니다|没有找到相关/.test((document.body?.innerText||'').toLowerCase())))sawEmpty=true;
    await new Promise(r=>setTimeout(r,350));
  }
  if(sawEmpty)return {page,rows:[]};
  fail('site_results_unrecognized','未取得能确认的论文结果。可用 open-source 打开馆方入口。');
}
async function catalogAction(library){
  if(args.action==='sources'){
    const all=(await Promise.all([sourceList(library,1),sourceList(library,2)])).flat();
    const match=(args.query||'').trim().toLowerCase();
    const items=all.filter(r=>r.name.toLowerCase().includes(match));
    return {total:items.length,unique_names:new Set(items.map(r=>r.name.toLowerCase())).size,items};
  }
  const parsed=/^([12]):\d+$/.exec(args.site);
  if(!parsed)fail('source_missing','请传 sources 返回的完整 site ID。');
  const entry=(await sourceList(library,Number(parsed[1]))).find(r=>r.site===args.site);
  if(!entry)fail('source_missing','当前校区目录没有这个条目。');
  const catalog=await task.newPage();
  const site=await openListed(catalog,entry);
  if(args.action==='open-source')return {site:entry.site,name:entry.name,space:task.spaceId,page:site.label};
  if(args.action==='site-download' && entry.name==='ScienceDirect' && /^pii:S[A-Z0-9]{12,24}$/i.test(args.id)){
    await ensureSiteReady(site);
    await site.waitForFunction(()=>/^(?:www\.sciencedirect\.com|www-sciencedirect-com(?:-ssl)?\.ca\.skku\.edu)$/.test(location.hostname),undefined,{timeout:15000});
    const ref=new URL('/science/article/pii/'+args.id.slice(4),await site.url());
    return saveFromEntry(site,ref.href);
  }
  const result=await nativeSearch(site,args.query);
  const {createHash}=await import('node:crypto');
  const seen=new Set(), rows=[];
  for(const r of result.rows){
    const u=new URL(r.url);
    // Only hash stable article identity; never emit publisher session URLs.
    const keys=[...u.searchParams].filter(([k])=>/^(nodeId|artiId|arti_id|art_id|id|key|an|control_no)$/i.test(k));
    const pii=entry.name==='ScienceDirect' && /^\/science\/article\/pii\/(S[A-Z0-9]{12,24})\/?$/i.exec(u.pathname);
    const id=pii?'pii:'+pii[1]:createHash('sha256').update([entry.site,u.hostname,u.pathname,r.key||JSON.stringify(keys),r.title].join('\n')).digest('hex').slice(0,24);
    if(!seen.has(id)){rows.push({...r,id});seen.add(id);}
    if(rows.length>=args.limit)break;
  }
  if(args.action==='site-search')return {site:entry.site,name:entry.name,query:args.query,count:rows.length,items:rows.map(({id,title})=>({id,title}))};
  const item=rows.find(r=>r.id===args.id);
  if(!item)fail('record_not_found','站内检索结果已变化，请重新搜索并选择结果 ID。');
  if(item.key){
    const popup=await trackPopup(result.page);
    await result.page.click('[data-skku-paper="'+item.key+'"]',{label:'打开选定论文'});
    for(let i=0;i<20;i++){
      const child=await popup();
      if(child)return saveFromEntry(child,null);
      if((await result.page.url())!==item.url)return saveFromEntry(result.page,null);
      await new Promise(r=>setTimeout(r,200));
    }
    fail('no_download','未打开所选论文的详情页。');
  }
  return await saveFromEntry(result.page,item.url);
}
async function saveFromEntry(page,url){
  await fs.mkdir(path.dirname(args.out),{recursive:true});
  const dir=await fs.mkdtemp(path.join(path.dirname(args.out),'.skku-'));
  const tmp=path.join(dir,'download');
  try{await follow(page,url,tmp);return await saveValidated(tmp,args.out);}
  finally{await fs.rm(dir,{recursive:true,force:true});}
}
