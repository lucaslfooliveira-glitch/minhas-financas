const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const money = cents => cents === null || cents === undefined ? '—' : currency.format(cents / 100);
export const percent = value => value === null || value === undefined ? '—' : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value) + '%';
export function today() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = type => parts.find(p => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export const monthNow = () => today().slice(0, 7);
export function shiftMonth(month, delta) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Mês inválido.');
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}
export function isoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T12:00:00Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value && value >= '1900-01-01' && value <= '2200-12-31';
}
export const dateLabel = iso => !iso ? '—' : new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(new Date(iso + 'T12:00:00Z'));
export const monthLabel = month => new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(month + '-01T12:00:00Z'));
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uuid = () => crypto.randomUUID();
export function parseMoney(value, { allowNegative = false } = {}) {
  let s = String(value ?? '').trim().replace(/^R\$\s*/, '');
  let sign = 1;
  if (s.startsWith('-')) { if (!allowNegative) throw new Error('O valor deve ser positivo.'); sign = -1; s = s.slice(1); }
  if (!s) throw new Error('Informe um valor.');
  let normalized;
  if (s.includes(',')) {
    if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,2}$/.test(s)) throw new Error('Use um valor como 1.234,56, com até dois centavos.');
    normalized = s.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(s)) normalized = s.replace(/\./g, '');
  else if (/^\d+(?:\.\d{1,2})?$/.test(s)) normalized = s;
  else throw new Error('Use um valor como 1.234,56.');
  const [whole, decimal = ''] = normalized.split('.');
  const result = sign * (Number(whole) * 100 + Number(decimal.padEnd(2, '0')));
  if (!Number.isSafeInteger(result) || Math.abs(result) > 9000000000000) throw new Error('Valor fora do limite permitido.');
  return result;
}
export function buildTransaction(form, initials) {
  const type = form.tipo || 'despesa';
  const amount = parseMoney(form.valor);
  if (amount <= 0) throw new Error('Informe um valor maior que zero.');
  const date = form.data_ocorrencia || today();
  if (!isoDate(date)) throw new Error('Informe uma data válida.');
  const planned = form.status === 'previsto';
  if (!planned && date > today()) throw new Error('Para uma data futura, escolha “Previsto”.');
  const accounts = initials.contas || [];
  const active = id => accounts.find(a => a.id === id && a.ativa);
  const payload = { tipo: type, valor_centavos: amount, descricao: String(form.descricao || '').trim(), data_ocorrencia: date, status: planned ? 'previsto' : 'confirmado' };
  if (payload.descricao.length > 500) throw new Error('A descrição pode ter até 500 caracteres.');
  if (['receita', 'despesa', 'aporte'].includes(type)) {
    const category = (initials.categorias || []).find(c => c.id === form.categoria_id && c.ativa && c.tipo_movimentacao === type);
    if (!category) throw new Error('Escolha uma categoria válida.');
    payload.categoria_id = category.id;
    if (type === 'despesa') payload.natureza = form.natureza || category.natureza_padrao;
  }
  if (type !== 'receita') {
    if (!active(form.conta_origem_id)) throw new Error('Escolha a conta de origem.');
    payload.conta_origem_id = form.conta_origem_id;
  }
  if (type !== 'despesa') {
    if (!active(form.conta_destino_id)) throw new Error('Escolha a conta de destino.');
    payload.conta_destino_id = form.conta_destino_id;
  }
  if (payload.conta_origem_id === payload.conta_destino_id && payload.conta_origem_id) throw new Error('Escolha contas diferentes na origem e no destino.');
  payload.forma_pagamento = form.forma_pagamento || (['aporte', 'resgate', 'transferencia'].includes(type) ? 'transferencia' : 'pix');
  const source = active(payload.conta_origem_id), destination = active(payload.conta_destino_id);
  const operational = a => a && ['corrente', 'carteira'].includes(a.tipo);
  const saving = a => a && ['reserva', 'investimento'].includes(a.tipo);
  if (type === 'receita' && !operational(destination)) throw new Error('Entradas devem ir para uma conta corrente ou dinheiro.');
  if (type === 'despesa' && !(payload.forma_pagamento === 'credito' ? source?.tipo === 'cartao' : operational(source))) throw new Error('Escolha uma conta compatível com a forma de pagamento.');
  if (type === 'aporte' && (!operational(source) || !saving(destination))) throw new Error('Investimentos devem sair da conta do dia a dia e ir para reserva ou investimento.');
  if (type === 'resgate' && (!saving(source) || !operational(destination))) throw new Error('Resgates devem sair de reserva ou investimento e ir para uma conta do dia a dia.');
  if (type === 'transferencia' && ((operational(source) && saving(destination)) || (saving(source) && operational(destination)))) throw new Error('Para movimentar dinheiro guardado, escolha Investimento ou Resgate.');
  if (type === 'despesa' && payload.forma_pagamento === 'credito') {
    if (active(payload.conta_origem_id).tipo !== 'cartao') throw new Error('Para crédito, escolha uma conta de cartão.');
    if (planned) throw new Error('Use uma recorrência para prever cobranças no cartão. Compras já realizadas devem ser confirmadas.');
    const installments = Number(form.parcelas_total || 1);
    if (!Number.isInteger(installments) || installments < 1 || installments > 120 || installments > amount) throw new Error('Escolha de 1 a 120 parcelas, com pelo menos um centavo cada.');
    payload.parcelas_total = installments;
    if (form.primeira_data_vencimento) {
      if (!isoDate(form.primeira_data_vencimento) || form.primeira_data_vencimento < date) throw new Error('O primeiro vencimento deve ser na data da compra ou depois.');
      payload.primeira_data_vencimento = form.primeira_data_vencimento;
    }
  } else {
    if (form.competencia) payload.competencia = form.competencia;
    if (form.data_vencimento) { if (!isoDate(form.data_vencimento)) throw new Error('Vencimento inválido.'); payload.data_vencimento = form.data_vencimento; }
    if (!planned) payload.data_pagamento = date;
  }
  return payload;
}

export async function buildSnapshotRequest({ accountId, date, value, observation = '' }, client) {
  if (!accountId || !isoDate(date)) throw new Error('Escolha uma conta e uma data válida para a avaliação.');
  if (date > today()) throw new Error('A avaliação deve ser de hoje ou de uma data passada.');
  const cents = parseMoney(value);
  if (String(observation).length > 500) throw new Error('A observação pode ter até 500 caracteres.');
  const result = await client.call({ acao: 'registros.listar', tabela: 'SaldosPatrimoniais', filtros: { conta_id: accountId, data: date }, limite: 2, offset: 0 });
  if (!Array.isArray(result?.registros) || result.total > 1 || result.registros.length > 1) throw new Error('Há avaliações inconsistentes para esta conta e data. Confira o histórico antes de salvar.');
  const old = result.registros[0];
  return { acao: 'entidade.salvar', tabela: 'SaldosPatrimoniais', dados: {
    ...(old ? { id: old.id, versao: old.versao } : {}), conta_id: accountId, data: date,
    valor_centavos: cents, origem: 'manual', observacao: String(observation).trim()
  } };
}
