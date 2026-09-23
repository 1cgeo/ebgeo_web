// Protótipo de formulário da proposta; nenhuma alteração é enviada ao EBGeo.
const grid = document.querySelector('#grid');
const drafts = new Map();
const objectUrls = new Map();
let angle = 0;
const NS = 'http://www.w3.org/2000/svg';
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normalize = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const textSvg = (x,y,value,size=17) => `<text x="${x}" y="${y}" font-size="${size}" font-family="Arial,sans-serif" fill="currentColor" stroke="none" text-anchor="middle">${esc(value)}</text>`;
const pathSvg = d => `<path d="${d}"/>`;
const lineSvg = (x1,y1,x2,y2,dashed=false) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"${dashed?' stroke-dasharray="9 6"':''}/>`;
const shown = (field, values) => !field.when || values[field.when[0]] === field.when[1];
const decimal = value => String(value).replace('.', ',');
const numeric = value => value !== '' && value !== '?' ? Number(String(value).replace(',', '.')) : NaN;
const ratio = (a,b) => `${decimal(a)}/${decimal(b)}`;

function draftFor(item) {
  if (!drafts.has(item.number)) drafts.set(item.number, { variant:0, values:Object.fromEntries(engineeringFields[item.number].fields.map(f=>[f.key,f.value])) });
  return drafts.get(item.number);
}

function foliage(item,v) {
  let body = '';
  const columns=item.number===21?[98,120,142]:[120];
  for (const x of columns) for (const y of [58,86,114,142]) body += v.foliage==='permanent' ? pathSvg(`M${x-5} ${y+3}l5 -7 5 7`) : `<circle cx="${x}" cy="${y}" r="4"/>`;
  return body;
}

function zigzag(x1,x2,y,amplitude,startsDown,extrema,part) {
  const points=Array.from({length:extrema},(_,i)=>[x1+(x2-x1)*(i+1)/(extrema+1),y+amplitude*(i%2===0?(startsDown?1:-1):(startsDown?-1:1))]);
  return `<path data-part="${part}" d="M${x1} ${y} ${points.map(([x,py])=>`L${x.toFixed(3)} ${py}`).join(' ')} L${x2} ${y}"/>`;
}

function ford(v) {
  const left = ['left','both'].includes(v.access), right = ['right','both'].includes(v.access);
  let b=textSvg(130,66,`${v.order} / ${v.type} / ${decimal(v.speed)} / ${v.variation}`,19)+textSvg(130,143,`${decimal(v.length)} / ${decimal(v.width)} / ${v.material} / ${decimal(v.depth)}`,17);
  b+=pathSvg('M34 94L26 99L34 104')+lineSvg(26,99,52,99);
  if(left&&right){
    b+=zigzag(52,126,99,20,true,7,'ford-access-left')+lineSvg(126,99,142,99,true)+zigzag(142,216,99,20,true,7,'ford-access-right')+lineSvg(216,99,225,99,true);
  }else if(left){
    b+=zigzag(52,156,99,20,true,7,'ford-access-left')+lineSvg(156,99,225,99,true);
  }else if(right){
    b+=lineSvg(52,99,112,99,true)+zigzag(112,216,99,20,true,7,'ford-access-right')+lineSvg(216,99,225,99,true);
  }else b+=lineSvg(52,99,225,99,true);
  return b;
}

function ferry(v) {
  let b=pathSvg('M58 84l23 44h64l23 -44 M112 84V128')+'<polygon points="25,84 32,80 32,88" fill="currentColor" stroke="none"/>'+lineSvg(25,84,32,84);
  b+=['left','both'].includes(v.access)?zigzag(32,56,84,8,false,6,'ferry-access-left'):lineSvg(32,84,56,84);
  b+=lineSvg(56,84,171,84);
  b+=['right','both'].includes(v.access)?zigzag(171,205,84,8,false,6,'ferry-access-right')+lineSvg(205,84,219,84):lineSvg(171,84,219,84);
  return b+textSvg(85,72,v.order)+textSvg(139,72,v.type)+textSvg(91,115,v.class,21)+textSvg(138,116,decimal(v.weight),24)+textSvg(111,155,decimal(v.minutes),21);
}

