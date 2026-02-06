import{g as D,s as ot}from"./assets/site-rules-I3TDES-2.js";import{C as p}from"./assets/config-CjpLU7Kz.js";import{b as I,a as rt,c as at}from"./assets/storage--5bP51BW.js";const s=at("Content"),Y={domScan:[],domUpdate:[],glossaryApply:[],ipcRoundtrip:[]};function F(t,n){const e=Y[t];e.push(n),e.length>100&&e.shift()}function st(){const t={};for(const[n,e]of Object.entries(Y)){if(e.length===0)continue;const o=e.reduce((r,i)=>r+i,0);t[n]={avg:o/e.length,min:Math.min(...e),max:Math.max(...e),count:e.length}}return t}const it=new Set(["SCRIPT","STYLE","NOSCRIPT","TEMPLATE","CODE","PRE","TEXTAREA","INPUT","SELECT","BUTTON","SVG","MATH","CANVAS","VIDEO","AUDIO","IFRAME","OBJECT","EMBED"]),z="data-translated";let $=!1,w=[],m=null,E=null,c=null,O=null;function B(t){if(it.has(t.tagName)||t.getAttribute(z)||t.closest('[contenteditable="true"]')||t.hasAttribute("data-no-translate")||t.getAttribute("translate")==="no")return!0;try{const n=window.getComputedStyle(t);if(n.display==="none"||n.visibility==="hidden")return!0}catch{return!0}return!1}function _(t){if(!t)return!1;const n=t.trim();return!(n.length<p.batching.minTextLength||n.length>p.batching.maxTextLength||/^[\s\d\p{P}\p{S}]+$/u.test(n)||/^(https?:|www\.|\/\/|{|}|\[|\]|function|const |let |var )/.test(n))}function G(t){return t.normalize("NFC").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,"").replace(/[ \t]+/g," ").trim()}function j(t){const n=[],e=document.createTreeWalker(t,NodeFilter.SHOW_TEXT,{acceptNode:r=>{const i=r.parentElement;return!i||B(i)||!_(r.textContent)?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT}});let o;for(;o=e.nextNode();)n.push(o);return n}function ct(t){const n=[];for(const e of t)if(e.nodeType===Node.TEXT_NODE){const o=e.parentElement;o&&!B(o)&&_(e.textContent)&&n.push(e)}else if(e.nodeType===Node.ELEMENT_NODE){const o=e;B(o)||n.push(...j(o))}return n}async function U(){if(O===null)try{O=await D.getGlossary()}catch(t){s.error(" Failed to load glossary:",t),O={}}return O}async function lt(t,n,e,o){const r=window.getSelection();if(!r||r.isCollapsed){s.info(" No text selected");return}const i=r.toString().trim();if(!_(i)){s.info(" Selected text is not valid for translation");return}const u=G(i);s.info(" Translating selection:",u.substring(0,50)+"...");try{const a=await U(),{processedText:l,restore:g}=await D.applyGlossary(u,a),f=await I.runtime.sendMessage({type:"translate",text:l,sourceLang:t,targetLang:n,options:{strategy:e},provider:o});if(f.success&&f.result){const x=g(f.result);pt(x,r.getRangeAt(0))}else s.error(" Translation failed:",f.error),X(f.error||"Translation failed",r.getRangeAt(0))}catch(a){s.error(" Translation error:",a);const l=a instanceof Error?a.message:"Unknown error";X(l,r.getRangeAt(0))}}async function K(t,n,e,o,r=!1){if($){s.info(" Translation already in progress");return}$=!0,s.info(" Translating page...");const i=performance.now();try{const u=performance.now(),a=j(document.body),l=performance.now()-u;if(F("domScan",l),console.log(`[Content] Found ${a.length} text nodes in ${l.toFixed(2)}ms`),a.length===0){s.info(" No translatable text found");return}const g=performance.now(),f=await U(),x=performance.now()-g;F("glossaryApply",x);const T=[];for(let d=0;d<a.length;d+=p.batching.maxSize){const h=a.slice(d,d+p.batching.maxSize),L=h.map(k=>{const b=G(k.textContent||"");return b.length>p.batching.maxTextLength?b.substring(0,p.batching.maxTextLength):b}),{processedTexts:y,restoreFns:v}=await D.applyGlossaryBatch(L,f);T.push({nodes:h,texts:y,restoreFns:v})}console.log(`[Content] Processing ${T.length} batches`);let N=0,A=0,R=0,P=0;for(let d=0;d<T.length;d++){const h=T[d];try{const L=performance.now(),y=await I.runtime.sendMessage({type:"translate",text:h.texts,sourceLang:t,targetLang:n,options:{strategy:e},provider:o,enableProfiling:r}),v=performance.now()-L;if(R+=v,F("ipcRoundtrip",v),y.success&&Array.isArray(y.result)){const k=performance.now();y.result.forEach((H,V)=>{const S=h.nodes[V];if(S&&H&&S.parentElement)try{const tt=h.restoreFns[V](H),W=S.textContent||"",et=W.match(/^\s*/)?.[0]||"",nt=W.match(/\s*$/)?.[0]||"";S.textContent=et+tt+nt,S.parentElement.setAttribute(z,"true"),N++}catch{A++}});const b=performance.now()-k;P+=b,F("domUpdate",b)}else console.error(`[Content] Batch ${d+1} failed:`,y.error),A+=h.nodes.length}catch(L){console.error(`[Content] Batch ${d+1} error:`,L),A+=h.nodes.length}}const M=performance.now()-i;console.log(`[Content] Page translation complete: ${N} translated, ${A} errors
  Total: ${M.toFixed(2)}ms
  DOM Scan: ${l.toFixed(2)}ms (${(l/M*100).toFixed(1)}%)
  IPC Total: ${R.toFixed(2)}ms (${(R/M*100).toFixed(1)}%)
  DOM Update: ${P.toFixed(2)}ms (${(P/M*100).toFixed(1)}%)`),r&&console.log("[Content] Timing Stats:",st())}finally{$=!1}}async function ut(t){if(!c||$)return;const n=ct(t);if(n.length===0)return;console.log(`[Content] Translating ${n.length} dynamic text nodes`);const e=n.map(o=>{const r=G(o.textContent||"");return r.length>p.batching.maxTextLength?r.substring(0,p.batching.maxTextLength):r});try{const o=await U(),{processedTexts:r,restoreFns:i}=await D.applyGlossaryBatch(e,o),u=await I.runtime.sendMessage({type:"translate",text:r,sourceLang:c.sourceLang,targetLang:c.targetLang,options:{strategy:c.strategy},provider:c.provider});u.success&&Array.isArray(u.result)&&u.result.forEach((a,l)=>{const g=n[l];if(g&&a&&g.parentElement)try{const f=i[l](a),x=g.textContent||"",T=x.match(/^\s*/)?.[0]||"",N=x.match(/\s*$/)?.[0]||"";g.textContent=T+f+N,g.parentElement.setAttribute(z,"true")}catch{}})}catch(o){s.error(" Dynamic translation error:",o)}}function dt(){if(w.length===0)return;const t=[];for(const n of w)for(const e of n.addedNodes)(e.nodeType===Node.ELEMENT_NODE||e.nodeType===Node.TEXT_NODE)&&t.push(e);w=[],t.length>0&&ut(t)}function q(){E||(E=new MutationObserver(t=>{for(const n of t)w.length<p.mutations.maxPending&&w.push(n);m!==null&&clearTimeout(m),m=window.setTimeout(()=>{m=null,dt()},p.mutations.debounceMs)}),E.observe(document.body,{childList:!0,subtree:!0}),s.info(" MutationObserver started"))}function Q(){E&&(E.disconnect(),E=null),m!==null&&(clearTimeout(m),m=null),w=[],s.info(" MutationObserver stopped")}function pt(t,n){C();const e=n.getBoundingClientRect(),o=document.createElement("div");o.id="translate-tooltip",o.textContent=t,o.style.cssText=`
    position: fixed;
    top: ${Math.min(e.bottom+8,window.innerHeight-100)}px;
    left: ${Math.max(8,Math.min(e.left,window.innerWidth-416))}px;
    max-width: 400px;
    padding: 12px 16px;
    background: #1e293b;
    color: white;
    border-radius: 8px;
    font-size: 14px;
    line-height: 1.5;
    box-shadow: 0 10px 25px rgba(0,0,0,0.2);
    z-index: 999999;
    animation: translateFadeIn 0.2s ease;
    word-wrap: break-word;
  `;const r=document.createElement("button");r.innerHTML="&times;",r.style.cssText=`
    position: absolute;
    top: 4px;
    right: 8px;
    background: none;
    border: none;
    color: #94a3b8;
    font-size: 18px;
    cursor: pointer;
    padding: 0;
    line-height: 1;
  `,r.onclick=()=>C(),o.appendChild(r),document.body.appendChild(o),setTimeout(()=>C(),1e4)}function X(t,n){C();const e=n.getBoundingClientRect(),o=document.createElement("div");o.id="translate-tooltip",o.style.cssText=`
    position: fixed;
    top: ${Math.min(e.bottom+8,window.innerHeight-100)}px;
    left: ${Math.max(8,Math.min(e.left,window.innerWidth-416))}px;
    max-width: 400px;
    padding: 12px 16px;
    background: #991b1b;
    color: white;
    border-radius: 8px;
    font-size: 14px;
    line-height: 1.5;
    box-shadow: 0 10px 25px rgba(0,0,0,0.2);
    z-index: 999999;
    animation: translateFadeIn 0.2s ease;
  `,o.textContent=t;const r=document.createElement("button");r.innerHTML="&times;",r.style.cssText=`
    position: absolute;
    top: 4px;
    right: 8px;
    background: none;
    border: none;
    color: #fca5a5;
    font-size: 18px;
    cursor: pointer;
    padding: 0;
    line-height: 1;
  `,r.onclick=()=>C(),o.appendChild(r),document.body.appendChild(o),setTimeout(()=>C(),5e3)}function C(){const t=document.getElementById("translate-tooltip");t&&t.remove()}const Z=document.createElement("style");Z.textContent=`
  @keyframes translateFadeIn {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }
`;document.head.appendChild(Z);I.runtime.onMessage.addListener((t,n,e)=>t.type==="ping"?(e({loaded:!0}),!0):t.type==="stopAutoTranslate"?(Q(),c=null,e(!0),!0):t.type==="translateSelection"?(lt(t.sourceLang,t.targetLang,t.strategy,t.provider).then(()=>e(!0)).catch(()=>e(!1)),!0):t.type==="translatePage"?(c={sourceLang:t.sourceLang,targetLang:t.targetLang,strategy:t.strategy,provider:t.provider},K(t.sourceLang,t.targetLang,t.strategy,t.provider).then(()=>{q(),e(!0)}).catch(()=>e(!1)),!0):!1);async function J(){const t=window.location.hostname,n=await ot.getRules(t),e=await rt(["autoTranslate","sourceLang","targetLang","strategy","provider"]),o=n?.autoTranslate??e.autoTranslate,r=n?.sourceLang||e.sourceLang||"auto",i=n?.targetLang||e.targetLang||"fi",u=n?.strategy||e.strategy||"smart",a=n?.preferredProvider||e.provider||"opus-mt";n&&s.info(" Site-specific rules found for",t,n),o&&(s.info(" Auto-translate enabled, translating page..."),c={sourceLang:r,targetLang:i,strategy:u,provider:a},setTimeout(()=>{K(c.sourceLang,c.targetLang,c.strategy,c.provider).then(()=>{q()})},1e3))}document.readyState==="complete"?J():window.addEventListener("load",J);window.addEventListener("unload",()=>{Q()});s.info(" Translation content script loaded v2.3 with MutationObserver + site rules + glossary support");
//# sourceMappingURL=content.js.map
