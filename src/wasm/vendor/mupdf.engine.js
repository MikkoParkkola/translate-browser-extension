// MuPDF engine wrapper scaffold. Replace with real integration.
export async function init({ baseURL }) {
  let mupdf;
  try {
    // Load the MuPDF vendor script which pulls in the WASM glue.
    mupdf = await import(/* @vite-ignore */ baseURL + 'mupdf.js');
  } catch (e) {
    throw new Error('MuPDF vendor not found');
  }
  function approxTokens(s){ return Math.ceil(((s||'').length)/4); }
  function splitIntoChunks(text, maxTokens){
    const chunks=[]; const parts=(text||'').split(/(\.|!|\?|\n)/g);
    let cur='';
    for(const seg of parts){ const next=cur?cur+seg:seg; if(approxTokens(next)>maxTokens && cur){ chunks.push(cur.trim()); cur=seg; } else { cur=next; } }
    if(cur&&cur.trim()) chunks.push(cur.trim());
    const out=[]; for(const c of chunks){ if(approxTokens(c)<=maxTokens){ out.push(c); continue;} let start=0; const step=Math.max(128, Math.floor(maxTokens*4)); while(start<c.length){ out.push(c.slice(start,start+step)); start+=step; } }
    return out;
  }
  async function translatePages(pageTexts, cfg, onProgress, budget=800){
    const endpoint = cfg.apiEndpoint || cfg.endpoint;
    const model = cfg.model || cfg.modelName;
    const source = cfg.sourceLanguage || cfg.source;
    const target = cfg.targetLanguage || cfg.target;
    const mapping=[]; pageTexts.forEach((t,i)=> splitIntoChunks(t, Math.max(200, Math.floor(budget*0.6))).forEach((c,idx)=>mapping.push({page:i,idx,text:c})) );
    const results=new Array(mapping.length); let i=0;
    while(i<mapping.length){ let group=[]; let tokens=0; const maxPer=budget; while(i<mapping.length){ const tk=approxTokens(mapping[i].text); if(group.length && tokens+tk>maxPer) break; group.push(mapping[i]); tokens+=tk; i++; if(group.length>=40) break;}
      const texts=group.map(g=>g.text);
      try{
        if(onProgress) onProgress({ phase:'translate', page: Math.min(group[group.length-1].page+1, pageTexts.length), total: pageTexts.length });
        const tr= await window.qwenTranslateBatch({ texts, endpoint, apiKey: cfg.apiKey, model, source, target, tokenBudget: budget });
      const outs = (tr && Array.isArray(tr.texts))? tr.texts: texts; for(let k=0;k<group.length;k++) results[mapping.indexOf(group[k])]=outs[k]||group[k].text;
      } catch(e){ if(/HTTP 400/i.test(e?.message||'')){ return translatePages(pageTexts,cfg,onProgress, Math.max(400,Math.floor(budget*0.6))); } else { throw e; } }
    }
    const perPage=pageTexts.map(()=>[]); mapping.forEach((m,idx)=> perPage[m.page][m.idx]=results[idx]);
    return perPage.map(arr=> (arr.filter(Boolean).join(' ')));
  }
  async function extractPageTexts(buffer, onProgress){
    if(typeof pdfjsLib==='undefined') throw new Error('pdf.js not loaded');
    const pdf= await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise; const total=pdf.numPages; const out=[]; for(let p=1;p<=total;p++){ if(onProgress) onProgress({ phase:'collect', page:p, total}); const page= await pdf.getPage(p); const tc = await page.getTextContent(); const items = tc.items.map(i=> (i.str||'').trim()).filter(Boolean); out.push(items.join(' ')); }
    return out;
  }
  async function rewrite(buffer, cfg, onProgress){
    const pageTexts = await extractPageTexts(buffer, onProgress);
    const translated = await translatePages(pageTexts, cfg, onProgress);
    const doc = new mupdf.PDFDocument(new Uint8Array(buffer));
    const pageCount = doc.countPages();
    for(let i=0;i<pageCount;i++){
      if(onProgress) onProgress({ phase:'render', page:i+1, total: pageCount });
      const page = doc.loadPage(i);
      const obj = page.getObject();
      let media = obj.get('CropBox'); if(!media || !media.isArray()) media = obj.get('MediaBox');
      let box = [0,0,612,792]; try { if(media && media.isArray()){ const arr = media.asJS(); if(Array.isArray(arr)&&arr.length>=4) box = arr.map(Number); } } catch{}
      const margin = 36; const rect = [box[0]+margin, box[1]+margin, box[2]-margin, box[3]-margin];
      const annot = page.createAnnotation('FreeText');
      annot.setRect(rect);
      try { annot.setDefaultAppearance('Helvetica', 12, [0,0,0]); } catch {}
      const text = (translated[i]||'').trim();
      try { annot.setRichContents(text, `<p>${text.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</p>`); } catch {}
      page.update();
    }
    const buf = doc.saveToBuffer('');
    const bytes = buf.asUint8Array();
    return new Blob([bytes], { type:'application/pdf' });
  }
  return { rewrite };
}