function makeDrawing(item,draft) {
  const v=draft.values, variant=item.variants[draft.variant];
  let body=variant.body;
  if(item.number===13)body=ford(v);
  if(item.number===14)body=ferry(v);
  if([20,21].includes(item.number))body=foliage(item,v);
  const svg=new DOMParser().parseFromString(`<svg xmlns="${NS}" viewBox="0 0 240 200"><g data-role="symbol" fill="none" stroke="currentColor" color="#000000" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`,'image/svg+xml').documentElement;
  const g=svg.firstElementChild, texts=[...g.querySelectorAll('text')];
  const set=(i,value,width) => {texts[i].textContent=String(value);if(width)texts[i].dataset.maxWidth=width;};
  switch(item.number){
    case 2:set(0,v.order,48);break;
    case 5:set(0,decimal(v.inclination));break;
    case 6:set(0,decimal(v.radius));break;
    case 7:set(0,ratio(v.count,v.radius));break;
    case 8:
      [v.order,v.wheelsTwo,v.wheelsOne,v.tracksTwo,v.tracksOne,v.clearance,v.length,v.width].forEach((value,i)=>set(i,decimal(value),[75,31,31,31,31,30,44,65][i]));
      // Remove the underline copied from the sample; each dimension has its own state.
      g.querySelector('[data-example-underline]')?.remove();
      [['underClearance',5],['underLength',6],['underWidth',7]].forEach(([key,index])=>{if(v[key])texts[index].dataset.underline='true';});
      if(v.railway)g.insertAdjacentHTML('beforeend',textSvg(120,24,'Fv',17));
      break;
    case 9:set(0,v.class,61);set(1,v.order,61);break;
    case 14:texts[2].dataset.maxWidth=33;texts[3].dataset.maxWidth=33;break;
    case 15:set(0,decimal(v.width),42);set(1,decimal(v.length),58);break;
    case 16:set(0,decimal(v.width),36);set(1,v.minimum===v.maximum||numeric(v.minimum)===numeric(v.maximum)?decimal(v.minimum):ratio(v.minimum,v.maximum),80);break;
    case 17:set(0,ratio(v.roadWidth,v.totalWidth),60);set(1,decimal(v.clearance),50);break;
    case 18:set(0,v.order,68);set(1,decimal(v.clearance),36);set(2,decimal(v.length),53);set(3,ratio(v.roadWidth,v.totalWidth));break;
    case 19:set(0,decimal(v.height));break;
  }
  // Prefix SVG resource IDs to keep simultaneous previews independent.
  g.querySelectorAll('[id]').forEach(e=>{const id=e.id;e.id=`s${item.number}-${id}`;g.querySelectorAll('[fill]').forEach(f=>{if(f.getAttribute('fill')===`url(#${id})`)f.setAttribute('fill',`url(#${e.id})`);});});
  svg.setAttribute('role','img');svg.setAttribute('aria-label',`${item.title} — prévia com dados preenchidos`);
  return svg;
}

function errorsFor(item,v){
  const issues=[];
  for(const f of engineeringFields[item.number].fields){
    if(!shown(f,v)||!['integer','decimal'].includes(f.kind))continue;
    const s=String(v[f.key]);
    const valid=f.kind==='decimal'?/^(?:\d+(?:[.,]\d+)?|\?)?$/.test(s):/^(?:\d+|\?)?$/.test(s);
    if(!valid){issues.push({key:f.key,message:`${f.label}: use um valor não negativo${f.kind==='decimal'?' (vírgula ou ponto decimal)':''}, “?” ou deixe vazio.`});continue;}
  }
  if(item.number===16&&numeric(v.minimum)>numeric(v.maximum))issues.push({key:'maximum',message:'O gabarito máximo deve ser igual ou maior que o mínimo.'});
  if([17,18].includes(item.number)&&numeric(v.roadWidth)>numeric(v.totalWidth))issues.push({key:'totalWidth',message:'A largura total não pode ser menor que a largura da pista.'});
  return issues;
}

