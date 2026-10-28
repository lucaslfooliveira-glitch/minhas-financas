/**
 * Importador Itaú — Etapa 1, ES module, sem gravação ou acesso ao banco.
 * PDFs variam: toda saída exige revisão. Centavos são inteiros COM sinal.
 * Pagamentos não são receitas; créditos/estornos abatem despesas.
 * Dependência carregada somente ao chamar extractPdfText(), não no import.
 */
export const PDFJS_VERSION = '6.4.299';
// Distribuição da Mozilla em CDN indicado pela documentação oficial do PDF.js.
// API e worker precisam ter a MESMA versão. Pode hospedar ambos localmente depois.
export const PDFJS_CDN = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}`;

export const REGEXES = Object.freeze({
  // Data só NO INÍCIO. Assim o 02/06 de AMAZON 02/06 não vira outra compra.
  data: /^(\d{2})\/(\d{2})(?:\/(\d{4}))?(?=\s|$)\s*(.*)$/u,
  // Parcela no corpo, preferencialmente final da descrição; validate 1 <= n <= total.
  parcela: /(?:^|\s)(\d{1,2})\s*\/\s*(\d{1,2})(?=\s|$)/gu,
  cartao: /\bFINAL\s*[:*.\-]?\s*(\d{4})\b/u,
  // Verificada ANTES dos créditos: uma fatura paga nunca entra como receita.
  pagamento: /\b(?:PAGAMENTO (?:EFETUADO|RECEBIDO|DE FATURA|DA FATURA)|DEBITO AUTOMATICO(?: DE| DA)? FATURA|PGTO(?: DE| DA)? FATURA|PAGTO(?: DE| DA)? FATURA)\b/u,
  // Marcador de operação no início; "DROGARIA DESCONTO" é nome de loja.
  credito: /^(?:ESTORNO|CREDITO|CREDITOS|DESCONTO|CASHBACK|DEVOLUCAO|REEMBOLSO)\b/u,
  iof: /\bIOF\b/u,
  futuro: /(?:PROXIMAS FATURAS|FATURAS FUTURAS|LANCAMENTOS FUTUROS|PARCELAS A VENCER|COMPRAS PARCELADAS\s*[-–:]?\s*PROXIMAS|PARCELAMENTO (?:DA|DE) FATURA|OPCOES DE PARCELAMENTO)/u,
  informativo: /^(?:RESUMO (?:DA FATURA|DE DESPESAS)|LIMITES?\b|LIMITE\b|TAXAS? DE JUROS|JUROS (?:DO ROTATIVO|DE MORA)|CET\b|CUSTO EFETIVO|PAGAMENTO MINIMO|TOTAL DA FATURA|SALDO (?:ANTERIOR|TOTAL|REMANESCENTE)|VENCIMENTO\b|VALOR TOTAL (?:DA FATURA|A PAGAR)|CODIGO DE BARRAS|PAGINA\b|OUVIDORIA\b|CENTRAL DE ATENDIMENTO|WWW\.|SAC\b)/u,
});

const MONEY = /(?<![\d.,])(?:(R\$|US\$|USD|EUR|€)\s*)?([+-]?\s*(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2})(?:\s*(CR|C|D))?(?![\d.,\p{L}])/giu;
const GROUPS = new Set(['necessidades', 'desejos', 'metas']);
const MAX_TEXT = 2_000_000;
const normalize = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const cleanLine = s => String(s ?? '').normalize('NFKC').replace(/\u00a0/g, ' ').replace(/[−–—](?=\s*(?:R\$)?\s*\d)/gu, '-').replace(/-\s*R\$\s*/gu, 'R$ -').replace(/\s+/g, ' ').trim();
const warning = (codigo, mensagem, source = {}) => ({ codigo, mensagem, ...source });
const origin = row => ({ pagina: row.page, coluna: row.column, linha: row.line, texto: row.text });

/** Não usa parseFloat: 1.234,56 vira exatamente 123456. Aceita -/− e C/CR. */
export function parseMoneyBR(value) {
  let s = cleanLine(value).replace(/^R\$\s*/u, '').trim();
  const credit = /(?:CR|C)$/iu.test(s);
  s = s.replace(/\s*(?:CR|C|D)$/iu, '').replace(/\s+/gu, '');
  if (!/^[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}$/u.test(s)) throw new Error('Valor brasileiro inválido. Use 1.234,56.');
  const negative = s.startsWith('-') || credit;
  const [whole, fraction] = s.replace(/^[+-]/u, '').replace(/\./gu, '').split(',');
  const cents = Number(whole) * 100 + Number(fraction);
  if (!Number.isSafeInteger(cents) || cents > 9_000_000_000_000) throw new Error('Valor fora do limite.');
  return negative && cents ? -cents : cents;
}

function moneyTokens(text) {
  return [...text.matchAll(MONEY)].map(m => ({
    index: m.index, end: m.index + m[0].length, text: m[0],
    currency: normalize(m[1] || ''), cents: parseMoneyBR(m[2] + (m[3] || '')),
  }));
}

function readAmount(body) {
  const tokens = moneyTokens(body);
  const brl = tokens.filter(t => t.currency === 'R$');
  // Se há USD/EUR/cotação, nunca somar tudo: aceitar somente um R$ inequívoco.
  const foreign = tokens.some(t => t.currency && t.currency !== 'R$') || /(?:US\$|\bUSD\b|\bEUR\b|DOLAR|DOLARES|CAMBIO|COTACAO)/u.test(normalize(body));
  const chosen = brl.length === 1 ? brl[0] : !foreign && tokens.length === 1 ? tokens[0] : null;
  if (!chosen || brl.length > 1 || (!foreign && tokens.length > 1)) return null;
  // Texto após o valor pode esconder outra coluna/compra. Deixar para revisão.
  const tail = body.slice(chosen.end).trim();
  if (tail) return null;
  if (foreign && tokens.some(t => t !== chosen && !t.currency && !/(?:COTACAO|TAXA DE CONVERSAO)\s*[:=]?\s*$/u.test(normalize(body.slice(Math.max(0, t.index - 40), t.index))))) return null;
  const first = tokens[0];
  return { ...chosen, description: body.slice(0, first.index).trim(), international: foreign, details: foreign ? body.slice(first.index).trim() : null };
}

function validDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(iso)) return false;
  const d = new Date(iso + 'T12:00:00Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === iso && iso >= '1900-01-01' && iso <= '2200-12-31';
}
function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}
function dateInMonth(month, day) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

function purchaseDate(match, vencimento, installment) {
  const [, dd, mm, yyyy] = match;
  if (yyyy) {
    const iso = `${yyyy}-${mm}-${dd}`;
    return { value: validDate(iso) && iso <= vencimento ? iso : null, suggested: iso, inferred: false };
  }
  // Compra parcelada antiga não tem ano recuperável com certeza em DD/MM.
  // A sugestão usa a parcela atual para estimar o ano, mas não confirma a data.
  const anchor = installment ? shiftMonth(vencimento.slice(0, 7), -(installment.current - 1)) + '-31' : vencimento;
  let year = Number(anchor.slice(0, 4));
  if (`${year}-${mm}-${dd}` > anchor) year--;
  const iso = `${year}-${mm}-${dd}`;
  return { value: !installment && validDate(iso) ? iso : null, suggested: validDate(iso) ? iso : null, inferred: true };
}

/** Regras aprendidas têm precedência. Marketplace não implica necessidade. */
export function suggestCategory(description, { regras = [], categorias = [] } = {}) {
  const merchant = normalize(description);
  const learned = regras.filter(r => r.ativa !== false && normalize(r.estabelecimento) === merchant);
  if (learned.length === 1 && GROUPS.has(learned[0].grupo_orcamento)) {
    const r = learned[0];
    return { id: r.categoria_id || null, nome: r.categoria_nome || r.categoria || 'Revisar categoria', grupo_orcamento: r.grupo_orcamento, origem: 'aprendida', revisar: false };
  }
  const dictionary = [
    [/\b(?:IOF|TARIFA|ANUIDADE)\b/u, 'Encargos do cartão', 'necessidades'],
    [/\b(?:SUPERMERCADO|SUPERMERCADOS|ATACADAO|CARREFOUR|ASSAI)\b/u, 'Supermercado', 'necessidades'],
    [/\b(?:DROGASIL|DROGARIA|FARMACIA|HOSPITAL|CLINICA)\b/u, 'Saúde', 'necessidades'],
    [/\b(?:UBER|99APP|99POP|POSTO|COMBUSTIVEL|METRO|ESTACIONAMENTO)\b/u, 'Transporte', 'necessidades'],
    [/(?:\bIFD\*|\bIFOOD\b|\bRESTAURANTE\b|\bLANCHONETE\b)/u, 'Alimentação fora de casa', 'desejos'],
    [/\b(?:NETFLIX|SPOTIFY|DISNEY|HBO|PRIME VIDEO)\b/u, 'Assinaturas', 'desejos'],
    [/\b(?:AMAZON|MERCADOLIVRE|MERCADO LIVRE|SHOPEE)\b/u, 'Compras a classificar', null],
  ];
  const found = dictionary.find(([re]) => re.test(merchant));
  const name = found?.[1] || 'Não categorizado';
  const category = categorias.find(c => c.ativa !== false && normalize(c.nome) === normalize(name) && c.tipo_movimentacao !== 'receita' && c.tipo_movimentacao !== 'aporte');
  return { id: category?.id || null, nome: category?.nome || name, grupo_orcamento: category?.grupo_orcamento || found?.[2] || null, origem: found ? 'dicionario' : 'nenhuma', revisar: true };
}

/** SHA-256 não elimina dados repetidos: é apenas uma chave de comparação. */
export async function fingerprint(value) {
  if (!globalThis.crypto?.subtle) throw new Error('Use HTTPS ou localhost para calcular SHA-256.');
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
}

/**
 * Geometria PDF.js -> linhas. Não pressupõe que items[] esteja em ordem de leitura.
 * columnBreaks=[0.5] separa manualmente duas colunas em uma página não rotacionada.
 * Sem ajuste, duas datas na mesma linha geram alerta; não fundimos compras.
 */
export function textItemsToLines(items, { page = 1, width = 595, columnBreaks = [], yTolerance = 2 } = {}) {
  if (!Array.isArray(columnBreaks) || columnBreaks.some((n, i) => n <= 0 || n >= 1 || (i > 0 && n <= columnBreaks[i - 1]))) throw new Error('Divisões de coluna inválidas. Use frações crescentes entre 0 e 1.');
  const rows = [];
  const warnings = [];
  for (const item of items) {
    if (typeof item.str !== 'string' || !item.str.trim()) continue;
    const x = item.transform?.[4];
    const y = item.transform?.[5];
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('PDF sem coordenadas de texto utilizáveis. Use o texto colado.');
    const column = columnBreaks.filter(f => x >= f * width).length;
    let row = rows.find(r => r.column === column && Math.abs(r.y - y) <= yTolerance);
    if (!row) { row = { column, y, parts: [] }; rows.push(row); }
    row.parts.push({ str: item.str, x, width: Number(item.width) || 0, height: Number(item.height) || 0 });
  }
  rows.sort((a, b) => a.column - b.column || b.y - a.y);
  const lines = rows.map((row, i) => {
    row.parts.sort((a, b) => a.x - b.x);
    let text = '';
    let prior;
    for (const part of row.parts) {
      const gap = prior ? part.x - (prior.x + prior.width) : 0;
      // Não acrescentar espaço entre glifos adjacentes (ex.: "1.234,56").
      const space = prior && gap > Math.max(1, Math.min(prior.height || 8, part.height || 8) * 0.16);
      text += (space ? ' ' : '') + part.str;
      prior = part;
    }
    text = cleanLine(text);
    const dates = text.match(/(?:^|\s)\d{2}\/\d{2}(?:\/\d{4})?(?=\s)/gu) || [];
    if (!columnBreaks.length && dates.length > 1 && row.parts.some((p, j) => j && p.x - row.parts[j - 1].x > width * 0.25)) {
      warnings.push(warning('COLUNAS_AMBIGUAS', 'Há duas colunas ou datas na mesma linha. Ajuste columnBreaks e confira o PDF.', { pagina: page, linha: i + 1 }));
    }
    return { page, column: row.column, line: i + 1, text };
  });
  return { lines, warnings };
}

/**
 * Lê TODAS as páginas em memória. Não envia o PDF a servidor.
 * A rede baixa somente biblioteca/worker e recursos de fontes da CDN.
 * Para PDF protegido, passe password em memória ou onPassword(update, reason).
 */
export async function extractPdfText(file, {
  pdfjsLib, password, onPassword, signal, maxBytes = 20 * 1024 * 1024,
  maxPages = 80, columnBreaks = [], onProgress,
} = {}) {
  if (signal?.aborted) throw new DOMException('Leitura cancelada.', 'AbortError');
  if (file?.size > maxBytes || file?.byteLength > maxBytes) throw new Error('PDF excede o limite de tamanho.');
  let data;
  if (file instanceof Uint8Array) data = file.slice();
  else if (file instanceof ArrayBuffer) data = new Uint8Array(file.slice(0));
  else if (typeof file?.arrayBuffer === 'function') data = new Uint8Array(await file.arrayBuffer());
  else throw new Error('Escolha um arquivo PDF.');
  if (data.byteLength > maxBytes || !new TextDecoder('latin1').decode(data.slice(0, 1024)).includes('%PDF-')) throw new Error('Arquivo PDF inválido ou grande demais.');
  const lib = pdfjsLib || await import(`${PDFJS_CDN}/build/pdf.mjs`);
  if (!pdfjsLib) lib.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}/build/pdf.worker.mjs`;
  const task = lib.getDocument({ data, password, isEvalSupported: false, stopAtErrors: true,
    cMapUrl: `${PDFJS_CDN}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${PDFJS_CDN}/standard_fonts/`,
  });
  if (onPassword) task.onPassword = onPassword;
  let aborted = false;
  const abort = () => { aborted = true; void task.destroy?.(); };
  signal?.addEventListener('abort', abort, { once: true });
  let pdf;
  try {
    pdf = await task.promise;
    if (pdf.numPages > maxPages) throw new Error(`PDF excede ${maxPages} páginas.`);
    const lines = [], warnings = [], pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      if (aborted || signal?.aborted) throw new DOMException('Leitura cancelada.', 'AbortError');
      const page = await pdf.getPage(n);
      try {
        const content = await page.getTextContent();
        const viewport = page.getViewport({ scale: 1 });
        const result = textItemsToLines(content.items, { page: n, width: viewport.width, columnBreaks });
        if (page.rotate) result.warnings.push(warning('PAGINA_ROTACIONADA', 'Confira a ordem do texto desta página rotacionada.', { pagina: n }));
        if (!result.lines.length) result.warnings.push(warning('PAGINA_SEM_TEXTO', 'Página sem texto extraível. Pode exigir OCR; não foi lida automaticamente.', { pagina: n }));
        lines.push(...result.lines); warnings.push(...result.warnings);
        pages.push({ numero: n, linhas: result.lines.length });
        onProgress?.({ pagina: n, total: pdf.numPages });
      } finally { page.cleanup?.(); }
    }
    if (aborted || signal?.aborted) throw new DOMException('Leitura cancelada.', 'AbortError');
    return { lines, pages, warnings, text: lines.map(l => l.text).join('\n'), source: 'pdfjs' };
  } finally {
    signal?.removeEventListener('abort', abort);
    if (pdf) await pdf.destroy?.(); else await task.destroy?.();
  }
}

