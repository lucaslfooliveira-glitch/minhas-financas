/** Estado da revisão Itaú. Somente memória; sem DOM, rede ou persistência. */
import { REGEXES, fingerprint, projetarParcelas } from './itauPdfParser.js';
import { isoDate } from './utils.js';

const GROUPS = new Set(['necessidades', 'desejos', 'metas']);
const PATCH_KEYS = new Set([
  'incluir', 'categoria_id', 'grupo_orcamento', 'data_compra', 'cartao_final',
  'valor_centavos', 'descricao', 'aprender', 'projetar', 'duplicidade_revisada',
  'data_compra_confirmada',
  'id_parcelamento',
]);
const FLAGS = new Set(['incluir', 'aprender', 'projetar', 'duplicidade_revisada', 'data_compra_confirmada']);
const SERIES_FIELDS = new Set(['data_compra', 'cartao_final', 'valor_centavos', 'descricao']);
const clone = value => structuredClone(value);
const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const category = (review, id) => review.categories.find(c => c.id === id && c.ativa !== false && c.tipo_movimentacao === 'despesa');

function baseDescription(description) {
  // A data já foi retirada pelo parser. Remover somente o indicador de parcela.
  return clean(description.replace(REGEXES.parcela, ' '));
}
function merchant(row) {
  const name = String(row.descricao_base || row.descricao || '');
  // Prefixo operacional, não a palavra em qualquer lugar do nome da loja.
  return normalize(name.replace(/^(?:ESTORNO|DEVOLUCAO|DEVOLUÇÃO|REEMBOLSO)(?: DE| DA)?\s*[:*\-]?\s+/iu, ''));
}
function monthFor(row, criterion, due) {
  return criterion === 'vencimento' ? due.slice(0, 7) : isoDate(row.data_compra) ? row.data_compra.slice(0, 7) : null;
}
function syncFinancialFields(row, review) {
  row.data_vencimento = review.vencimento;
  row.mes_fatura = review.vencimento.slice(0, 7);
  row.criterio_mes = review.criterioMes;
  row.mes_orcamento = monthFor(row, review.criterioMes, review.vencimento);
  row.efeito_financeiro = row.valor_centavos < 0 ? 'reducao_despesa' : 'despesa';
  row.natureza = row.valor_centavos < 0 ? 'estorno' : row.natureza === 'iof' ? 'iof' : 'despesa';
  row.forma_pagamento = 'credito';
}
function newSeriesId() {
  if (!globalThis.crypto?.randomUUID) throw new Error('Abra o aplicativo por HTTPS ou localhost para identificar as parcelas.');
  return `itau-${globalThis.crypto.randomUUID()}`;
}

/** O resultado original do parser é preservado, inclusive totais/proveniência. */
export function createReview(result, { categorias = [] } = {}) {
  if (!result || !Array.isArray(result.lancamentos) || !isoDate(result.vencimento)) throw new Error('Resultado de leitura inválido.');
  if (!['compra', 'vencimento'].includes(result.criterio_mes)) throw new Error('Critério da fatura inválido.');
  const review = {
    result: clone(result), rows: [], criterioMes: result.criterio_mes,
    vencimento: result.vencimento, categories: clone(categorias), revision: 0,
  };
  const ids = new Set();
  review.rows = result.lancamentos.map((item, index) => {
    const source = clone(item);
    const id = source.id_temporario || `linha-${index + 1}`;
    if (ids.has(id)) throw new Error('Identificadores de revisão repetidos.');
    ids.add(id);
    const selected = category(review, source.categoria_sugerida?.id);
    const row = {
      ...source, id_temporario: id, incluir: source.incluir !== false,
      categoria_id: selected?.id || '',
      categoria_nome: selected?.nome || source.categoria_sugerida?.nome || 'Não categorizado',
      grupo_orcamento: selected?.grupo_orcamento || source.categoria_sugerida?.grupo_orcamento || '',
      data_compra_confirmada: !!source.data_compra && !source.ano_inferido,
      aprender: false, projetar: false, duplicidade_revisada: false,
      _serieCriadaNaRevisao: false,
    };
    syncFinancialFields(row, review);
    return row;
  });
  return review;
}

