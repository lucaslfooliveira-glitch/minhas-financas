/**
 * Comparação conservadora entre o staging e lançamentos do schema anterior.
 * Não altera os objetos nem remove compras: devolve apenas alertas de revisão.
 * A garantia transacional de idempotência pertence ao backend batchInsert,
 * acionado somente depois da confirmação do usuário.
 */
const normalize = value => String(value ?? '').normalize('NFD')
  .replace(/[\u0300-\u036f]/gu, '').toUpperCase().replace(/\s+/gu, ' ').trim();
const validDate = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(value + 'T12:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const validMonth = value => typeof value === 'string' && /^\d{4}-(?:0[1-9]|1[0-2])$/u.test(value);
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;

/** Retira somente a identificação estrutural de parcela e estorno. */
function merchant(value) {
  return normalize(value)
    .replace(/^ESTORNO(?:\s+(?:DE|DA))?\s*[:*\-]?\s+/u, '')
    .replace(/(?<![\d/])(?:PARC(?:ELA)?\.?\s*)?\(?(\d{1,2})\s*\/\s*(\d{1,2})\)?(?=\s|$)/gu, (whole, current, total) => {
      const n = Number(current), count = Number(total);
      return count >= 2 && n >= 1 && n <= count ? ' ' : whole;
    })
    .replace(/\s+/gu, ' ').trim();
}

function rowDate(row) {
  const full = validDate(row.data_compra) ? row.data_compra : null;
  const inferred = row.ano_inferido === true && row.data_compra_confirmada !== true;
  if (full && !inferred) return { full, dayMonth: `${full.slice(8, 10)}/${full.slice(5, 7)}`, uncertain: false };
  const suggested = validDate(row.data_compra_sugerida) ? row.data_compra_sugerida : full;
  const short = /^(\d{2})\/(\d{2})(?:\/\d{4})?$/u.exec(String(row.data_texto || ''));
  const dayMonth = short ? `${short[1]}/${short[2]}` : suggested ? `${suggested.slice(8, 10)}/${suggested.slice(5, 7)}` : null;
  return { full: null, dayMonth, uncertain: true };
}

function invoiceContext(record) {
  // Referência antiga: CONTA_ID:AAAA-MM. Usa a última separação por segurança.
  const match = /^(.+):(\d{4}-(?:0[1-9]|1[0-2]))$/u.exec(String(record.fatura_ref || ''));
  return { account: match?.[1] || null, month: match?.[2] || null };
}

function eligibleExisting(record) {
  if (!record || !['despesa', 'estorno'].includes(record.tipo) || record.status === 'cancelado' || !positiveInteger(record.valor_centavos) || !validDate(record.data_ocorrencia)) return false;
  // Uma saída Pix/débito explicitamente identificada não é a compra da fatura.
  // Estorno de crédito usa forma 'transferencia' no backend anterior, portanto
  // só a saída é filtrada pela forma de pagamento.
  if (record.tipo === 'despesa' && record.forma_pagamento && record.forma_pagamento !== 'credito') return false;
  return true;
}

/**
 * @param {Array} rows Itens do parser/revisão, com valor_centavos COM sinal.
 * @param {Array} existing Lancamentos antigos, com valores positivos por tipo.
 * @param {Object} options.cardLinks Mapeamento final do cartão -> ID da conta.
 * @returns {Array<{id_temporario:string,matches:Array}>} Apenas itens semelhantes.
 */
export function compareImportRows(rows, existing, { cardLinks = {} } = {}) {
  if (!Array.isArray(rows) || !Array.isArray(existing)) throw new Error('Informe listas válidas para comparar lançamentos.');
  const records = existing.filter(eligibleExisting).map(record => ({
    record, merchant: merchant(record.descricao), invoice: invoiceContext(record),
    cents: record.tipo === 'estorno' ? -record.valor_centavos : record.valor_centavos,
  }));
  return rows.flatMap(row => {
    if (!row || !Number.isSafeInteger(row.valor_centavos) || !row.valor_centavos) return [];
    const description = merchant(row.descricao_base || row.descricao);
    if (!description) return [];
    const date = rowDate(row);
    if (!date.dayMonth) return [];
    const linkedAccount = Object.prototype.hasOwnProperty.call(cardLinks, row.cartao_final) ? cardLinks[row.cartao_final] : null;
    const installment = positiveInteger(row.parcela_numero) ? row.parcela_numero : null;
    const invoiceMonth = validMonth(row.mes_fatura) ? row.mes_fatura : validDate(row.data_vencimento) ? row.data_vencimento.slice(0, 7) : null;
    const matches = [];
    for (const candidate of records) {
      const { record, invoice, cents } = candidate;
      if (candidate.merchant !== description || cents !== row.valor_centavos) continue;
      const sameDate = date.full ? record.data_ocorrencia === date.full : `${record.data_ocorrencia.slice(8, 10)}/${record.data_ocorrencia.slice(5, 7)}` === date.dayMonth;
      if (!sameDate) continue;
      const existingInstallment = positiveInteger(record.parcela_numero) ? record.parcela_numero : null;
      if (installment && existingInstallment && installment !== existingInstallment) continue;
      // Uma parcela é cobrada em uma fatura específica. Não confundir a compra
      // original repetida no banco com outra parcela de um mês diferente.
      const existingMonth = invoice.month || (validMonth(record.competencia) ? record.competencia : null);
      if (installment && invoiceMonth && existingMonth && invoiceMonth !== existingMonth) continue;
      const movementAccount = record.tipo === 'estorno' ? record.conta_destino_id : record.conta_origem_id;
      const accounts = [movementAccount, invoice.account].filter(Boolean);
      if (linkedAccount && accounts.length && accounts.some(id => id !== linkedAccount)) continue;
      const incomplete = date.uncertain || !linkedAccount || !accounts.length || Boolean(installment && (!existingInstallment || !existingMonth));
      let reason = 'Data, estabelecimento e valor coincidem com um lançamento existente.';
      if (date.uncertain) reason = 'Dia/mês, estabelecimento e valor coincidem; confirme o ano da compra.';
      if (installment && existingInstallment) reason += ` Parcela ${installment} semelhante.`;
      if (!linkedAccount || !accounts.length) reason += ' O vínculo entre final e conta ainda não foi conferido.';
      if (record.status === 'previsto') reason += ' O registro existente é uma previsão: revise para reconciliar.';
      matches.push({ id: record.id || null, motivo: reason, contexto_incompleto: incomplete });
    }
    return matches.length ? [{ id_temporario: row.id_temporario, matches }] : [];
  });
}