function makeRows(input) {
  if (typeof input === 'string') {
    if (input.length > MAX_TEXT) throw new Error('Texto grande demais.');
    return input.split('\f').flatMap((page, i) => page.split(/\r?\n/u).map((text, j) => ({ page: i + 1, column: 0, line: j + 1, text: cleanLine(text) }))).filter(r => r.text);
  }
  if (!Array.isArray(input?.lines) || input.lines.length > 30_000) throw new Error('Texto extraído inválido.');
  let length = 0;
  return input.lines.map(r => {
    length += String(r.text).length;
    if (length > MAX_TEXT) throw new Error('Texto grande demais.');
    return { ...r, text: cleanLine(r.text) };
  }).filter(r => r.text);
}

function detectInstallment(description) {
  const matches = [...description.matchAll(REGEXES.parcela)];
  if (!matches.length) return { description, installment: null, ambiguous: false };
  if (matches.length !== 1) return { description, installment: null, ambiguous: true };
  const m = matches[0], current = Number(m[1]), total = Number(m[2]);
  // Total 1 ou n > total também pode ser fragmento de data: nunca adivinhar.
  if (total < 2 || current < 1 || current > total) return { description, installment: null, ambiguous: true };
  return { description: cleanLine(description.slice(0, m.index) + ' ' + description.slice(m.index + m[0].length)), installment: { current, total }, ambiguous: false };
}