/** Edição atômica de campos permitidos. Erros não deixam uma linha parcialmente editada. */
export function updateReviewRow(review, id, patch) {
  const index = review.rows.findIndex(r => r.id_temporario === id);
  if (index < 0) throw new Error('Lançamento não encontrado na revisão.');
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Edição inválida.');
  for (const [key, value] of Object.entries(patch)) {
    if (!PATCH_KEYS.has(key)) throw new Error('Campo de revisão não permitido.');
    if (FLAGS.has(key) && typeof value !== 'boolean') throw new Error('Opção de revisão inválida.');
    if (key === 'valor_centavos' && (!Number.isSafeInteger(value) || value === 0 || Math.abs(value) > 9_000_000_000_000)) throw new Error('Informe um valor não nulo em centavos inteiros.');
    if (key === 'descricao' && (!clean(value) || clean(value).length > 500)) throw new Error('Informe uma descrição de até 500 caracteres.');
  }
  const before = review.rows[index];
  const row = { ...before, ...patch };
  if ('id_parcelamento' in patch) {
    if (patch.id_parcelamento !== null && typeof patch.id_parcelamento !== 'string') throw new Error('Vínculo de parcelamento inválido.');
    if (String(patch.id_parcelamento || '').length > 100) throw new Error('Vínculo de parcelamento inválido.');
    row.id_parcelamento = patch.id_parcelamento || null;
    row._serieCriadaNaRevisao = false;
    row.duplicidade_revisada = false;
  }
  if ('categoria_id' in patch) {
    const selected = category(review, patch.categoria_id);
    row.categoria_id = selected?.id || '';
    row.categoria_nome = selected?.nome || 'Não categorizado';
    row.grupo_orcamento = selected?.grupo_orcamento || '';
    row.aprender = !!selected;
  }
  if ('grupo_orcamento' in patch) {
    row.grupo_orcamento = String(patch.grupo_orcamento ?? '');
    if (category(review, row.categoria_id)) row.aprender = true;
  }
  if ('aprender' in patch) row.aprender = patch.aprender;
  if ('data_compra' in patch) {
    row.data_compra = patch.data_compra || null;
    row.data_compra_confirmada = !!row.data_compra && isoDate(row.data_compra);
  }
  if ('data_compra_confirmada' in patch) row.data_compra_confirmada = patch.data_compra_confirmada;
  if ('descricao' in patch) {
    row.descricao = clean(patch.descricao);
    row.descricao_base = baseDescription(row.descricao);
  }
  if ('cartao_final' in patch) row.cartao_final = String(patch.cartao_final ?? '').trim();
  syncFinancialFields(row, review);
  if (row.valor_centavos < 0) row.projetar = false;

  const changedSeries = Object.keys(patch).some(key => SERIES_FIELDS.has(key) && row[key] !== before[key]);
  // A decisão de manter uma possível duplicata vale para os dados conferidos.
  // Editar sua identidade exige nova conferência, mesmo se o patch trouxer o ack.
  if (changedSeries) row.duplicidade_revisada = false;
  if (changedSeries && row.id_parcelamento && !row._serieCriadaNaRevisao) row.id_parcelamento = null;
  if (row.projetar && !row.id_parcelamento) {
    row.id_parcelamento = newSeriesId();
    row._serieCriadaNaRevisao = true;
  }
  review.rows[index] = row;
  review.revision++;
  return row;
}

/** Identifica um bloco inteiro sem alterar a extração original ou salvar dados. */
export function assignBlockCard(review, blockId, final) {
  if (!review || !Array.isArray(review.rows) || !Array.isArray(review.result?.blocos)) throw new Error('Revisão inválida.');
  if (typeof blockId !== 'string' || !review.result.blocos.some(block => block.id === blockId)) throw new Error('Bloco de cartão não encontrado.');
  if (typeof final !== 'string' || !/^\d{4}$/u.test(final.trim())) throw new Error('Informe os quatro dígitos finais impressos no seu cartão.');
  const affected = review.rows.filter(row => row.bloco_id === blockId);
  if (!affected.length) throw new Error('Este bloco não possui lançamentos para identificar.');
  if (new Set(review.rows.map(row => row.id_temporario)).size !== review.rows.length) throw new Error('Identificadores de revisão repetidos.');
  // updateReviewRow também invalida vínculos e confirmações de duplicidade. Só
  // publicar o novo vetor quando todas as edições tiverem terminado com sucesso.
  const staged = { ...review, rows: review.rows.slice() };
  for (const row of affected) updateReviewRow(staged, row.id_temporario, { cartao_final: final.trim() });
  review.rows = staged.rows;
  review.revision = staged.revision;
  return affected.length;
}