function update(card,item){
  const draft=draftFor(item), v=draft.values, svg=makeDrawing(item,draft), [x,y]=item.variants[draft.variant].anchor;
  card.querySelector('.drawing').replaceChildren(svg);
  const g=svg.firstElementChild;
  for(const t of g.querySelectorAll('text[data-max-width]')){
    const width=t.getComputedTextLength(), limit=Number(t.dataset.maxWidth);
    if(width>limit)t.setAttribute('font-size',Number(t.getAttribute('font-size'))*limit/width);
  }
  for(const t of g.querySelectorAll('text[data-underline]')){
    if(!t.textContent)continue;const b=t.getBBox();g.insertAdjacentHTML('beforeend',lineSvg(b.x,b.y+b.height+2,b.x+b.width,b.y+b.height+2));
  }
  const b=g.getBBox(), a=angle*Math.PI/180;
  const points=[[b.x,b.y],[b.x+b.width,b.y],[b.x,b.y+b.height],[b.x+b.width,b.y+b.height]].map(([px,py])=>[x+(px-x)*Math.cos(a)-(py-y)*Math.sin(a),y+(px-x)*Math.sin(a)+(py-y)*Math.cos(a)]);
  points.push([x-10,y-10],[x+10,y+10],[8,8],[232,192]);
  const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),minX=Math.min(...xs)-8,minY=Math.min(...ys)-8;
  svg.setAttribute('viewBox',`${minX} ${minY} ${Math.max(...xs)-minX+8} ${Math.max(...ys)-minY+8}`);
  g.setAttribute('transform',`rotate(${angle} ${x} ${y})`);
  const download=card.querySelector('.download');
  const issues=errorsFor(item,v);
  card.querySelector('.validation').textContent=issues.map(e=>e.message).join(' ');
  for(const f of engineeringFields[item.number].fields){
    const input=card.querySelector(`[data-field="${f.key}"]`);
    input.closest('.field').hidden=!shown(f,v);
    input.setAttribute('aria-invalid',issues.some(e=>e.key===f.key)?'true':'false');
  }
  download.setAttribute('aria-disabled',issues.length||item.pending?'true':'false');
  if(objectUrls.has(item.number))URL.revokeObjectURL(objectUrls.get(item.number));
  const title=document.createElementNS(NS,'title');title.textContent=`Estudo não homologado — ${item.title}. Preto: símbolo e dados; vermelho: contexto.`;svg.prepend(title);
  const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml;charset=utf-8'}));
  objectUrls.set(item.number,url);download.href=url;download.download=`C536-6-4-${String(item.number).padStart(2,'0')}-preenchido.svg`;
  if(!item.pending)svg.insertAdjacentHTML('beforeend',`<g class="anchor" fill="none" stroke="#2563eb" stroke-width="1.4"><circle cx="${x}" cy="${y}" r="5"/><path d="M${x-9} ${y}h18 M${x} ${y-9}v18"/></g>`);
}

function fieldHtml(item,f,v){
  const id=`field-${item.number}-${f.key}`, help=f.help?`<small>${esc(f.help)}</small>`:'';
  if(f.kind==='checkbox')return `<label class="field checkbox-field"><span><input id="${id}" data-field="${f.key}" type="checkbox"${v[f.key]?' checked':''}> ${esc(f.label)}</span>${help}</label>`;
  const input=f.kind==='select'?`<select id="${id}" data-field="${f.key}">${f.options.map(([key,label])=>`<option value="${esc(key)}"${key===v[f.key]?' selected':''}>${esc(label)}</option>`).join('')}</select>`:`<input id="${id}" data-field="${f.key}" type="text" value="${esc(v[f.key])}" maxlength="${f.kind==='text'?100:12}"${f.kind==='text'?'':' inputmode="decimal"'} autocomplete="off">`;
  return `<label class="field" for="${id}"><span>${esc(f.label)}</span>${input}${help}</label>`;
}

