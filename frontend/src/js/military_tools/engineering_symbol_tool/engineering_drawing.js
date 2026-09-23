// Path: js/military_tools/engineering_symbol_tool/engineering_drawing.js
import { engineeringFields, rampChevronCount } from './engineering_fields.js';
const NS = 'http://www.w3.org/2000/svg';
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const textSvg = (x,y,value,size=17) => `<text x="${x}" y="${y}" font-size="${size}" font-family="Arial,sans-serif" fill="currentColor" stroke="none" text-anchor="middle">${esc(value)}</text>`;
const pathSvg = d => `<path d="${d}"/>`;
const lineSvg = (x1,y1,x2,y2,dashed=false) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"${dashed?' stroke-dasharray="9 6"':''}/>`;
const shown = (field, values) => !field.when || values[field.when[0]] === field.when[1];
const decimal = value => String(value).replace('.', ',');
const numeric = value => value !== '' && value !== '?' ? Number(String(value).replace(',', '.')) : NaN;
const ratio = (a,b) => `${decimal(a)}/${decimal(b)}`;

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
  }else {b+=lineSvg(52,99,225,99,true);}
  return b;
}

function ferry(v) {
  let b=pathSvg('M58 84l23 44h64l23 -44 M112 84V128')+'<polygon points="25,84 32,80 32,88" fill="currentColor" stroke="none"/>'+lineSvg(25,84,32,84);
  b+=['left','both'].includes(v.access)?zigzag(32,56,84,8,false,6,'ferry-access-left'):lineSvg(32,84,56,84);
  b+=lineSvg(56,84,171,84);
  b+=['right','both'].includes(v.access)?zigzag(171,205,84,8,false,6,'ferry-access-right')+lineSvg(205,84,219,84):lineSvg(171,84,219,84);
  return b+textSvg(85,72,v.order)+textSvg(139,72,v.type)+textSvg(91,115,v.class,21)+textSvg(138,116,decimal(v.weight),24)+textSvg(111,155,decimal(v.minutes),21);
}

export function makeDrawing(item,draft) {
  const v=draft.values, variant=item.variants[draft.variant];
  let body=variant.body;
  if(item.number===5){
    const count=rampChevronCount(v.inclination);
    body=item.variants[Math.max(0,count-1)].body;
    if(count===0)body=body.replace(/<path d="M102 [^"]+"\s*\/>/g,'');
  }
  if(item.number===13)body=ford(v);
  if(item.number===14)body=ferry(v);
  if([20,21].includes(item.number))body=foliage(item,v);
  const svg=new DOMParser().parseFromString(`<svg xmlns="${NS}" viewBox="0 0 240 200"><g data-role="symbol" fill="none" stroke="currentColor" color="#000000" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`,'image/svg+xml').documentElement;
  const g=svg.firstElementChild, texts=[...g.querySelectorAll('text')];
  if(v.fillBackground === true && [2,8,9,27,28].includes(item.number)) {
    // Duplicate only the enclosing shape, behind the ink (including parking quadrants).
    const background=g.querySelector(item.number===2?'path':'circle').cloneNode(false);
    if(item.number===2)background.setAttribute('d',background.getAttribute('d').split('Z')[0]+'Z');
    background.setAttribute('data-part','white-background');
    background.setAttribute('fill','#ffffff');
    background.setAttribute('stroke','none');
    g.prepend(background);
  }
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

export function errorsFor(item,v){
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