/** Troca o critério/mês sem refazer o parser nem perder correções da tabela. */
export function updateReceiptOptions(review, { criterioMes = review.criterioMes, vencimento = review.vencimento } = {}) {
  if (!['compra', 'vencimento'].includes(criterioMes)) throw new Error('Escolha mês do vencimento ou mês da compra.');
  if (!isoDate(vencimento)) throw new Error('Informe um vencimento válido.');
  const changedDue = vencimento !== review.vencimento;
  review.criterioMes = criterioMes;
  review.vencimento = vencimento;
  review.rows.forEach(row => {
    if (changedDue) row.duplicidade_revisada = false;
    if (changedDue && row.id_parcelamento && !row._serieCriadaNaRevisao) {
      row.id_parcelamento = row.projetar ? newSeriesId() : null;
      row._serieCriadaNaRevisao = row.projetar;
    }
    syncFinancialFields(row, review);
  });
  review.revision++;
  return review;
}

/** creditCents mantém sinal negativo; total é a soma líquida dos itens selecionados. */
export function summarizeReview(review) {
  const selected = review.rows.filter(row => row.incluir);
  const summary = {
    selectedCount: selected.length, ignoredCount: review.rows.length - selected.length,
    expenseCents: 0, creditCents: 0, totalCents: 0,
    projectionCount: 0, projectionCents: 0,
    duplicateCount: selected.filter(row => row.possivel_duplicado).length,
    problems: [], ready: false,
  };
  const addProblem = (id, code, message) => summary.problems.push({ id, code, message });
  if (!selected.length) addProblem(null, 'SEM_ITENS', 'Selecione pelo menos um lançamento.');
  if (!isoDate(review.vencimento)) addProblem(null, 'VENCIMENTO', 'Informe um vencimento válido.');
  if (!['compra', 'vencimento'].includes(review.criterioMes)) addProblem(null, 'CRITERIO', 'Escolha o mês de referência.');
  const learned = new Map();
  const projectedSeries = new Map();
  for (const row of selected) {
    const id = row.id_temporario;
    const cents = row.valor_centavos;
    if (!Number.isSafeInteger(cents) || cents === 0 || Math.abs(cents) > 9_000_000_000_000) addProblem(id, 'VALOR', 'Corrija o valor deste lançamento.');
    else {
      if (cents > 0) summary.expenseCents += cents;
      else summary.creditCents += cents;
      summary.totalCents += cents;
    }
    if (!category(review, row.categoria_id)) addProblem(id, 'CATEGORIA', 'Escolha uma categoria de despesa.');
    if (!GROUPS.has(row.grupo_orcamento)) addProblem(id, 'GRUPO', 'Defina o grupo do orçamento.');
    if (!isoDate(row.data_compra) || row.data_compra > review.vencimento) addProblem(id, 'DATA', 'Confirme a data completa da compra, até o vencimento.');
    else if (!row.data_compra_confirmada) addProblem(id, 'DATA_NAO_CONFIRMADA', 'Confira e confirme o ano sugerido para esta compra.');
    if (!/^\d{4}$/u.test(row.cartao_final || '')) addProblem(id, 'CARTAO', 'Informe os quatro dígitos finais do cartão.');
    if (!clean(row.descricao) || row.descricao.length > 500) addProblem(id, 'DESCRICAO', 'Corrija a descrição do estabelecimento.');
    if (REGEXES.pagamento.test(normalize(row.descricao))) addProblem(id, 'PAGAMENTO_FATURA', 'Pagamento de fatura deve ser ignorado, pois não é uma nova despesa.');
    if (!['despesa', 'iof', 'estorno'].includes(row.natureza) || (cents < 0 && row.natureza !== 'estorno') || (cents > 0 && row.natureza === 'estorno')) addProblem(id, 'SINAL', 'O tipo precisa corresponder ao sinal da despesa ou do estorno.');
    if (row.possivel_duplicado && !row.duplicidade_revisada) addProblem(id, 'DUPLICIDADE', 'Confira a possível duplicidade ou desmarque o item.');
    if (row.projetar) {
      if (!(Number.isInteger(row.parcela_numero) && Number.isInteger(row.parcelas_total) && row.parcela_numero >= 1 && row.parcelas_total <= 99 && row.parcela_numero < row.parcelas_total && cents > 0)) addProblem(id, 'PROJECAO', 'A projeção exige uma parcela válida com saldo de parcelas futuras.');
      else {
        const count = row.parcelas_total - row.parcela_numero;
        summary.projectionCount += count;
        summary.projectionCents += count * cents;
        if (row.id_parcelamento && projectedSeries.has(row.id_parcelamento)) {
          addProblem(id, 'PROJECAO_DUPLICADA', 'O mesmo parcelamento tem mais de uma projeção selecionada. Projete as parcelas a partir de uma única linha.');
        } else if (row.id_parcelamento) projectedSeries.set(row.id_parcelamento, id);
      }
    }
    if (row.aprender) {
      const key = merchant(row);
      const value = JSON.stringify([row.categoria_id, row.grupo_orcamento]);
      if (!key) addProblem(id, 'REGRA_SEM_LOJA', 'Informe o estabelecimento para lembrar a categoria.');
      else if (learned.has(key) && learned.get(key).value !== value) {
        addProblem(id, 'REGRA_CONFLITANTE', 'A mesma loja tem categorias ou grupos diferentes para lembrar. Desative uma das regras.');
        const previous = learned.get(key);
        if (!summary.problems.some(p => p.id === previous.id && p.code === 'REGRA_CONFLITANTE')) addProblem(previous.id, 'REGRA_CONFLITANTE', 'A mesma loja tem categorias ou grupos diferentes para lembrar. Desative uma das regras.');
      } else learned.set(key, { value, id });
    }
  }
  if (![summary.expenseCents, summary.creditCents, summary.totalCents, summary.projectionCents].every(Number.isSafeInteger)) addProblem(null, 'TOTAL', 'O total da revisão excede o limite permitido.');
  summary.ready = summary.problems.length === 0;
  return summary;
}

