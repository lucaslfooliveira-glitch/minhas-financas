import { isoDate } from './utils.js';
import { sha256Sync } from './sha256.js';

const changed = () => new Error('Os dados do cartão mudaram durante a conferência. Feche esta janela e confira novamente antes de reconhecer a dívida.');
const integer = value => Number.isSafeInteger(value);
function sum(values) {
  const result = values.reduce((total, value) => {
    if (!integer(value)) throw new Error('Há um valor inválido no histórico do cartão.');
    return total + value;
  }, 0);
  if (!integer(result)) throw new Error('O total do cartão está fora do intervalo permitido.');
  return result;
}
const effectDate = row => row.tipo === 'despesa' && row.forma_pagamento === 'credito' || row.tipo === 'estorno' ? row.data_ocorrencia : row.data_pagamento;

/** Lê todo o histórico do cartão, inclusive pagamentos de meses anteriores. */
async function readAccountRows(read, accountId, field) {
  const rows = [];
  let offset = 0;
  for (let page = 0; page < 100; page++) {
    const result = await read({ acao: 'registros.listar', tabela: 'Lancamentos', filtros: { [field]: accountId, status: 'confirmado' }, limite: 500, offset });
    if (!Array.isArray(result.registros) || !integer(result.total)) throw changed();
    rows.push(...result.registros);
    const next = result.proximo_offset;
    if (next === null || next === undefined) {
      if (rows.length !== result.total) throw changed();
      return rows;
    }
    if (!integer(next) || next <= offset || next > 50000) throw changed();
    offset = next;
  }
  throw new Error('O histórico excede o limite de conferência. Nenhum ajuste foi enviado.');
}

export async function loadDebtRecognition(read, accountId) {
  const initials = await read({ acao: 'dados.iniciais' });
  const account = initials.contas?.find(row => row.id === accountId && row.tipo === 'cartao');
  const date = initials.hoje;
  if (!account || !isoDate(date)) throw new Error('Não foi possível identificar o cartão e a data da consulta.');
  const [dashboard, invoices, origins, destinations] = await Promise.all([
    read({ acao: 'dashboard.obter', mes: date.slice(0, 7), data: date }),
    read({ acao: 'faturas.listar', conta_id: accountId }),
    readAccountRows(read, accountId, 'conta_origem_id'),
    readAccountRows(read, accountId, 'conta_destino_id'),
  ]);
  const unique = new Map();
  for (const row of [...origins, ...destinations]) {
    const previous = unique.get(row.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(row)) throw changed();
    unique.set(row.id, row);
  }
  return debtRecognitionPreview({ account, date, balance: dashboard.saldos?.contas.find(row => row.conta_id === accountId)?.saldo_centavos, invoices: invoices.faturas, transactions: [...unique.values()] });
}

