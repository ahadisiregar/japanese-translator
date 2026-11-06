const fs=require('fs');
const root=require('path').join(__dirname,'..')+'/';
const cardsMd=fs.readFileSync(root+'docs/cards.md','utf8');
const ruleMd=fs.readFileSync(root+'docs/rulebook.md','utf8');
const rows=(md,startRe)=>md.split('\n').filter(l=>l.startsWith('|'));
const cell=l=>l.split('|').slice(1,-1).map(s=>s.trim());
const money=s=>parseInt(s.replace(/[^\d]/g,''),10);
// ---- cards
const deckKeys={P:'politik',U:'ugly',D:'dark',S:'sarcasm',H:'modern',K:'finance',M:'meme'};
const cards=[];
for(const l of rows(cardsMd)){
  const c=cell(l);
  if(!/^[PUDSHKM]\d\d$/.test(c[0]))continue;
  const [id,title,en,idt,eff,flavor]=c;
  const tp=title.split(' / ');
  const titleEn=tp[0],titleId=tp.slice(1).join(' / ');
  if(tp.length!==2)console.error('title parts',id,tp.length);
  let e;
  let m;
  if(m=eff.match(/^Kewarasan ([+-]\d)$/))e={kew:parseInt(m[1])};
  else if(m=eff.match(/^Rp ([+-])([\d,]+)$/))e={money:(m[1]=='-'?-1:1)*money(m[2])};
  else if(eff==='Skip 1 turn')e={skip:1};
  else if(eff==='Move to next Institution')e={move:'next'};
  else if(eff==='Move to any Institution')e={move:'any'};
  else if(eff==='Skip 1 turn OR Kewarasan -1')e={choice:[{skip:1},{kew:-1}]};
  else {console.error('UNPARSED',id,eff);continue;}
  const card={id,deck:deckKeys[id[0]],titleEn,titleId,en,idt,eff,e,flavor};
  if(/^Self-Care:/.test(titleEn))card.selfCare=true;
  if(id==='K03')card.paylater=1000000;
  cards.push(card);
}
// ---- tiles
const tiles=[];
const deckByName={'Kenyataan Pahit':'ugly','Politik':'politik','Keuangan':'finance','Sindiran':'sarcasm','Dark Joke':'dark','Hidup Modern':'modern'};
for(const l of rows(ruleMd)){
  const c=cell(l);
  if(!/^\d+$/.test(c[0])||c.length<6)continue;
  const pos=+c[0];
  const parts=c[1].split(' / ');
  let idn,en;
  if(parts.length===3){idn=parts[1];en=parts[0]+' / '+parts[2];}
  else if(parts.length===1){idn=parts[0];en=parts[0];}
  else {idn=parts[0];en=parts[1];}
  const type=c[2],price=c[3]==='—'?0:money(c[3]);
  const t={pos,en,idn,price,effect:c[4],flavor:c[5]};
  if(c.length>6)console.error('cols',pos,c.length);
  let m;
  if(pos===0)t.kind='go';
  else if(type.startsWith('Institution')){t.kind='inst';t.cat=type.match(/\((.*)\)/)[1];t.rent=money(c[4]);}
  else if(type==='Transit')t.kind='transit';
  else if(type==='Utility'){t.kind='utility';t.rent=money(c[4]);}
  else if(type==='Card tile'){t.kind='card';t.deck=deckByName[c[4].replace('Draw from ','')];}
  else if(type==='Tax')t.kind=pos===4?'tax-income':'tax-ent';
  else if(pos===10)t.kind='jail';
  else if(pos===20)t.kind='rest';
  else if(pos===30)t.kind='gotojail';
  else console.error('tile?',pos,type);
  tiles.push(t);
}
console.error('cards',cards.length,'tiles',tiles.length);
const counts={};cards.forEach(c=>counts[c.deck]=(counts[c.deck]||0)+1);console.error(counts);
const kinds={};tiles.forEach(t=>kinds[t.kind]=(kinds[t.kind]||0)+1);console.error(kinds);
fs.writeFileSync(root+'data.js','// Generated from docs/cards.md and docs/rulebook.md. Do not edit by hand.\nwindow.TILES='+JSON.stringify(tiles,null,1)+';\nwindow.CARDS='+JSON.stringify(cards)+';\n');