/**
 * Produz plano destacado da tabela SOMENTE após confirmação explícita.
 * Não chama API. Uma edição enquanto os hashes são calculados invalida o plano.
 */
export async function buildReviewPlan(review, { confirmado = false, pendenciasConferidas = false } = {}) {
  if (confirmado !== true) throw new Error('Confirme a revisão dos lançamentos antes de preparar o lote.');
  const summary = summarizeReview(review);
  if (!summary.ready) throw new Error(summary.problems[0].message);
  if (review.result.pendencias?.length && pendenciasConferidas !== true) throw new Error('Confira as linhas e os alertas não reconhecidos com a fatura original.');
  const revision = review.revision;
  const snapshot = clone(review);
  // Contar no documento COMPLETO antes de aplicar os checkboxes. Importar só
  // a segunda de duas compras iguais precisa continuar usando ocorrência 2.
  const occurrences = new Map();
  for (const row of snapshot.rows) {
    const key = JSON.stringify([row.data_compra || row.data_compra_sugerida || row.data_texto, merchant(row), row.valor_centavos, row.cartao_final, row.mes_fatura, row.parcela_numero || 1]);
    const ordinal = (occurrences.get(key) || 0) + 1;
    occurrences.set(key, ordinal); row.ocorrencia_importacao = ordinal;
  }
  const plan = {
    versao: 1, status: 'revisado_em_memoria', vencimento: snapshot.vencimento,
    criterio_mes: snapshot.criterioMes, lancamentos: [], parcelas_previstas: [],
    regras_categorizacao: [], series_parcelamento: [], revision,
  };
  const rules = new Map();
  const series = new Map();
  for (const source of snapshot.rows.filter(row => row.incluir)) {
    const { _serieCriadaNaRevisao, ...row } = source;
    row.hash = await fingerprint(JSON.stringify([row.data_compra, normalize(row.descricao), row.valor_centavos]));
    row.chave_ocorrencia = await fingerprint(JSON.stringify([row.hash, row.cartao_final, row.mes_fatura, row.parcela_numero]));
    row.exige_revisao = false;
    row.status_revisao = 'confirmado_pelo_usuario';
    plan.lancamentos.push(row);
    if (row.projetar) {
      const projected = await projetarParcelas(row, { confirmado: true, idParcelamento: row.id_parcelamento });
      row.id_parcelamento = projected.id_parcelamento;
      plan.parcelas_previstas.push(...projected.parcelas);
      series.set(projected.id_parcelamento, projected.serie);
    }
    if (row.aprender) {
      const key = merchant(row);
      rules.set(key, { estabelecimento: key, categoria_id: row.categoria_id, categoria_nome: row.categoria_nome, grupo_orcamento: row.grupo_orcamento, ativa: true });
    }
  }
  plan.regras_categorizacao = [...rules.values()];
  plan.series_parcelamento = [...series.values()];
  if (review.revision !== revision) throw new Error('A revisão foi alterada. Confira os dados e confirme novamente.');
  return plan;
}