/**
 * Máquina de estados: cabeçalho final XXXX abre bloco; subtotal fecha bloco.
 * Repetição do cabeçalho em outra página continua o MESMO bloco ainda aberto.
 * Retorna staging, não objetos prontos para lancamentos.criar do backend atual.
 * criterioMes: 'vencimento' (caixa/orçamento) ou 'compra' (data original).
 */
export async function parseItauText(input, options = {}) {
  const { vencimento, criterioMes = 'vencimento', regras = [], categorias = [], existentes = [], seriesExistentes = [] } = options;
  if (!validDate(vencimento)) throw new Error('Informe o vencimento completo da fatura (AAAA-MM-DD).');
  if (!['vencimento', 'compra'].includes(criterioMes)) throw new Error('Critério de mês inválido.');
  const rows = makeRows(input);
  const lancamentos = [], ignorados = [], pendencias = [], blocos = [];
  const extractionWarnings = typeof input === 'string' ? [] : input.warnings || [];
  for (const w of extractionWarnings) pendencias.push({ ...w });
  let current = null, section = 'atual', pending = null;
  const startBlock = (card, row) => {
    const block = { id: `bloco-${blocos.length + 1}`, cartao_final: card, origem: origin(row), indices: [], pendencias: [], subtotal_centavos: null, fechado: false };
    blocos.push(block); current = block;
    return block;
  };
  const issue = (code, message, row, block = current) => {
    const w = warning(code, message, origin(row));
    pendencias.push(w); block?.pendencias.push(w);
  };
  const flush = () => {
    if (pending) issue('LANCAMENTO_INCOMPLETO', 'Linha de compra sem valor inequívoco. Confira no PDF.', pending.row, pending.block);
    pending = null;
  };
  const add = (row, match, amount) => {
    const block = current || startBlock(null, row);
    const installment = detectInstallment(amount.description);
    const date = purchaseDate(match, vencimento, installment.installment);
    const credit = amount.cents < 0 || REGEXES.credito.test(normalize(amount.description));
    const cents = credit ? -Math.abs(amount.cents) : amount.cents;
    const avisos = [];
    if (!block.cartao_final) avisos.push('Cartão não identificado.');
    if (!date.value) avisos.push('Confirme a data completa da compra; o ano não foi determinado.');
    else if (date.inferred) avisos.push('Ano inferido pelo vencimento; confira a data.');
    if (installment.ambiguous) { avisos.push('Indicação de parcela ambígua.'); issue('PARCELA_AMBIGUA', 'Confirme a parcela antes de importar.', row); }
    if (!date.suggested || (match[3] && !date.value)) issue('DATA_INVALIDA', 'Data inexistente ou posterior ao vencimento.', row);
    if (!amount.description || !/[\p{L}]/u.test(amount.description)) { issue('DESCRICAO_INVALIDA', 'Estabelecimento não identificado.', row); return; }
    const item = {
      id_temporario: `linha-${lancamentos.length + 1}`, origem: origin(row), bloco_id: block.id,
      incluir: true, descricao: amount.description, descricao_base: installment.description,
      valor_centavos: cents, natureza: credit ? 'estorno' : REGEXES.iof.test(normalize(amount.description)) ? 'iof' : 'despesa',
      efeito_financeiro: credit ? 'reducao_despesa' : 'despesa', forma_pagamento: 'credito',
      cartao_final: block.cartao_final, data_texto: `${match[1]}/${match[2]}${match[3] ? '/' + match[3] : ''}`,
      data_compra: date.value, data_compra_sugerida: date.suggested, ano_inferido: date.inferred,
      data_vencimento: vencimento, mes_fatura: vencimento.slice(0, 7), criterio_mes: criterioMes,
      mes_orcamento: criterioMes === 'vencimento' ? vencimento.slice(0, 7) : date.value?.slice(0, 7) || null,
      parcela_numero: installment.installment?.current || null, parcelas_total: installment.installment?.total || null,
      parcelas_restantes: installment.installment ? installment.installment.total - installment.installment.current : 0,
      internacional: amount.international, detalhes_moeda: amount.details,
      categoria_sugerida: suggestCategory(installment.description.replace(/^ESTORNO\s+/iu, ''), { regras, categorias }),
      id_parcelamento: null, id_parcelamento_sugerido: null, hash: null, chave_ocorrencia: null,
      possivel_duplicado: false, duplicidade_motivos: [], avisos,
      // Estorno sem vínculo original exige resolução no importador do backend futuro.
      estorno_de_id: null, exige_revisao: true,
    };
    block.indices.push(lancamentos.length); lancamentos.push(item);
  };

  for (const row of rows) {
    const text = row.text, norm = normalize(text), dated = text.match(REGEXES.data);
    // Excluir pagamento ANTES de qualquer análise de sinal/receita.
    if (REGEXES.pagamento.test(norm)) {
      flush(); ignorados.push({ ...origin(row), motivo: 'pagamento_fatura' }); continue;
    }
    if (!dated && REGEXES.futuro.test(norm)) {
      flush(); section = 'futuro'; ignorados.push({ ...origin(row), motivo: 'projecao_ou_oferta_da_fatura' }); continue;
    }
    const header = !dated && norm.match(REGEXES.cartao);
    if (header) {
      flush();
      // Um cartão também aparece no resumo de próximas faturas. Seu cabeçalho
      // não transforma projeções/ofertas em lançamentos da fatura atual.
      if (section === 'futuro') { ignorados.push({ ...origin(row), motivo: 'projecao_ou_oferta_da_fatura' }); continue; }
      if (!current || current.fechado || current.cartao_final !== header[1]) startBlock(header[1], row);
      continue;
    }
    // Cabeçalhos de lançamentos retomam leitura após resumo/projeção.
    if (!dated && /^(?:LANCAMENTOS(?: ATUAIS)?|COMPRAS E SAQUES|DESPESAS DO CARTAO)(?:\b|$)/u.test(norm) && !REGEXES.futuro.test(norm)) {
      flush(); section = 'atual'; continue;
    }
    if (section === 'futuro') { ignorados.push({ ...origin(row), motivo: 'projecao_ou_oferta_da_fatura' }); continue; }
    if (!dated && /^(?:SUBTOTAL\b|TOTAL (?:DO|DESTE) CARTAO\b)/u.test(norm)) {
      flush();
      const values = moneyTokens(text);
      if (!current || current.fechado) { issue('SUBTOTAL_SEM_BLOCO', 'Subtotal sem bloco de cartão aberto.', row); continue; }
      const partial = /\b(?:NACIONAL|NACIONAIS|INTERNACIONAL|INTERNACIONAIS|PARCIAL|PAGAMENTOS|CREDITOS|COMPRAS A VISTA|PARCELAD[AO]S)\b/u.test(norm);
      if (partial || values.length !== 1 || (values[0].currency && values[0].currency !== 'R$')) {
        issue('SUBTOTAL_AMBIGUO', 'Subtotal parcial ou sem valor inequívoco não valida o cartão inteiro.', row); continue;
      }
      current.subtotal_centavos = values[0].cents;
      current.subtotal_origem = origin(row); current.fechado = true;
      current = null; continue;
    }
    // Cabeçalhos/rodapés conhecidos não completam uma descrição quebrada.
    if (!dated && (REGEXES.informativo.test(norm) || /^(?:DATA\s+|DESCRICAO\b|ESTABELECIMENTO\b|VALOR EM R\$|ITAU(?:CARD)?\b)/u.test(norm))) {
      ignorados.push({ ...origin(row), motivo: 'informativo' }); continue;
    }
    if (dated) {
      flush();
      if (REGEXES.futuro.test(normalize(dated[4]))) { ignorados.push({ ...origin(row), motivo: 'projecao_ou_oferta_da_fatura' }); continue; }
      const amount = readAmount(dated[4]);
      if (amount) add(row, dated, amount);
      else if (moneyTokens(dated[4]).length) issue('VALOR_AMBIGUO', 'Mais de um valor/moeda, ou coluna BRL não identificada.', row, current || startBlock(null, row));
      else pending = { row, match: dated, block: current || startBlock(null, row) };
      continue;
    }
    // Descrição em mais de uma linha: unir só até a primeira linha com valor.
    if (pending) {
      if (pending.row.page !== row.page || pending.row.column !== row.column) { flush(); }
      else {
        const joined = cleanLine(pending.match[4] + ' ' + text);
        const amount = readAmount(joined);
        if (amount) { const p = pending; pending = null; add({ ...p.row, text: p.row.text + ' | ' + text }, p.match, amount); continue; }
        if (!moneyTokens(text).length && joined.length < 300) { pending.match[4] = joined; continue; }
        flush();
      }
    }
    // Linhas de cotação sem data são informativas; IOF real precisa de DD/MM.
    if (/^(?:COTACAO|TAXA DE CONVERSAO|DOLAR (?:DOS EUA|AMERICANO)|VALOR EM (?:US\$|DOLAR|MOEDA ESTRANGEIRA))/u.test(norm)) {
      ignorados.push({ ...origin(row), motivo: 'conversao_informativa' }); continue;
    }
    if (moneyTokens(text).length || REGEXES.iof.test(norm) || /\d{1,2}\/\d{1,2}/u.test(text)) {
      issue('LINHA_NAO_RECONHECIDA', 'Linha possivelmente financeira não reconhecida; revise antes de importar.', row);
    } else {
      // Lixo desconhecido dentro de bloco também impede um selo verde enganoso.
      if (current) issue('TEXTO_NAO_RECONHECIDO', 'Texto não reconhecido dentro do bloco do cartão.', row);
      else ignorados.push({ ...origin(row), motivo: 'texto_sem_lancamento' });
    }
  }
  flush();

  // IDs/chaves de comparação são calculados só em memória; nada é descartado.
  const occurrenceCounts = new Map();
  for (const item of lancamentos) {
    if (item.parcelas_total) {
      // Candidato, não identidade definitiva: duas compras iguais podem coexistir.
      item.id_parcelamento_sugerido = 'itau-candidato-' + await fingerprint(JSON.stringify([item.cartao_final, normalize(item.descricao_base), item.data_texto.slice(0, 5), item.parcelas_total]));
      const candidates = seriesExistentes.filter(s => s.cartao_final === item.cartao_final && normalize(s.descricao_base) === normalize(item.descricao_base) && s.parcelas_total === item.parcelas_total && validDate(s.data_compra) && `${s.data_compra.slice(8, 10)}/${s.data_compra.slice(5, 7)}` === item.data_texto.slice(0, 5) && (!item.data_compra || s.data_compra === item.data_compra));
      item.candidatos_parcelamento = candidates.map(s => s.id_parcelamento);
      // Uma série antiga com o mesmo DD/MM NÃO prova identidade. Exigir também
      // o ciclo da primeira fatura e o valor da parcela cadastrados na revisão.
      const series = candidates.filter(s => /^\d{4}-(?:0[1-9]|1[0-2])$/u.test(s.mes_primeira_fatura) && shiftMonth(s.mes_primeira_fatura, item.parcela_numero - 1) === item.mes_fatura && s.valor_parcela_centavos === item.valor_centavos);
      if (series.length === 1 && series[0].id_parcelamento) {
        item.id_parcelamento = series[0].id_parcelamento;
        item.data_compra = series[0].data_compra;
        if (criterioMes === 'compra') item.mes_orcamento = item.data_compra.slice(0, 7);
      } else if (candidates.length) item.avisos.push('Parcelamento semelhante sem vínculo inequívoco. Confira ano, ciclo e valor na revisão.');
    }
    item.hash = await fingerprint(JSON.stringify([item.data_compra || item.data_texto, normalize(item.descricao), item.valor_centavos]));
    item.chave_ocorrencia = await fingerprint(JSON.stringify([item.hash, item.cartao_final, item.mes_fatura, item.parcela_numero]));
    occurrenceCounts.set(item.chave_ocorrencia, (occurrenceCounts.get(item.chave_ocorrencia) || 0) + 1);
    for (const existing of existentes) {
      if (existing.chave_ocorrencia === item.chave_ocorrencia || (existing.hash === item.hash && (!existing.cartao_final || existing.cartao_final === item.cartao_final))) {
        item.possivel_duplicado = true; item.duplicidade_motivos.push('Possível lançamento já existente.'); break;
      }
      if (item.id_parcelamento && existing.id_parcelamento === item.id_parcelamento && existing.parcela_numero === item.parcela_numero) {
        item.possivel_duplicado = true; item.duplicidade_motivos.push('Parcela existente ou projetada: reconciliar, não inserir novamente.'); break;
      }
    }
  }
  for (const item of lancamentos) {
    if (occurrenceCounts.get(item.chave_ocorrencia) > 1) {
      item.possivel_duplicado = true; item.duplicidade_motivos.push('Há itens iguais neste PDF; podem ser compras legítimas distintas.');
    }
  }
  for (const block of blocos) {
    block.soma_centavos = block.indices.reduce((sum, i) => sum + lancamentos[i].valor_centavos, 0);
    block.diferenca_centavos = block.subtotal_centavos === null ? null : block.soma_centavos - block.subtotal_centavos;
    const pageProblems = extractionWarnings.some(w => !w.pagina || w.pagina === block.origem.pagina || block.indices.some(i => lancamentos[i].origem.pagina === w.pagina));
    block.status = !block.cartao_final || !block.indices.length || block.subtotal_centavos === null || block.pendencias.length || pageProblems ? 'pendente' : block.diferenca_centavos === 0 ? 'validado' : 'divergente';
    block.selo = block.status === 'validado' ? 'Soma validada com a fatura' : block.status === 'divergente' ? 'Soma diferente do subtotal' : 'Soma ainda não validada';
  }
  if (!lancamentos.length) pendencias.push(warning('SEM_LANCAMENTOS', 'Nenhum lançamento identificado. Cole o texto ou use OCR em uma etapa futura.'));
  return {
    versao_parser: '0.1.0', origem: typeof input === 'string' ? 'texto_colado' : input.source || 'texto_extraido',
    vencimento, criterio_mes: criterioMes, exigeRevisao: true, lancamentos, ignorados, pendencias, blocos,
    resumo: { quantidade: lancamentos.length, total_centavos: lancamentos.reduce((s, l) => s + l.valor_centavos, 0),
      pagamentos_ignorados: ignorados.filter(i => i.motivo === 'pagamento_fatura').length,
      possiveis_duplicados: lancamentos.filter(l => l.possivel_duplicado).length,
      soma_validada: blocos.length > 0 && blocos.every(b => b.status === 'validado') && !pendencias.length },
  };
}