function render(){
  for(const url of objectUrls.values())URL.revokeObjectURL(url);objectUrls.clear();grid.replaceChildren();
  const q=normalize(document.querySelector('#search').value);
  const selected=items.filter(i=>/^\d+$/.test(q)?i.number===Number(q):normalize(`${i.number} ${i.title}`).includes(q));
  document.querySelector('#count').textContent=`${selected.length} / ${items.length} itens`;
  for(const item of selected){
    const schema=engineeringFields[item.number],draft=draftFor(item),card=document.createElement('article');
    card.className='card'+(item.pending?' pending':'');card.dataset.item=item.number;
    card.innerHTML=`<header><div class="meta">${String(item.number).padStart(2,'0')} · PDF ${item.page}${item.pending?' · PENDENTE':''}</div><h2>${esc(item.title)}</h2></header>
    <div class="comparison"><figure class="reference"><figcaption>Original do manual</figcaption><div class="originals">${item.originals.map(o=>`<a href="${o.file}" target="_blank" rel="noopener" title="Ampliar recorte original"><img src="${o.file}" alt="Recorte original do item ${item.number}, tabela 6-4, página PDF ${o.page}"><span>${esc(o.label)} ↗</span></a>`).join('')}</div></figure><figure class="vector"><figcaption>SVG com seus dados</figcaption><div class="drawing"></div></figure></div>
    <div class="body"><p class="context-info"><strong>Contexto × símbolo:</strong> ${esc(item.contextNote)}</p><p class="fixed-info"><strong>Parte fixa:</strong> ${esc(schema.fixed)}</p>
    ${schema.extra?`<p>${esc(schema.extra)}</p>`:''}
    ${schema.variant?`<label class="field variant-field"><span>${esc(schema.variant)}</span><select class="variant" aria-label="${esc(schema.variant)}">${item.variants.map((v,i)=>`<option value="${i}"${i===draft.variant?' selected':''}>${esc(v.label)}</option>`).join('')}</select></label>`:''}
    ${schema.fields.length?`<details class="field-details" open><summary>Informações variáveis · ${schema.fields.length} ${schema.fields.length===1?'campo':'campos'}</summary><div class="fields">${schema.fields.map(f=>fieldHtml(item,f,draft.values)).join('')}</div></details>`:`<p class="no-fields">${schema.variant?'A informação variável é a opção acima. Não há valores numéricos para preencher.':item.pending?'Campos suspensos até confirmar o desenho correto.':'Sem informação variável dentro do símbolo.'}</p>`}
    <p class="validation" role="status" aria-live="polite"></p><div class="actions"><a class="download" download>${item.pending?'Desenho pendente':'Baixar SVG preenchido'}</a><button class="reset" type="button">Restaurar exemplo</button></div></div>`;
    card.addEventListener('input',e=>{const key=e.target.dataset.field;if(!key)return;draft.values[key]=e.target.type==='checkbox'?e.target.checked:e.target.value;update(card,item);});
    card.querySelector('.variant')?.addEventListener('change',e=>{draft.variant=Number(e.target.value);update(card,item);});
    card.querySelector('.reset').addEventListener('click',()=>{drafts.delete(item.number);render();});
    card.querySelector('.download').addEventListener('click',e=>{if(e.currentTarget.getAttribute('aria-disabled')==='true')e.preventDefault();});
    grid.append(card);update(card,item);
  }
}

document.querySelector('#search').addEventListener('input',render);
document.querySelector('#anchors').addEventListener('change',e=>document.body.classList.toggle('show-anchors',e.target.checked));
document.querySelector('#background').addEventListener('change',e=>document.body.classList.toggle('contrast',e.target.checked));
document.querySelector('#rotation').addEventListener('input',e=>{angle=Number(e.target.value);document.querySelector('#degrees').value=angle+'°';for(const card of grid.children)update(card,items.find(i=>i.number===Number(card.dataset.item)));});
const originalDialog=document.querySelector('#original-dialog');
originalDialog.querySelector('button').addEventListener('click',()=>originalDialog.close());
originalDialog.addEventListener('click',e=>{if(e.target===originalDialog)originalDialog.close();});
grid.addEventListener('click',e=>{const link=e.target.closest('.originals a');if(!link)return;e.preventDefault();const source=link.querySelector('img'),image=originalDialog.querySelector('img');image.src=source.src;image.alt=source.alt;originalDialog.querySelector('p').textContent=source.alt;originalDialog.showModal();});
render();
