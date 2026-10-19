const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
if (require.main === module) require('../server/env.cjs').loadProjectEnvFile(path.join(root, '.env'));
const { openStore } = require('../server/store.cjs');
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\b0+(?=\d)/g, '');
const uuid = value => { const h = crypto.createHash('sha256').update('bkm-demo-v1:' + value).digest('hex'); return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`; };
const slug = value => normalize(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const note = 'DEMONSTRAÇÃO BKM TCG. Preço e estoque fictícios para testar a loja. Não há venda, cobrança ou envio real. Imagem de referência; não representa uma unidade em estoque comercial.';

async function seedDemo(options = {}) {
  const env = options.env || process.env;
  if (env.BKM_ENVIRONMENT !== 'demo') throw new Error('Seed permitido somente com BKM_ENVIRONMENT=demo em banco dedicado.');
  if (!options.store && !env.DATABASE_URL && !env.BKM_DB_PATH) throw new Error('Informe BKM_DB_PATH para um banco local dedicado ou DATABASE_URL do projeto de demonstração.');
  const db = options.store || openStore({ ...options, env });
  try {
    await db.ready;
    return await db.transaction(async () => {
      const settingsRow = await db.prepare('SELECT value_json FROM settings WHERE id=1').get();
      const settings = JSON.parse(settingsRow.value_json);
      const count = Number((await db.prepare('SELECT COUNT(*) AS n FROM products').get()).n);
      if (count && settings.demoDataVersion !== 1) throw new Error('Banco já contém produtos sem a identificação de demonstração. Nenhum dado foi alterado.');
      if (settings.demoDataVersion === 1) return { seeded: false, products: count, message: 'Demonstração já populada. Alterações administrativas preservadas.' };
      const created = new Date().toISOString();
      const cards = JSON.parse(fs.readFileSync(path.join(__dirname, 'demo/cards.json'), 'utf8'));
      const collections = new Map();
      for (const item of cards) if (!collections.has(item.set.id)) collections.set(item.set.id, item.set);
      collections.set('me03', { id:'me03', name:'Equilíbrio Perfeito', provider:'manual', language:'pt', series:{name:'Megaevolução'} });
      for (const set of collections.values()) {
        await db.prepare('INSERT INTO collections(id,name,aliases_json,description,image,featured,provider,metadata_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').run(set.id, set.name, JSON.stringify(set.id === 'sv09' ? ['EV09','Journey Together'] : set.id === 'me02.5' ? ['ME02.5','Ascended Heroes'] : []), `Explore ${set.name} na demonstração BKM TCG.`, set.logo || '', 1, set.provider || 'manual', JSON.stringify(set), created, created);
      }
      async function addProduct(p) {
        const id = uuid(p.sku), cardId = p.card ? uuid('metadata:' + p.sku) : null;
        if (p.card) {
          const c = p.card;
          await db.prepare('INSERT INTO card_metadata(id,identity_key,tcg,set_id,number,language,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?)').run(cardId, JSON.stringify(['pokemon',p.setId,normalize(c.number),c.language,c.provider,c.providerId]), 'pokemon',p.setId,c.number,c.language,JSON.stringify(c),created);
        }
        const attributes = { demo:true, manufacturer:'Pokémon', imageSource:p.source, ...(p.attributes || {}) };
        const text = normalize([p.name,p.sku,p.setName,p.setId,attributes.category,p.card?.name,p.card?.number,p.card ? `${p.card.number}/${p.card.total}` : ''].join(' '));
        await db.prepare('INSERT INTO products(id,slug,kind,name,description,sku,tcg,set_id,set_name,card_id,images_json,attributes_json,search_text,featured,published,archived,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)').run(id,slug(p.name+'-'+p.sku.replace('DEMO-','')),p.kind,p.name,`${p.description}\n\n${note}`,p.sku,'pokemon',p.setId,p.setName,cardId,JSON.stringify(p.images),JSON.stringify(attributes),text,+!!p.featured,1,created,created);
        for (let index=0; index<p.variants.length; index++) {
          const v=p.variants[index];
          await db.prepare('INSERT INTO variants(id,product_id,language,condition,finish,price_cents,compare_at_cents,stock,active) VALUES(?,?,?,?,?,?,?,?,1)').run(uuid(p.sku+':'+index),id,v.language || 'pt',v.condition || (p.kind==='SEALED'?'SEALED':'NM'),v.finish || 'NORMAL',v.priceCents,v.compareAtCents || null,v.stock);
        }
      }
      const prices = [34990,1890,290,190,2990,8990,12990,1290,390];
      for (let i=0; i<cards.length; i++) {
        const {card:c,set}=cards[i];
        const holo=!!c.variants.holo;
        const variants=[{language:c.language,condition:'NM',finish:holo?'HOLO':'NORMAL',priceCents:prices[i],stock:i===2?0:i===4?1:4}];
        if (i===0) variants.push({language:c.language,condition:'LP',finish:'HOLO',priceCents:29990,stock:2});
        if (i===3 && c.variants.reverse) variants.push({language:c.language,condition:'NM',finish:'REVERSE',priceCents:390,stock:3});
        await addProduct({sku:`DEMO-CARD-${c.language.toUpperCase()}-${c.providerId.toUpperCase()}`,kind:'SINGLE',name:`${c.name} · ${c.number}/${c.total}`,setId:c.setId,setName:c.setName,description:`Carta avulsa da coleção ${c.setName}. ${c.rarity || ''}. Selecione a condição e o acabamento para conferir o estoque de teste.`,source:'TCGdex — https://tcgdex.dev',card:{...c,tcg:'pokemon'},images:[{url:c.providerId==='me02.5-276'?'/assets/pikachu.webp':c.image,kind:'reference',alt:`${c.name}, ${c.number}/${c.total}, ${c.language}`}],attributes:{category:'Carta avulsa',series:set.series?.name || '',sellerNotes:'Condições e quantidades ilustrativas. Nenhuma carta real está sendo anunciada.'},featured:[0,4,5,6].includes(i),variants});
      }
      const sealed=[
        {sku:'DEMO-BOOSTER-HEROIS',name:'Booster · Heróis Excelsos',setId:'me02.5',setName:'Heróis Excelsos',image:'/assets/pack.webp',category:'Booster',description:'Pacote em português com 6 cartas de jogo adicionais. A arte do pacote pode variar em uma coleção real.',contents:'1 pacote de booster, 6 cartas.',priceCents:1490,stock:20,featured:true,source:'Imagem fornecida pelo proprietário BKM TCG.'},
        {sku:'DEMO-ETB-HEROIS',name:'Coleção Treinador Avançado · Heróis Excelsos',setId:'me02.5',setName:'Heróis Excelsos',image:'/assets/demo/etb-herois.png',category:'ETB',description:'Coleção em português com boosters e acessórios para colecionadores.',contents:'20 boosters, carta promocional Zekrom do N, 65 capas, dados, moeda e caixa.',priceCents:32990,stock:5,featured:true,source:'https://www.pokemon.com/br/pokemon-tcg/galeria-de-produtos/colecao-treinador-avancado-de-megaevolucao-herois-excelsos'},
        {sku:'DEMO-BOX-JOURNEY',name:'Booster Box · Journey Together',setId:'sv09',setName:'Amigos de Jornada',image:'/assets/demo/box-journey.png',category:'Booster box',description:'Expositor da coleção Journey Together em inglês. Produto ilustrativo para explorar o catálogo de lacrados.',contents:'36 pacotes de booster em inglês.',language:'en',priceCents:89990,stock:3,featured:true,source:'https://www.pokemon.com/uk/pokemon-news/pokemon-tcg-scarlet-violet-journey-together-product-showcase'},
        {sku:'DEMO-ETB-JOURNEY',name:'Elite Trainer Box · Journey Together',setId:'sv09',setName:'Amigos de Jornada',image:'/assets/demo/etb-journey.png',category:'ETB',description:'Elite Trainer Box da coleção Journey Together em inglês. Exemplo de produto esgotado.',contents:'9 boosters em inglês, carta promocional e acessórios.',language:'en',priceCents:34990,stock:0,source:'https://www.pokemon.com/uk/pokemon-news/pokemon-tcg-scarlet-violet-journey-together-product-showcase'},
        {sku:'DEMO-BLISTER-EQUILIBRIO',name:'Blister Quádruplo · Equilíbrio Perfeito',setId:'me03',setName:'Equilíbrio Perfeito',image:'/assets/demo/blister-equilibrio.png',category:'Blister',description:'Blister em português com quatro pacotes de booster. Imagem de referência oficial Copag.',contents:'4 pacotes de booster e carta promocional.',priceCents:5490,stock:8,source:'https://www.copagloja.com.br/'}
      ];
      for (const p of sealed) await addProduct({...p,kind:'SEALED',images:[{url:p.image,kind:'reference',alt:p.name}],attributes:{category:p.category,contents:p.contents,weightGrams:p.category==='Booster'?20:400,widthCm:16,heightCm:12,lengthCm:20},variants:[{language:p.language || 'pt',priceCents:p.priceCents,stock:p.stock}]});
      const updated={...settings,demoDataVersion:1,heroTitle:'A próxima carta da sua coleção.',heroSubtitle:'Explore lacrados e cartas especiais. Viva a demonstração BKM TCG.',about:'A BKM TCG está em desenvolvimento. Este ambiente demonstra a experiência de uma loja de cartas colecionáveis, com produtos, valores, estoque e pedidos fictícios.',shippingPolicy:'Frete de demonstração: R$ 15,00, prazo ilustrativo de 5 dias úteis. Frete grátis a partir de R$ 150,00 para CEPs brasileiros válidos. Não há entrega ou contrato de transporte real.',returnsPolicy:'Ambiente de demonstração: nenhum pedido representa compra ou envio real. As condições comerciais definitivas serão publicadas antes da abertura da loja.',privacyPolicy:'Demonstração em desenvolvimento. Use dados fictícios nos testes. Cadastros, carrinhos e pedidos são persistidos para validar a experiência. Não informe dados de pagamento reais.',terms:'Demonstração não comercial. Preços e estoques ilustrativos. Nenhuma cobrança, venda ou entrega é realizada.',shipping:{enabled:true,flatRateCents:1500,estimatedDays:5,freeShippingEnabled:true,freeShippingThresholdCents:15000,regions:[{start:'01000000',end:'99999999'}]},banners:[{title:'O próximo capítulo é seu.',subtitle:'Explore a seleção de demonstração BKM TCG.',image:'/assets/pikachu.webp',url:'/cartas',active:true}]};
      await db.prepare('UPDATE settings SET value_json=?,updated_at=? WHERE id=1').run(JSON.stringify(updated),created);
      await db.prepare('INSERT INTO coupons(id,code,type,value,minimum_cents,starts_at,ends_at,max_uses,used_count,active,created_at) VALUES(?,?,?,?,?,NULL,NULL,NULL,0,1,?)').run(uuid('coupon'),'BKMDEMO','PERCENT',10,5000,created);
      return {seeded:true,products:cards.length+sealed.length,collections:collections.size,message:'Dados de demonstração criados; nenhuma conta administrativa ou credencial foi incluída.'};
    });
  } finally { if(!options.store) await db.close(); }
}
if(require.main===module)seedDemo().then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={seedDemo};