export async function parseItauPdf(file, options = {}) {
  const extracted = await extractPdfText(file, options);
  return parseItauText(extracted, options);
}

/**
 * Projeção PURA e opt-in; não cria compra de valor total nem grava parcelas.
 * O valor de cada futura parcela é uma ESTIMATIVA (a última pode ter ajuste).
 * Persistir id_parcelamento + número da parcela permite reconciliar a próxima fatura.
 */
export async function projetarParcelas(item, { confirmado = false, idParcelamento, existentes = [] } = {}) {
  if (confirmado !== true) throw new Error('A projeção precisa da confirmação explícita do usuário.');
  if (!Number.isInteger(item.parcela_numero) || !Number.isInteger(item.parcelas_total) || item.parcela_numero < 1 || item.parcelas_total > 99 || item.parcela_numero > item.parcelas_total || item.valor_centavos <= 0 || !Number.isSafeInteger(item.valor_centavos) || !validDate(item.data_vencimento) || !item.cartao_final) throw new Error('Parcela sem dados válidos para projeção.');
  const seriesId = idParcelamento || item.id_parcelamento || `itau-${globalThis.crypto.randomUUID()}`;
  if (typeof seriesId !== 'string' || !seriesId.trim()) throw new Error('Identificador do parcelamento inválido.');
  const parcelas = [];
  for (let n = item.parcela_numero + 1; n <= item.parcelas_total; n++) {
    const month = shiftMonth(item.data_vencimento.slice(0, 7), n - item.parcela_numero);
    const due = dateInMonth(month, Number(item.data_vencimento.slice(8, 10)));
    parcelas.push({
      id_parcelamento: seriesId, parcela_numero: n, parcelas_total: item.parcelas_total,
      descricao: item.descricao_base, cartao_final: item.cartao_final, valor_centavos: item.valor_centavos,
      data_compra: item.data_compra, data_vencimento: due, mes_fatura: month,
      mes_orcamento: item.criterio_mes === 'compra' ? item.data_compra?.slice(0, 7) || null : month,
      status: 'previsto', valor_estimado: true, exige_revisao: true,
      chave_parcela: await fingerprint(JSON.stringify([seriesId, n])),
      possivel_duplicado: existentes.some(e => e.id_parcelamento === seriesId && e.parcela_numero === n),
    });
  }
  return { id_parcelamento: seriesId, parcela_atual: item.parcela_numero, parcelas,
    serie: { id_parcelamento: seriesId, cartao_final: item.cartao_final, descricao_base: item.descricao_base,
      data_compra: item.data_compra, parcelas_total: item.parcelas_total, valor_parcela_centavos: item.valor_centavos,
      mes_primeira_fatura: shiftMonth(item.data_vencimento.slice(0, 7), -(item.parcela_numero - 1)) },
  };
}

/**
 * Fallback explícito e opcional, SEM Gemini/chave embutida.
 * extractor é fornecido depois pelo aplicativo. Nenhuma chamada automática à IA.
 * Exigir consentimento antes de enviar um PDF com dados pessoais a terceiros.
 * O adaptador deve retornar TEXTO, que passa pelas mesmas regras e pela revisão.
 */
export async function parseWithAiFallback(file, { consentimento = false, extractor, ...options } = {}) {
  if (consentimento !== true) throw new Error('Confirme o envio do documento ao provedor de IA escolhido.');
  if (typeof extractor !== 'function') throw new Error('Configure um adaptador de extração por IA.');
  const text = await extractor(file, { signal: options.signal });
  if (typeof text !== 'string') throw new Error('O adaptador de IA deve retornar texto.');
  const result = await parseItauText(text, options);
  result.origem = 'ia_nao_confiavel';
  result.pendencias.push(warning('EXTRACAO_IA', 'Texto gerado por IA pode omitir/inventar linhas. Compare com o PDF original.'));
  result.resumo.soma_validada = false;
  for (const block of result.blocos) { block.status = 'pendente'; block.selo = 'Extração por IA exige conferência do PDF'; }
  return result;
}
