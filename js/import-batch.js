/** Compacta apenas os dados já revisados. Sem rede, PDF ou armazenamento. */
import { isoDate } from './utils.js';

const GROUPS = new Set(['necessidades', 'desejos', 'metas']);
const MODES = new Set(['fisico', 'virtual', 'adicional']);
const ID = /^[A-Za-z0-9_-]{1,120}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{8,100}$/;
const MAX_ITEMS = 200, MAX_FUTURE = 1200, MAX_PAYLOAD = 250000;
function invalid(message) { const error = new Error(message); error.code = 'IMPORTACAO_INVALIDA'; throw error; }
function text(value, label, max, required = true) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string' || value.length > max || required && !value.trim()) invalid(`Confira ${label}.`);
  return value.trim();
}
function id(value, label, required = true) {
  const result = text(value, label, 120, required);
  if (result && !ID.test(result)) invalid(`Identificador inválido: ${label}.`);
  return result;
}
function flag(value, label) {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') invalid(`Opção inválida: ${label}.`);
  return value;
}

/**
 * Devolve uma cópia compacta e independente do plano. O servidor recalcula
 * hashes, identidades, regras e parcelas futuras antes de gravar o lote.
 */
export function buildBatchInsertRequest(plan, { cartoes = [], categorias = [], contas = [], requestId } = {}) {
  if (!plan || plan.status !== 'revisado_em_memoria') invalid('Conclua e confirme a revisão antes de preparar a importação.');
  if (!isoDate(plan.vencimento)) invalid('Informe o vencimento completo da fatura.');
  if (!['vencimento', 'compra'].includes(plan.criterio_mes)) invalid('Escolha o mês de referência.');
  if (!Array.isArray(plan.lancamentos) || !plan.lancamentos.length || plan.lancamentos.length > MAX_ITEMS) invalid('Selecione entre 1 e 200 lançamentos por lote.');
  if (!Array.isArray(cartoes) || !Array.isArray(categorias) || !Array.isArray(contas)) invalid('Consulte os cartões, categorias e contas antes de importar.');
  const categoryMap = new Map(categorias.filter(c => c && c.ativa === true && c.tipo_movimentacao === 'despesa').map(c => [c.id, c]));
  const accountMap = new Map(contas.filter(c => c && c.ativa === true && c.tipo === 'cartao').map(c => [c.id, c]));
  const selectedFinals = new Set();
  const rowIds = new Set();
  let futureCount = 0, absoluteTotal = 0;
  const lancamentos = plan.lancamentos.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row) || row.incluir === false) invalid('O lote contém um item que não está selecionado.');
    const clientId = id(row.id_temporario, 'linha');
    if (rowIds.has(clientId)) invalid('Há identificadores de linha repetidos.');
    rowIds.add(clientId);
    const occurrence = row.ocorrencia_importacao;
    if (occurrence !== undefined && (!Number.isSafeInteger(occurrence) || occurrence < 1 || occurrence > 50000)) invalid('Confira a ocorrência do lançamento no PDF completo.');
    if (!isoDate(row.data_compra) || row.data_compra > plan.vencimento || row.data_compra_confirmada === false) invalid(`Confira a data completa de ${row.descricao || clientId}.`);
    const description = text(row.descricao, 'o estabelecimento', 500);
    const amount = row.valor_centavos;
    if (!Number.isSafeInteger(amount) || amount === 0 || Math.abs(amount) > 9000000000000) invalid(`Confira o valor de ${description}.`);
    absoluteTotal += Math.abs(amount);
    if (!Number.isSafeInteger(absoluteTotal)) invalid('O total do lote excede o limite permitido.');
    const categoryId = id(row.categoria_id, 'categoria');
    if (/^previa-/i.test(categoryId) || !categoryMap.has(categoryId)) invalid('Escolha uma categoria de despesa ativa da sua planilha.');
    if (!GROUPS.has(row.grupo_orcamento)) invalid(`Escolha o grupo do orçamento de ${description}.`);
    const final = text(row.cartao_final, 'o final do cartão', 4);
    if (!/^\d{4}$/.test(final)) invalid('Informe os quatro dígitos finais de cada cartão.');
    selectedFinals.add(final);
    let number = null, total = null;
    if (row.parcelas_total !== undefined && row.parcelas_total !== null && row.parcelas_total !== '') {
      total = row.parcelas_total; number = row.parcela_numero;
      if (!Number.isInteger(total) || total < 2 || total > 99 || !Number.isInteger(number) || number < 1 || number > total) invalid(`Confira as parcelas de ${description}.`);
    } else if (row.parcela_numero !== undefined && row.parcela_numero !== null && row.parcela_numero !== '') invalid('Informe também o total de parcelas.');
    const project = flag(row.projetar, 'projetar parcelas');
    const learn = flag(row.aprender, 'lembrar categoria');
    const duplicateReviewed = flag(row.duplicidade_revisada, 'conferência de duplicidade');
    if (row.possivel_duplicado && !duplicateReviewed) invalid('Confira a possível duplicidade antes de manter o item.');
    if (project && (total === null || amount < 0 || number === total)) invalid(`Não há parcelas futuras válidas para ${description}.`);
    const seriesId = id(row.id_parcelamento, 'parcelamento', false);
    if (seriesId && total === null) invalid('Uma compra à vista não recebe parcelamento.');
    futureCount += project ? total - number : 0;
    if (futureCount > MAX_FUTURE) invalid('Reduza o lote para até 1.200 parcelas futuras.');
    return {
      id_cliente: clientId, data_compra: row.data_compra, descricao: description,
      valor_centavos: amount, categoria_id: categoryId, grupo_orcamento: row.grupo_orcamento,
      cartao_final: final, parcela_numero: number, parcelas_total: total,
      id_parcelamento: seriesId || null, projetar: project, aprender: learn,
      duplicidade_revisada: duplicateReviewed,
      ...(occurrence === undefined ? {} : { ocorrencia: occurrence }),
    };
  });
  const cardMap = new Map();
  for (const draft of cartoes) {
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)) invalid('Confira o cadastro dos cartões.');
    const final = text(draft.final, 'o final do cartão', 4);
    if (!/^\d{4}$/.test(final)) invalid('Informe quatro dígitos em cada final de cartão.');
    if (cardMap.has(final)) invalid(`O final ${final} foi cadastrado duas vezes.`);
    // Cartões sem itens selecionados não entram no pedido nem salvam metadados.
    if (!selectedFinals.has(final)) { cardMap.set(final, null); continue; }
    const accountId = id(draft.conta_id, 'conta do cartão');
    if (!accountMap.has(accountId)) invalid(`Vincule o final ${final} a uma conta de cartão ativa.`);
    if (!MODES.has(draft.modalidade)) invalid(`Escolha a modalidade do cartão final ${final}.`);
    cardMap.set(final, {
      final, apelido: text(draft.apelido, 'o apelido do cartão', 100, false),
      modalidade: draft.modalidade, responsavel: text(draft.responsavel, 'o responsável pelo cartão', 100, false),
      conta_id: accountId,
    });
  }
  for (const final of selectedFinals) if (!cardMap.get(final)) invalid(`Vincule o cartão final ${final} antes de importar.`);
  const uniqueId = requestId === undefined ? globalThis.crypto?.randomUUID?.() : requestId;
  if (typeof uniqueId !== 'string' || !REQUEST_ID.test(uniqueId)) invalid('Use um identificador válido para o envio da importação.');
  const request = {
    acao: 'batchInsert', request_id: uniqueId,
    dados: { confirmado: true, vencimento: plan.vencimento, criterio_mes: plan.criterio_mes,
      cartoes: [...selectedFinals].map(final => cardMap.get(final)), lancamentos },
  };
  if (JSON.stringify(request).length > MAX_PAYLOAD) invalid('O lote excede 250 mil caracteres. Reduza os itens selecionados.');
  return request;
}