/** Projeta um ajuste de saldo; não grava, não cria despesas nem pagamentos. */
export function debtRecognitionPreview({ account, date, balance, invoices, transactions }) {
  if (!account || account.tipo !== 'cartao' || !isoDate(date) || !isoDate(account.data_saldo_inicial) || !integer(balance) || !integer(account.saldo_inicial_centavos) || !Array.isArray(invoices) || !Array.isArray(transactions)) throw changed();
  const rows = transactions.filter(row => row.status === 'confirmado' && (row.conta_origem_id === account.id || row.conta_destino_id === account.id));
  if (rows.some(row => !row.id || !integer(row.versao) || !integer(row.valor_centavos) || row.valor_centavos <= 0 || !isoDate(effectDate(row)))) throw changed();
  const active = rows.filter(row => effectDate(row) <= date);
  const calculated = account.saldo_inicial_centavos + sum(active.filter(row => effectDate(row) > account.data_saldo_inicial).map(row => row.conta_origem_id === account.id ? -row.valor_centavos : row.valor_centavos));
  if (calculated !== balance) throw changed();
  const cardInvoices = invoices.filter(invoice => invoice.conta_id === account.id);
  for (const invoice of cardInvoices) {
    if (!integer(invoice.restante_centavos) || invoice.restante_centavos < 0) throw changed();
    const net = sum(active.filter(row => row.fatura_ref === invoice.fatura_ref).map(row => row.tipo === 'despesa' && row.forma_pagamento === 'credito' ? row.valor_centavos : row.tipo === 'estorno' || row.tipo === 'transferencia' && row.conta_destino_id === account.id ? -row.valor_centavos : 0));
    if (Math.max(0, net) !== invoice.restante_centavos) throw changed();
  }
  // Uma compra confirmada não pode ter desaparecido entre as consultas paginadas.
  if (active.some(row => row.tipo === 'despesa' && row.forma_pagamento === 'credito' && row.fatura_ref && !cardInvoices.some(invoice => invoice.fatura_ref === row.fatura_ref))) throw changed();
  const pending = cardInvoices.filter(invoice => invoice.restante_centavos > 0);
  const total = sum(pending.map(invoice => invoice.restante_centavos));
  const debt = Math.max(0, -balance), difference = Math.max(0, total - debt);
  const historical = active.filter(row => row.importacao_id && effectDate(row) <= account.data_saldo_inicial && row.fatura_ref && (row.tipo === 'despesa' && row.forma_pagamento === 'credito' || row.tipo === 'estorno'));
  const eligible = sum(pending.map(invoice => Math.min(invoice.restante_centavos, Math.max(0, sum(historical.filter(row => row.fatura_ref === invoice.fatura_ref).map(row => row.tipo === 'estorno' ? -row.valor_centavos : row.valor_centavos))))));
  const payments = active.filter(row => row.tipo === 'transferencia' && row.conta_destino_id === account.id && !row.fatura_ref);
  let reason = '';
  if (account.ativa === false) reason = 'Ative o cartão no cadastro antes de reconhecer a dívida.';
  else if (!difference) reason = 'O saldo já contempla as faturas em aberto. Atualize o planejamento para registrar o pagamento.';
  else if (account.data_saldo_inicial >= date) reason = 'O saldo inicial fecha o dia de hoje. O ajuste ficará disponível no próximo dia, após esse fechamento.';
  else if (balance > 0) reason = 'Há crédito registrado neste cartão. Confira os créditos e os pagamentos antes de reconhecer outra dívida.';
  else if (difference > eligible) reason = 'A diferença não está integralmente explicada pelas compras importadas anteriores ao saldo inicial. Confira os pagamentos e o cadastro antes de ajustar.';
  const evidence = {
    account: [account.id, account.versao, account.data_saldo_inicial, account.saldo_inicial_centavos, account.ativa],
    date, balance,
    invoices: cardInvoices.map(invoice => [invoice.fatura_ref, invoice.restante_centavos]).sort((a,b) => a[0].localeCompare(b[0])),
    rows: rows.map(row => [row.id, row.versao, row.tipo, row.valor_centavos, row.conta_origem_id, row.conta_destino_id, effectDate(row), row.fatura_ref, row.importacao_id || '']).sort((a,b) => a[0].localeCompare(b[0])),
  };
  // O mesmo histórico de importação compartilha uma chave entre abas/sessões.
  // A auditoria do backend impede que uma repetição grave outro ajuste.
  const identity = [account.id, account.data_saldo_inicial, account.saldo_inicial_centavos, historical.map(row => [row.id,row.versao]).sort((a,b) => a[0].localeCompare(b[0]))];
  return { account, date, balance, debt, total, difference, eligible, pending, payments, available: !reason, reason, fingerprint: sha256Sync(JSON.stringify(evidence)), requestId: 'reconcile-' + sha256Sync(JSON.stringify(identity)) };
}

export async function buildDebtRecognitionRequest(preview, { confirmed = false, paymentsReviewed = false } = {}, read) {
  if (!confirmed || preview.payments.length && !paymentsReviewed) throw new Error('Confirme que conferiu os pagamentos e que o valor das faturas continua devido ao banco.');
  if (!preview.available) throw new Error(preview.reason);
  const current = await loadDebtRecognition(read, preview.account.id);
  if (!current.available || current.fingerprint !== preview.fingerprint) throw changed();
  return { acao: 'lancamentos.criar', request_id: preview.requestId, dados: {
    tipo: 'ajuste', direcao_ajuste: 'debito', conta_origem_id: preview.account.id,
    descricao: 'Reconhecimento de dívida de faturas importadas anterior ao saldo inicial',
    valor_centavos: preview.difference, forma_pagamento: 'transferencia',
    data_ocorrencia: preview.date, data_pagamento: preview.date,
  } };
}
