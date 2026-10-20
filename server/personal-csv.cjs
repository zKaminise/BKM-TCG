const FIELDS = ['tcg','setId','cardId','number','language','condition','variant','quantity','paidCents','acquiredAt','notes','estimatedValueCents','priceSource','quotedAt'];
const aliases = {tcg:'tcg',setid:'setId',colecao:'setId',codigodacolecao:'setId',cardid:'cardId',cartaid:'cardId',number:'number',numero:'number',language:'language',idioma:'language',condition:'condition',condicao:'condition',variant:'variant',variante:'variant',quantity:'quantity',quantidade:'quantity',paidcents:'paidCents',custocentavos:'paidCents',acquiredat:'acquiredAt',dataaquisicao:'acquiredAt',notes:'notes',observacoes:'notes',estimatedvaluecents:'estimatedValueCents',pricesource:'priceSource',quotedat:'quotedAt',valuecents:'valueCents',valorcentavos:'valueCents',currency:'currency',moeda:'currency',sourcelabel:'sourceLabel',fonte:'sourceLabel',sourceurl:'sourceUrl',urlfonte:'sourceUrl',methodology:'methodology',metodologia:'methodology'};
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;
function parsePersonalCsv(csv) {
  if (typeof csv !== 'string' || Buffer.byteLength(csv) > 1024 * 1024) return {rows:[],errors:[{line:0,message:'CSV deve ter até 1 MB.'}],duplicates:[]};
  csv = csv.replace(/^\ufeff/,'');
  const firstLine = csv.split(/\r?\n/,1)[0], delimiter = firstLine.includes(';') ? ';' : ',';
  const records = []; let record = [], value = '', quoted = false, closed = false, line = 1, recordLine = 1;
  const errors = [];
  for (let index = 0; index <= csv.length; index++) {
    const ch = csv[index];
    if (quoted) {
      if (ch === '"' && csv[index+1] === '"') { value += '"'; index++; }
      else if (ch === '"') { quoted = false; closed = true; }
      else if (ch === undefined) { errors.push({line:recordLine,message:'Aspas não fechadas.'}); break; }
      else { value += ch; if (ch === '\n') line++; }
    } else if (ch === '"' && value === '' && !closed) quoted = true;
    else if (ch === delimiter) { record.push(value); value = ''; closed = false; }
    else if (ch === '\n' || ch === undefined) {
      record.push(value.replace(/\r$/,''));
      if (record.some(cell => cell.trim())) records.push({cells:record,line:recordLine});
      record = []; value = ''; closed = false; line++; recordLine = line;
      if (records.length > 501) { errors.push({line,message:'Importe até 500 linhas por arquivo.'}); break; }
    } else if (closed && ch !== '\r') { errors.push({line,message:'Há caracteres após o fechamento de aspas.'}); break; }
    else value += ch;
  }
  if (errors.length) return {rows:[],errors,duplicates:[]};
  if (!records.length) return {rows:[],errors:[{line:1,message:'CSV vazio.'}],duplicates:[]};
  const header = records.shift().cells.map(value => Object.prototype.hasOwnProperty.call(aliases,normalize(value)) ? aliases[normalize(value)] : null);
  if (!header.includes('setId') || (!header.includes('cardId') && !header.includes('number'))) return {rows:[],errors:[{line:1,message:'Inclua setId e cardId (ou number).'}],duplicates:[]};
  const named = header.filter(Boolean);
  if (new Set(named).size !== named.length) return {rows:[],errors:[{line:1,message:'Há colunas duplicadas.'}],duplicates:[]};
  const rows = [], seen = new Map(), duplicates = [];
  for (const record of records) {
    if (record.cells.length !== header.length) { errors.push({line:record.line,message:'Número de colunas diferente do cabeçalho.'}); continue; }
    const row = Object.fromEntries(header.flatMap((key,index) => key ? [[key,record.cells[index].trim()]] : []));
    row.tcg = row.tcg || 'pokemon'; row.language = row.language || 'pt'; row.condition = row.condition || 'NM'; row.variant = row.variant || 'NORMAL'; row.quantity = row.quantity === '' || row.quantity === undefined ? 1 : Number(row.quantity);
    row.cardId = row.cardId || row.setId + '-' + row.number;
    row.paidCents = row.paidCents === '' || row.paidCents === undefined ? null : Number(row.paidCents);
    if (row.tcg.toLowerCase() !== 'pokemon' || !/^[A-Za-z0-9.+_-]{1,80}$/.test(row.setId || '') || !/^[A-Za-z0-9.+:_-]{1,180}$/.test(row.cardId || '') || !/^[a-z]{2}(?:-[A-Z]{2})?$/.test(row.language) || !['NM','LP','MP','HP','DMG'].includes(row.condition) || !['NORMAL','HOLO','REVERSE','PROMO','FIRST_EDITION','OTHER'].includes(row.variant) || !Number.isSafeInteger(row.quantity) || row.quantity < 1 || row.quantity > 9999 || row.paidCents !== null && (!Number.isSafeInteger(row.paidCents) || row.paidCents < 0 || row.paidCents > 100000000) || (row.notes || '').length > 2000 || row.acquiredAt && !validDate(row.acquiredAt)) {
      errors.push({line:record.line,message:'Revise identidade, quantidade, idioma, condição, variante, custo em centavos ou data.'}); continue;
    }
    const key = JSON.stringify([row.setId,row.cardId,row.language,row.condition,row.variant,row.paidCents,row.acquiredAt || '',row.notes || '']);
    if (seen.has(key)) duplicates.push({line:record.line,previousLine:seen.get(key)}); else seen.set(key,record.line);
    rows.push({...row,line:record.line});
  }
  return {rows,errors,duplicates};
}
function exportPersonalCsv(rows) {
  const cell = value => {
    let text = value == null ? '' : String(value);
    if (/^[\s]*[=+\-@\t\r]/.test(text) || /^[\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g,'""') + '"';
  };
  return '\ufeff' + [FIELDS.join(','),...rows.map(row => FIELDS.map(key => cell(row[key])).join(','))].join('\r\n') + '\r\n';
}
module.exports = { parsePersonalCsv, exportPersonalCsv };
