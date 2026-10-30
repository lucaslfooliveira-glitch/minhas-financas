/** Gerado a partir do domínio do backend; demonstração sem persistência. */
/** Finanças pessoais — configuração do backend. Apps Script V8. */
const APP_ = Object.freeze({
  // Preencha com o e-mail da conta Google que será dona da planilha.
  EMAIL_PROPRIETARIO: 'PREENCHA_SEU_EMAIL@gmail.com',
  NOME_PLANILHA: 'Minhas Financas — Banco de Dados',
  VERSAO: '1.3.0',
  SCHEMA: '2',
  FUSO: 'America/Sao_Paulo',
  PROP_PLANILHA: 'FINANCAS_SPREADSHEET_ID',
  // O limite ampliado é reservado à importação; demais ações mantêm 30 mil.
  MAX_PAYLOAD: 250000,
  MAX_IMPORT_ITENS: 200,
  MAX_IMPORT_PROJECOES: 1200,
  MAX_REGISTROS_POR_ABA: 50000,
  LOCK_MS: 20000
});

const COLUNAS_ = Object.freeze({
  Configuracoes: ['chave', 'valor'],
  Contas: ['id', 'nome', 'tipo', 'saldo_inicial_centavos', 'data_saldo_inicial', 'dia_fechamento', 'dia_vencimento', 'limite_centavos', 'ativa', 'criado_em', 'atualizado_em', 'versao'],
  Categorias: ['id', 'nome', 'tipo_movimentacao', 'grupo_orcamento', 'natureza_padrao', 'cor', 'ativa', 'criado_em', 'atualizado_em', 'versao'],
  Lancamentos: ['id', 'tipo', 'descricao', 'valor_centavos', 'categoria_id', 'natureza', 'forma_pagamento', 'conta_origem_id', 'conta_destino_id', 'meta_id', 'data_ocorrencia', 'competencia', 'data_vencimento', 'data_pagamento', 'compra_id', 'parcela_numero', 'parcelas_total', 'fatura_ref', 'status', 'recorrencia_id', 'recorrencia_ref', 'estorno_de_id', 'direcao_ajuste', 'request_id', 'criado_em', 'atualizado_em', 'versao', 'cartao_final', 'id_parcelamento', 'importacao_hash', 'importacao_chave', 'importacao_id', 'criterio_mes', 'grupo_orcamento_importacao', 'credito_importado', 'valor_estimado', 'mes_fatura'],
  Orcamentos: ['id', 'mes', 'escopo', 'referencia_id', 'renda_base_centavos', 'percentual', 'limite_centavos', 'criado_em', 'atualizado_em', 'versao'],
  Recorrencias: ['id', 'descricao', 'tipo', 'categoria_id', 'natureza', 'conta_origem_id', 'conta_destino_id', 'forma_pagamento', 'valor_previsto_centavos', 'frequencia', 'dia_vencimento', 'data_inicio', 'data_fim', 'ativa', 'criado_em', 'atualizado_em', 'versao'],
  Metas: ['id', 'nome', 'tipo', 'valor_alvo_centavos', 'data_alvo', 'conta_id', 'valor_alocado_centavos', 'ativa', 'criado_em', 'atualizado_em', 'versao'],
  SaldosPatrimoniais: ['id', 'data', 'conta_id', 'valor_centavos', 'origem', 'observacao', 'criado_em', 'atualizado_em', 'versao'],
  Auditoria: ['id', 'instante', 'operacao', 'entidade', 'entidade_id', 'request_id', 'versao', 'payload_hash', 'resposta_json'],
  Cartoes: ['id', 'final', 'apelido', 'modalidade', 'responsavel', 'conta_id', 'ativa', 'criado_em', 'atualizado_em', 'versao'],
  Regras_Categorizacao: ['id', 'estabelecimento', 'categoria_id', 'grupo_orcamento', 'ativa', 'criado_em', 'atualizado_em', 'versao'],
  Parcelamentos: ['id', 'cartao_final', 'descricao_base', 'data_compra', 'parcelas_total', 'valor_parcela_centavos', 'mes_primeira_fatura', 'conta_id', 'criado_em', 'atualizado_em', 'versao']
});

// Descrição imutável do único schema anterior reconhecido para migração.
// Nunca inferir um cabeçalho por prefixo: colunas renomeadas precisam ser corrigidas.
const COLUNAS_SCHEMA_1_ = Object.freeze(Object.keys(COLUNAS_).filter(function (n) {
  return ['Cartoes', 'Regras_Categorizacao', 'Parcelamentos'].indexOf(n) < 0;
}).reduce(function (mapa, nome) {
  mapa[nome] = Object.freeze(nome === 'Lancamentos' ? COLUNAS_[nome].slice(0, 27) : COLUNAS_[nome].slice());
  return mapa;
}, {}));

const TABELAS_EDITAVEIS_ = Object.freeze(['Contas', 'Categorias', 'Orcamentos', 'Recorrencias', 'Metas', 'SaldosPatrimoniais']);

function configuracoesPadrao_() {
  return [
    ['moeda', 'BRL'], ['fuso', APP_.FUSO], ['versao_schema', APP_.SCHEMA],
    ['percentual_necessidades', '50'], ['percentual_desejos', '30'], ['percentual_metas', '20'],
    ['horizonte_meses', '12'], ['conta_padrao_id', '']
  ].map(function (x) { return { chave: x[0], valor: x[1] }; });
}

function categoriasPadrao_(instante) {
  const lista = [
    ['cat_salario', 'Salário e trabalho', 'receita', '', '', '#16a34a'],
    ['cat_outras_receitas', 'Outras receitas', 'receita', '', '', '#22c55e'],
    ['cat_moradia', 'Moradia', 'despesa', 'necessidades', 'fixa', '#2563eb'],
    ['cat_alimentacao', 'Alimentação', 'despesa', 'necessidades', 'variavel', '#0284c7'],
    ['cat_transporte', 'Transporte', 'despesa', 'necessidades', 'variavel', '#0891b2'],
    ['cat_saude', 'Saúde', 'despesa', 'necessidades', 'variavel', '#0d9488'],
    ['cat_lazer', 'Lazer', 'despesa', 'desejos', 'variavel', '#9333ea'],
    ['cat_assinaturas', 'Assinaturas', 'despesa', 'desejos', 'fixa', '#c026d3'],
    ['cat_juros', 'Juros e tarifas', 'despesa', 'necessidades', 'variavel', '#dc2626'],
    ['cat_reserva', 'Reserva de emergência', 'aporte', 'metas', '', '#ea580c'],
    ['cat_investimentos', 'Investimentos', 'aporte', 'metas', '', '#ca8a04']
  ];
  return lista.map(function (x) {
    return { id: x[0], nome: x[1], tipo_movimentacao: x[2], grupo_orcamento: x[3], natureza_padrao: x[4], cor: x[5], ativa: true, criado_em: instante, atualizado_em: instante, versao: 1 };
  });
}


/** Regras puras de domínio. Valores monetários em centavos; datas civis ISO. */
function erro_(code, message, details) {
  var e = new Error(message); e.code = code;
  if (details !== undefined) e.details = details;
  throw e;
}
function domObj_(v, allowed) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) erro_('VALIDACAO', 'Informe um objeto de dados.');
  Object.keys(v).forEach(function(k) { if (allowed.indexOf(k) < 0) erro_('CAMPO_INVALIDO', 'Campo não permitido: ' + k); });
}
function domTexto_(v, name, required, max) {
  if (v === undefined || v === null || v === '') { if (required) erro_('VALIDACAO', 'Campo obrigatório: ' + name); return ''; }
  if (typeof v !== 'string' || v.length > (max || 200)) erro_('VALIDACAO', 'Texto inválido: ' + name);
  var s = v.trim(); if (required && !s) erro_('VALIDACAO', 'Campo obrigatório: ' + name); return s;
}
function domId_(v, name, required) {
  var s = domTexto_(v, name, required, 120);
  if (s && !/^[A-Za-z0-9_-]+$/.test(s)) erro_('VALIDACAO', 'Identificador inválido: ' + name);
  return s;
}
function domInt_(v, name, min, max) {
  if (!Number.isSafeInteger(v) || v < min || v > (max === undefined ? 9000000000000 : max)) erro_('VALIDACAO', 'Número inteiro fora do intervalo: ' + name);
  return v;
}
function domEnum_(v, name, values, fallback) {
  var x = v === undefined || v === null || v === '' ? fallback : v;
  if (values.indexOf(x) < 0) erro_('VALIDACAO', 'Valor inválido: ' + name, {permitidos: values});
  return x;
}
function domBool_(v, fallback) {
  if (v === undefined) return fallback;
  if (typeof v !== 'boolean') erro_('VALIDACAO', 'O campo ativa deve ser booleano.');
  return v;
}
function domData_(v, name, optional) {
  if ((v === '' || v === undefined || v === null) && optional) return '';
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) erro_('VALIDACAO', 'Data ISO inválida: ' + name);
  var d = new Date(v + 'T12:00:00Z');
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== v || v < '1900-01-01' || v > '2200-12-31') erro_('VALIDACAO', 'Data inexistente ou fora do intervalo: ' + name);
  return v;
}
function domMes_(v) {
  if (typeof v !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v) || v < '1900-01' || v > '2200-12') erro_('VALIDACAO', 'Competência inválida; use YYYY-MM.');
  return v;
}
function domSomarMes_(mes, n) {
  var p = mes.split('-').map(Number), d = new Date(Date.UTC(p[0], p[1] - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
function domDiaMes_(mes, dia) {
  var p = mes.split('-').map(Number), last = new Date(Date.UTC(p[0], p[1], 0)).getUTCDate();
  return mes + '-' + String(Math.min(dia, last)).padStart(2, '0');
}
function domDifMes_(a, b) { return (Number(b.slice(0,4)) - Number(a.slice(0,4))) * 12 + Number(b.slice(5,7)) - Number(a.slice(5,7)); }
function domRef_(db, table, id, active) {
  var row = (db[table] || []).find(function(x) { return x.id === id; });
  if (!row || (active && row.ativa === false)) erro_('REFERENCIA_INVALIDA', 'Referência inexistente ou inativa em ' + table + ': ' + id);
  return row;
}
function domMeta_(row, old, env) {
  row.id = old ? old.id : (row.id || env.uuid());
  row.criado_em = old ? old.criado_em : env.now;
  row.atualizado_em = env.now; row.versao = old ? Number(old.versao) + 1 : 1;
  return row;
}
function domTipoConta_(a, types, name) {
  if (types.indexOf(a.tipo) < 0) erro_('CONTA_INCOMPATIVEL', 'Tipo de conta incompatível: ' + name);
}
function domDisponivel_(a) { return a && ['corrente','carteira'].indexOf(a.tipo) >= 0; }
function domPoupanca_(a) { return a && ['investimento','reserva'].indexOf(a.tipo) >= 0; }
function domTemUsoConta_(db, id) {
  return (db.Lancamentos || []).some(function(l) { return l.conta_origem_id === id || l.conta_destino_id === id; }) || (db.SaldosPatrimoniais || []).some(function(s) { return s.conta_id === id; });
}

/** Cria ou valida uma entidade editável. Controle otimista é também feito na API. */
function normalizarEntidade_(tabela, dados, db, env, anterior) {
  var fields = {
    Contas: ['nome','tipo','saldo_inicial_centavos','data_saldo_inicial','dia_fechamento','dia_vencimento','limite_centavos','ativa'],
    Categorias: ['nome','tipo_movimentacao','grupo_orcamento','natureza_padrao','cor','ativa'],
    Orcamentos: ['mes','escopo','referencia_id','renda_base_centavos','percentual','limite_centavos'],
    Recorrencias: ['descricao','tipo','categoria_id','natureza','conta_origem_id','conta_destino_id','forma_pagamento','valor_previsto_centavos','frequencia','dia_vencimento','data_inicio','data_fim','ativa'],
    Metas: ['nome','tipo','valor_alvo_centavos','data_alvo','conta_id','valor_alocado_centavos','ativa'],
    SaldosPatrimoniais: ['data','conta_id','valor_centavos','origem','observacao']
  };
  if (!fields[tabela]) erro_('TABELA_INVALIDA', 'Esta entidade não pode ser editada.');
  domObj_(dados, fields[tabela].concat(['id','versao']));
  if (anterior && dados.id && dados.id !== anterior.id) erro_('VALIDACAO', 'O id não pode ser alterado.');
  var v = Object.assign({}, anterior || {}, dados), r = {id: domId_(v.id, 'id', false)};
  if (tabela === 'Contas') {
    r.nome = domTexto_(v.nome, 'nome', true, 100);
    r.tipo = domEnum_(v.tipo, 'tipo', ['corrente','carteira','investimento','reserva','cartao','divida']);
    r.saldo_inicial_centavos = domInt_(v.saldo_inicial_centavos === undefined ? 0 : v.saldo_inicial_centavos, 'saldo_inicial_centavos', -9000000000000);
    r.data_saldo_inicial = domData_(v.data_saldo_inicial, 'data_saldo_inicial');
    if (r.data_saldo_inicial > env.today) erro_('VALIDACAO', 'O saldo inicial deve ser de hoje ou de uma data passada.');
    if (['cartao','divida'].indexOf(r.tipo) >= 0 && r.saldo_inicial_centavos > 0) erro_('VALIDACAO', 'Saldo inicial de dívida/cartão deve ser zero ou negativo.');
    if (['investimento','reserva'].indexOf(r.tipo) >= 0 && r.saldo_inicial_centavos < 0) erro_('VALIDACAO', 'Saldo de investimento/reserva não pode ser negativo.');
    r.dia_fechamento = r.tipo === 'cartao' ? domInt_(v.dia_fechamento, 'dia_fechamento', 1, 31) : '';
    r.dia_vencimento = r.tipo === 'cartao' ? domInt_(v.dia_vencimento, 'dia_vencimento', 1, 31) : '';
    r.limite_centavos = r.tipo === 'cartao' ? domInt_(v.limite_centavos === undefined ? 0 : v.limite_centavos, 'limite_centavos', 0) : '';
    r.ativa = domBool_(v.ativa, true);
    if (anterior && domTemUsoConta_(db, anterior.id)) ['tipo','saldo_inicial_centavos','data_saldo_inicial'].forEach(function(k) { if (r[k] !== anterior[k]) erro_('HISTORICO_PROTEGIDO', 'Conta com histórico: não altere ' + k + '. Use ajuste ou outra conta.'); });
  } else if (tabela === 'Categorias') {
    r.nome = domTexto_(v.nome, 'nome', true, 100);
    r.tipo_movimentacao = domEnum_(v.tipo_movimentacao, 'tipo_movimentacao', ['receita','despesa','aporte']);
    r.grupo_orcamento = r.tipo_movimentacao === 'receita' ? '' : domEnum_(v.grupo_orcamento, 'grupo_orcamento', ['necessidades','desejos','metas'], r.tipo_movimentacao === 'aporte' ? 'metas' : undefined);
    if (r.tipo_movimentacao === 'aporte' && r.grupo_orcamento !== 'metas') erro_('VALIDACAO', 'Categorias de aporte pertencem ao grupo metas.');
    r.natureza_padrao = r.tipo_movimentacao === 'despesa' ? domEnum_(v.natureza_padrao, 'natureza_padrao', ['fixa','variavel'], 'variavel') : '';
    r.cor = domTexto_(v.cor || '#64748B', 'cor', true, 7);
    if (!/^#[0-9A-Fa-f]{6}$/.test(r.cor)) erro_('VALIDACAO', 'Cor deve ser hexadecimal, como #2563EB.');
    r.ativa = domBool_(v.ativa, true);
    if (anterior && (db.Lancamentos || []).some(function(l) { return l.categoria_id === anterior.id; })) ['tipo_movimentacao','grupo_orcamento'].forEach(function(k) { if (r[k] !== anterior[k]) erro_('HISTORICO_PROTEGIDO', 'Categoria com histórico: não altere ' + k + '. Crie outra categoria.'); });
  } else if (tabela === 'Orcamentos') {
    r.mes = domMes_(v.mes); r.escopo = domEnum_(v.escopo, 'escopo', ['geral','grupo','categoria']);
    r.referencia_id = r.escopo === 'geral' ? '' : domTexto_(v.referencia_id, 'referencia_id', true, 120);
    r.renda_base_centavos = r.escopo === 'geral' ? domInt_(v.renda_base_centavos, 'renda_base_centavos', 0) : 0;
    r.percentual = v.percentual === '' || v.percentual === null || v.percentual === undefined ? '' : v.percentual;
    if (r.percentual !== '' && (typeof r.percentual !== 'number' || !Number.isFinite(r.percentual) || r.percentual < 0 || r.percentual > 100)) erro_('VALIDACAO', 'Percentual deve estar entre 0 e 100.');
    r.limite_centavos = r.escopo === 'geral' || r.percentual !== '' ? 0 : domInt_(v.limite_centavos, 'limite_centavos', 0);
    if (r.escopo !== 'grupo' && r.percentual !== '') erro_('VALIDACAO', 'Percentual é permitido apenas em orçamento de grupo.');
    if (r.escopo === 'grupo') domEnum_(r.referencia_id, 'referencia_id', ['necessidades','desejos','metas']);
    if (r.escopo === 'categoria' && domRef_(db, 'Categorias', r.referencia_id, true).tipo_movimentacao === 'receita') erro_('VALIDACAO', 'Orçamento por categoria deve corresponder a despesa ou aporte.');
    if ((db.Orcamentos || []).some(function(x) { return x.id !== r.id && x.mes === r.mes && x.escopo === r.escopo && x.referencia_id === r.referencia_id; })) erro_('DUPLICADO', 'Já existe orçamento para este mês e referência. Atualize pelo id.');
  } else if (tabela === 'Recorrencias') {
    r.descricao = domTexto_(v.descricao, 'descricao', true, 300);
    r.tipo = domEnum_(v.tipo, 'tipo', ['receita','despesa','aporte','resgate','transferencia']);
    r.categoria_id = domId_(v.categoria_id, 'categoria_id', false); r.natureza = v.natureza || '';
    r.conta_origem_id = domId_(v.conta_origem_id, 'conta_origem_id', false); r.conta_destino_id = domId_(v.conta_destino_id, 'conta_destino_id', false);
    r.forma_pagamento = domEnum_(v.forma_pagamento, 'forma_pagamento', ['pix','debito','credito','dinheiro','transferencia'], 'pix');
    r.valor_previsto_centavos = domInt_(v.valor_previsto_centavos, 'valor_previsto_centavos', 1);
    r.frequencia = domEnum_(v.frequencia, 'frequencia', ['mensal'], 'mensal');
    r.dia_vencimento = domInt_(v.dia_vencimento, 'dia_vencimento', 1, 31);
    r.data_inicio = domData_(v.data_inicio, 'data_inicio'); r.data_fim = domData_(v.data_fim, 'data_fim', true);
    if (r.data_fim && r.data_fim < r.data_inicio) erro_('VALIDACAO', 'Fim da recorrência deve ser posterior ao início.');
    r.ativa = domBool_(v.ativa, true);
    domValidarDirecao_(r, db, r.ativa);
    if (r.tipo === 'despesa') { var cat = domRef_(db, 'Categorias', r.categoria_id, r.ativa); r.natureza = domEnum_(r.natureza, 'natureza', ['fixa','variavel'], cat.natureza_padrao || 'variavel'); }
    else r.natureza = '';
  } else if (tabela === 'Metas') {
    r.nome = domTexto_(v.nome, 'nome', true, 100); r.tipo = domEnum_(v.tipo, 'tipo', ['reserva_emergencia','objetivo','aposentadoria'], 'objetivo');
    r.valor_alvo_centavos = domInt_(v.valor_alvo_centavos, 'valor_alvo_centavos', 1);
    r.data_alvo = domData_(v.data_alvo, 'data_alvo', true); r.conta_id = domId_(v.conta_id, 'conta_id', true);
    r.ativa = domBool_(v.ativa, true);
    domTipoConta_(domRef_(db, 'Contas', r.conta_id, r.ativa), ['reserva','investimento'], 'conta_id');
    r.valor_alocado_centavos = domInt_(v.valor_alocado_centavos === undefined ? 0 : v.valor_alocado_centavos, 'valor_alocado_centavos', 0);
    var allocated = (db.Metas || []).filter(function(m) { return m.id !== r.id && m.ativa && m.conta_id === r.conta_id; }).reduce(function(s,m) { return s + m.valor_alocado_centavos; }, 0) + (r.ativa ? r.valor_alocado_centavos : 0);
    if (r.ativa && allocated > Math.max(0, domSaldoConta_(db, r.conta_id, env.today))) erro_('ALOCACAO_EXCESSIVA', 'As metas não podem reservar mais que o saldo atual da conta.');
  } else if (tabela === 'SaldosPatrimoniais') {
    r.data = domData_(v.data, 'data'); r.conta_id = domId_(v.conta_id, 'conta_id', true);
    var a = domRef_(db, 'Contas', r.conta_id, true); domTipoConta_(a, ['investimento','reserva'], 'conta_id');
    if (r.data > env.today || r.data < a.data_saldo_inicial) erro_('VALIDACAO', 'Avaliação deve estar entre a data do saldo inicial e hoje.');
    r.valor_centavos = domInt_(v.valor_centavos, 'valor_centavos', 0);
    r.origem = domEnum_(v.origem, 'origem', ['manual'], 'manual'); r.observacao = domTexto_(v.observacao, 'observacao', false, 500);
    if ((db.SaldosPatrimoniais || []).some(function(x) { return x.id !== r.id && x.data === r.data && x.conta_id === r.conta_id; })) erro_('DUPLICADO', 'Já existe avaliação desta conta nesta data.');
  }
  return domMeta_(r, anterior, env);
}

/** Valida origem, destino, categoria e meio de pagamento sem efetuar escrita. */
function domValidarDirecao_(r, db, active) {
  var o = r.conta_origem_id ? domRef_(db, 'Contas', r.conta_origem_id, active) : null;
  var d = r.conta_destino_id ? domRef_(db, 'Contas', r.conta_destino_id, active) : null;
  if (o && d && o.id === d.id) erro_('VALIDACAO', 'Origem e destino devem ser contas diferentes.');
  if (r.tipo === 'receita') {
    if (o || !d || !domDisponivel_(d)) erro_('CONTA_INCOMPATIVEL', 'Receita exige somente uma conta de destino corrente ou carteira.');
  } else if (r.tipo === 'despesa') {
    if (!o || d || (!domDisponivel_(o) && o.tipo !== 'cartao')) erro_('CONTA_INCOMPATIVEL', 'Despesa exige somente origem corrente, carteira ou cartão.');
    if ((o.tipo === 'cartao') !== (r.forma_pagamento === 'credito')) erro_('VALIDACAO', 'Pagamento crédito exige uma conta cartão; cartão exige crédito.');
  } else if (r.tipo === 'aporte') {
    if (!domDisponivel_(o) || !domPoupanca_(d)) erro_('CONTA_INCOMPATIVEL', 'Aporte deve sair de corrente/carteira para investimento/reserva.');
  } else if (r.tipo === 'resgate') {
    if (!domPoupanca_(o) || !domDisponivel_(d)) erro_('CONTA_INCOMPATIVEL', 'Resgate deve sair de investimento/reserva para corrente/carteira.');
  } else if (r.tipo === 'transferencia') {
    if (!o || !d) erro_('VALIDACAO', 'Transferência exige origem e destino.');
    if ((domDisponivel_(o) && domPoupanca_(d)) || (domPoupanca_(o) && domDisponivel_(d))) erro_('VALIDACAO', 'Use aporte ou resgate para movimentar dinheiro guardado.');
    var liabilityO = ['cartao','divida'].indexOf(o.tipo) >= 0, liabilityD = ['cartao','divida'].indexOf(d.tipo) >= 0;
    if (!((domDisponivel_(o) && domDisponivel_(d)) || (domPoupanca_(o) && domPoupanca_(d)) || (domDisponivel_(o) && liabilityD) || (liabilityO && domDisponivel_(d)))) erro_('CONTA_INCOMPATIVEL', 'Transferência entre estes tipos de conta não é suportada.');
  } else if (r.tipo === 'ajuste') {
    if (r.direcao_ajuste === 'credito' ? (!d || !!o) : (!o || !!d)) erro_('VALIDACAO', 'Ajuste crédito exige só destino; débito exige só origem.');
  }
  if (['receita','despesa','aporte'].indexOf(r.tipo) >= 0) {
    var c = domRef_(db, 'Categorias', r.categoria_id, active);
    if (c.tipo_movimentacao !== r.tipo) erro_('CATEGORIA_INCOMPATIVEL', 'Categoria não corresponde ao tipo de lançamento.');
  } else if (r.tipo !== 'estorno' && r.categoria_id) erro_('VALIDACAO', 'Este tipo não recebe categoria.');
  if (r.tipo !== 'despesa' && r.forma_pagamento === 'credito') erro_('VALIDACAO', 'Crédito é reservado a despesas com cartão.');
  if (r.meta_id) {
    var m = domRef_(db, 'Metas', r.meta_id, active);
    if (r.tipo !== 'aporte' || m.conta_id !== r.conta_destino_id) erro_('VALIDACAO', 'Meta só pode vincular aporte para a conta da meta.');
  }
}

function domPrimeiroVencimento_(account, occurrence) {
  var closeMonth = occurrence.slice(0, 7);
  if (occurrence >= domDiaMes_(closeMonth, account.dia_fechamento)) closeMonth = domSomarMes_(closeMonth, 1);
  var close = domDiaMes_(closeMonth, account.dia_fechamento), due = domDiaMes_(closeMonth, account.dia_vencimento);
  if (due <= close) due = domDiaMes_(domSomarMes_(closeMonth, 1), account.dia_vencimento);
  return due;
}
function domBlankLancamento_() {
  var r = {};
  ['id','tipo','descricao','valor_centavos','categoria_id','natureza','forma_pagamento','conta_origem_id','conta_destino_id','meta_id','data_ocorrencia','competencia','data_vencimento','data_pagamento','compra_id','parcela_numero','parcelas_total','fatura_ref','status','recorrencia_id','recorrencia_ref','estorno_de_id','direcao_ajuste','request_id','criado_em','atualizado_em','versao'].forEach(function(k) { r[k] = ''; });
  return r;
}
function domVerificarDataContas_(r, db) {
  if (r.status !== 'confirmado') return;
  var date = ((r.tipo === 'despesa' && r.forma_pagamento === 'credito') || (r.tipo === 'estorno' && domRef_(db, 'Contas', r.conta_destino_id, false).tipo === 'cartao')) ? r.data_ocorrencia : r.data_pagamento;
  [r.conta_origem_id, r.conta_destino_id].filter(Boolean).forEach(function(id) {
    if (date <= domRef_(db, 'Contas', id, false).data_saldo_inicial) erro_('DATA_ANTERIOR_SALDO', 'Movimentação deve ocorrer após o saldo inicial de cada conta envolvida.');
  });
}
function domValidarFaturaPagamento_(r, db) {
  if (r.tipo !== 'transferencia') return;
  var destination = domRef_(db, 'Contas', r.conta_destino_id, true);
  function verificarDividaReal() {
    if (r.status !== 'confirmado') return;
    // O histórico importado antes da âncora já estava contido no saldo de
    // abertura. Uma fatura nominalmente aberta não autoriza pagar novamente
    // uma dívida que foi quitada por transferência sem referência de fatura.
    var validationDb = r.id ? Object.assign({}, db, { Lancamentos: (db.Lancamentos || []).filter(function (x) { return x.id !== r.id; }) }) : db;
    var debt = Math.max(0, -domSaldoConta_(validationDb, destination.id, r.data_pagamento || r.data_ocorrencia));
    if (r.valor_centavos > debt) erro_('PAGAMENTO_EXCESSIVO', 'Pagamento supera a dívida real do cartão nesta data. Concilie o saldo de abertura e os pagamentos antes de quitar a fatura.', { divida_cartao_centavos: debt });
  }
  if (!r.fatura_ref) {
    if (destination.tipo !== 'cartao') return;
    var openingPaid=(db.Lancamentos || []).filter(function(x) { return x.status==='confirmado' && x.tipo==='transferencia' && x.conta_destino_id===destination.id && !x.fatura_ref && x.id!==r.id; }).reduce(function(s,x) { return s+x.valor_centavos; },0);
    var openingRemaining=Math.max(0,-destination.saldo_inicial_centavos-openingPaid);
    if (r.valor_centavos>openingRemaining) erro_('FATURA_OBRIGATORIA', 'Informe fatura_ref para pagar compras registradas. Sem referência só é possível pagar a dívida de abertura.', {divida_abertura_restante_centavos:openingRemaining});
    verificarDividaReal();
    return;
  }
  if (r.tipo !== 'transferencia' || destination.tipo !== 'cartao' || !domDisponivel_(domRef_(db, 'Contas', r.conta_origem_id, true))) erro_('VALIDACAO', 'Fatura só pode ser paga por transferência de corrente/carteira para cartão.');
  if (!new RegExp('^' + destination.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':\\d{4}-(0[1-9]|1[0-2])$').test(r.fatura_ref)) erro_('VALIDACAO', 'Referência de fatura inválida.');
  if (r.status !== 'confirmado') return;
  var net = 0, paid = 0;
  (db.Lancamentos || []).filter(function(x) { return x.status === 'confirmado' && x.fatura_ref === r.fatura_ref && x.id !== r.id; }).forEach(function(x) {
    if (x.tipo === 'despesa') net += x.valor_centavos;
    if (x.tipo === 'estorno') net -= x.valor_centavos;
    if (x.tipo === 'transferencia') paid += x.valor_centavos;
  });
  if (r.valor_centavos > Math.max(0, net - paid)) erro_('PAGAMENTO_EXCESSIVO', 'Pagamento supera o saldo confirmado desta fatura.', {saldo_centavos: Math.max(0,net-paid)});
  verificarDividaReal();
}

/** Entrada principal de criação. Um valor total gera uma ou várias parcelas. */
function criarLancamentos_(dados, db, env) {
  domObj_(dados, ['tipo','descricao','valor_centavos','categoria_id','natureza','forma_pagamento','conta_origem_id','conta_destino_id','meta_id','data_ocorrencia','competencia','data_vencimento','data_pagamento','parcelas_total','primeira_data_vencimento','fatura_ref','status','estorno_de_id','direcao_ajuste']);
  return domCriarLancamentos_(dados, db, env, false);
}
function domCriarLancamentos_(dados, db, env, allowPlannedCredit) {
  var r = domBlankLancamento_();
  r.tipo = domEnum_(dados.tipo, 'tipo', ['receita','despesa','aporte','resgate','transferencia','ajuste','estorno']);
  r.descricao = domTexto_(dados.descricao, 'descricao', false, 500);
  r.valor_centavos = domInt_(dados.valor_centavos, 'valor_centavos', 1);
  r.categoria_id = domId_(dados.categoria_id, 'categoria_id', false);
  r.conta_origem_id = domId_(dados.conta_origem_id, 'conta_origem_id', false);
  r.conta_destino_id = domId_(dados.conta_destino_id, 'conta_destino_id', false);
  r.meta_id = domId_(dados.meta_id, 'meta_id', false);
  r.forma_pagamento = domEnum_(dados.forma_pagamento, 'forma_pagamento', ['pix','debito','credito','dinheiro','transferencia'], ['aporte','resgate','transferencia','ajuste'].indexOf(r.tipo) >= 0 ? 'transferencia' : 'pix');
  r.status = domEnum_(dados.status, 'status', ['previsto','confirmado'], 'confirmado');
  r.data_ocorrencia = domData_(dados.data_ocorrencia || env.today, 'data_ocorrencia');
  r.data_vencimento = domData_(dados.data_vencimento || r.data_ocorrencia, 'data_vencimento');
  r.competencia = domMes_(dados.competencia || r.data_ocorrencia.slice(0, 7));
  r.direcao_ajuste = r.tipo === 'ajuste' ? domEnum_(dados.direcao_ajuste, 'direcao_ajuste', ['credito','debito']) : '';
  if (r.tipo !== 'ajuste' && dados.direcao_ajuste) erro_('VALIDACAO', 'direcao_ajuste só se aplica a ajustes.');
  r.fatura_ref = domTexto_(dados.fatura_ref, 'fatura_ref', false, 150);
  r.estorno_de_id = domId_(dados.estorno_de_id, 'estorno_de_id', false);
  if (r.tipo !== 'estorno' && r.estorno_de_id) erro_('VALIDACAO', 'estorno_de_id só se aplica a estornos.');
  if (r.tipo === 'estorno') domPrepararEstorno_(r, dados, db, env);
  else domValidarDirecao_(r, db, true);
  if (r.tipo === 'despesa') {
    var c = domRef_(db, 'Categorias', r.categoria_id, true);
    r.natureza = domEnum_(dados.natureza, 'natureza', ['fixa','variavel'], c.natureza_padrao || 'variavel');
  } else if (r.tipo !== 'estorno' && dados.natureza) erro_('VALIDACAO', 'Natureza se aplica apenas a despesas.');
  var credit = r.tipo === 'despesa' && r.forma_pagamento === 'credito';
  var cardRefund = r.tipo === 'estorno' && domRef_(db, 'Contas', r.conta_destino_id, false).tipo === 'cartao';
  if (credit && r.status === 'previsto' && !allowPlannedCredit) erro_('VALIDACAO', 'Previsão de crédito deve ser gerada por recorrência. Compra já realizada deve ser confirmada.');
  if ((credit || cardRefund) && dados.data_pagamento) erro_('VALIDACAO', 'Compra/estorno de cartão não movimenta a conta bancária; registre o pagamento da fatura separadamente.');
  if (r.status === 'previsto' && dados.data_pagamento) erro_('VALIDACAO', 'Previsão não pode ter data de pagamento.');
  r.data_pagamento = r.status === 'confirmado' && !credit && !cardRefund ? domData_(dados.data_pagamento || r.data_ocorrencia, 'data_pagamento') : '';
  if (r.status === 'confirmado' && (r.data_ocorrencia > env.today || (r.data_pagamento && r.data_pagamento > env.today))) erro_('DATA_FUTURA', 'Movimentações futuras devem ser previsões.');
  if (r.data_pagamento && r.data_pagamento < r.data_ocorrencia) erro_('VALIDACAO', 'Pagamento não pode anteceder a ocorrência.');
  var n = domInt_(dados.parcelas_total === undefined ? 1 : dados.parcelas_total, 'parcelas_total', 1, 120);
  if (n > 1 && !credit) erro_('VALIDACAO', 'Parcelamento está disponível apenas para despesas de cartão.');
  if (n > r.valor_centavos) erro_('VALIDACAO', 'Cada parcela deve ter ao menos um centavo.');
  if (!credit && dados.primeira_data_vencimento) erro_('VALIDACAO', 'primeira_data_vencimento só se aplica a compras com cartão.');
  if (credit) {
    var card = domRef_(db, 'Contas', r.conta_origem_id, true);
    if (dados.primeira_data_vencimento && dados.data_vencimento && dados.primeira_data_vencimento !== dados.data_vencimento) erro_('VALIDACAO','Informe uma única primeira data de vencimento, sem valores conflitantes.');
    var due = domData_(dados.primeira_data_vencimento || dados.data_vencimento || domPrimeiroVencimento_(card, r.data_ocorrencia), 'primeira_data_vencimento');
    if (due < r.data_ocorrencia) erro_('VALIDACAO', 'Vencimento não pode anteceder a compra.');
    if (dados.competencia && dados.competencia !== due.slice(0,7)) erro_('VALIDACAO', 'Competência de cartão é o mês do vencimento da parcela.');
    r.data_vencimento = due; r.competencia = due.slice(0,7); r.compra_id = env.uuid();
    if (dados.fatura_ref) erro_('VALIDACAO', 'A fatura da compra é calculada automaticamente. Use a primeira data de vencimento para corrigir o ciclo.');
  } else if (r.fatura_ref && r.tipo !== 'transferencia' && r.tipo !== 'estorno') erro_('VALIDACAO', 'fatura_ref só se aplica a pagamento de fatura ou estorno de cartão.');
  domValidarFaturaPagamento_(r, db);
  var total = r.valor_centavos, base = Math.floor(total / n), firstMonth = r.data_vencimento.slice(0,7), day = credit && !dados.primeira_data_vencimento && !dados.data_vencimento ? card.dia_vencimento : Number(r.data_vencimento.slice(8,10));
  var rows = [];
  for (var i = 0; i < n; i++) {
    var row = Object.assign({},r); row.id = env.uuid(); row.parcela_numero = i + 1; row.parcelas_total = n;
    row.valor_centavos = base + (i === n - 1 ? total - base*n : 0);
    if (credit) {
      row.data_vencimento = domDiaMes_(domSomarMes_(firstMonth, i), day); row.competencia = row.data_vencimento.slice(0,7); row.fatura_ref = row.conta_origem_id + ':' + row.competencia;
      if ((db.Lancamentos || []).some(function(x) { return x.tipo==='despesa' && x.status!=='cancelado' && x.fatura_ref===row.fatura_ref && x.data_vencimento!==row.data_vencimento; })) erro_('VENCIMENTO_FATURA_DIVERGENTE','Compras da mesma fatura devem ter o mesmo vencimento.',{fatura_ref:row.fatura_ref});
    }
    row.request_id = env.requestId || ''; domVerificarDataContas_(row,db);
    rows.push(domMeta_(row,null,env));
  }
  return rows;
}
function domPrepararEstorno_(r, dados, db, env) {
  if (r.status !== 'confirmado') erro_('VALIDACAO', 'Estorno deve ser confirmado.');
  var old = domRef_(db, 'Lancamentos', r.estorno_de_id, false);
  if (old.tipo !== 'despesa' || old.status !== 'confirmado') erro_('VALIDACAO', 'Estorno deve referenciar uma despesa confirmada.');
  if (r.data_ocorrencia < old.data_ocorrencia) erro_('VALIDACAO', 'Estorno não pode anteceder a compra.');
  var previous = (db.Lancamentos || []).filter(function(x) { return x.tipo === 'estorno' && x.estorno_de_id === old.id && x.status === 'confirmado'; }).reduce(function(s,x) { return s+x.valor_centavos; },0);
  if (previous + r.valor_centavos > old.valor_centavos) erro_('ESTORNO_EXCESSIVO', 'Estornos acumulados superam o valor desta parcela.');
  if (dados.categoria_id && dados.categoria_id !== old.categoria_id) erro_('VALIDACAO', 'Estorno mantém a categoria original.');
  if (dados.conta_origem_id || (dados.conta_destino_id && dados.conta_destino_id !== old.conta_origem_id)) erro_('VALIDACAO', 'Estorno deve retornar à conta original.');
  r.conta_origem_id = ''; r.conta_destino_id = old.conta_origem_id; r.categoria_id = old.categoria_id; r.natureza = old.natureza;
  r.cartao_final = old.cartao_final || ''; r.grupo_orcamento_importacao = old.grupo_orcamento_importacao || '';
  r.criterio_mes = old.criterio_mes || ''; r.mes_fatura = old.mes_fatura || '';
  r.competencia = domMes_(dados.competencia || old.competencia);
  r.forma_pagamento = old.forma_pagamento === 'credito' ? 'transferencia' : old.forma_pagamento;
  r.fatura_ref = old.fatura_ref || ''; r.meta_id = '';
}

function confirmarLancamento_(dados, db, env) {
  domObj_(dados, ['id','versao','data_pagamento','valor_centavos','data_ocorrencia']);
  var old = domRef_(db, 'Lancamentos', domId_(dados.id, 'id', true), false);
  if (dados.versao !== old.versao) erro_('CONFLITO_VERSAO', 'Este lançamento foi alterado. Atualize os dados.');
  if (old.status !== 'previsto') erro_('STATUS_INVALIDO', 'Só previsões podem ser confirmadas.');
  if (old.importacao_id && old.valor_estimado === true) erro_('IMPORTACAO_CONFLITO', 'Confirme esta parcela pela importação da fatura correspondente, preservando o vínculo e o número da parcela.');
  var input = {};
  ['tipo','descricao','valor_centavos','categoria_id','natureza','forma_pagamento','conta_origem_id','conta_destino_id','meta_id','data_ocorrencia','competencia','data_vencimento','fatura_ref','direcao_ajuste'].forEach(function(k) { if (old[k] !== '') input[k]=old[k]; });
  input.status = 'confirmado';
  if (dados.valor_centavos !== undefined) input.valor_centavos = dados.valor_centavos;
  if (dados.data_ocorrencia !== undefined) input.data_ocorrencia = dados.data_ocorrencia;
  if (old.forma_pagamento === 'credito') {
    if (dados.data_pagamento) erro_('VALIDACAO', 'Confirmação de compra no cartão não paga a fatura.');
    delete input.fatura_ref;
    if (dados.data_ocorrencia && dados.data_ocorrencia !== old.data_ocorrencia) { delete input.competencia; delete input.data_vencimento; }
  } else input.data_pagamento = dados.data_pagamento || env.today;
  var validationDb = Object.assign({},db,{Lancamentos:(db.Lancamentos || []).filter(function(x) {return x.id!==old.id;})});
  var row = domCriarLancamentos_(input, validationDb, env, false)[0];
  row.id = old.id; row.recorrencia_id = old.recorrencia_id; row.recorrencia_ref = old.recorrencia_ref || (old.recorrencia_id ? old.data_ocorrencia.slice(0,7) : ''); row.compra_id = old.compra_id || row.compra_id;
  return domMeta_(row,old,env);
}
function cancelarLancamento_(dados, db, env) {
  domObj_(dados, ['id','versao','compra_inteira']);
  var old = domRef_(db, 'Lancamentos', domId_(dados.id, 'id', true), false);
  if (old.versao !== dados.versao) erro_('CONFLITO_VERSAO', 'Este lançamento foi alterado. Atualize os dados.');
  if (dados.compra_inteira !== undefined && typeof dados.compra_inteira !== 'boolean') erro_('VALIDACAO','compra_inteira deve ser booleano.');
  var rows = dados.compra_inteira && old.compra_id ? db.Lancamentos.filter(function(x) { return x.compra_id === old.compra_id; }) : [old];
  if (rows.some(function(x) { return x.status === 'cancelado'; })) erro_('STATUS_INVALIDO', 'Um lançamento desta operação já foi cancelado.');
  var ids=rows.map(function(x) {return x.id;});
  if ((db.Lancamentos || []).some(function(x) { return x.tipo==='estorno' && x.status==='confirmado' && ids.indexOf(x.estorno_de_id)>=0 && ids.indexOf(x.id)<0; })) erro_('DEPENDENCIA_FINANCEIRA','Anule primeiro os estornos vinculados a esta despesa.');
  var invoices={}; rows.forEach(function(x) { if(x.tipo==='despesa' && x.status==='confirmado' && x.fatura_ref) invoices[x.fatura_ref]=true; });
  Object.keys(invoices).forEach(function(ref) {
    var net=0,paid=0;
    (db.Lancamentos || []).filter(function(x) {return x.status==='confirmado' && x.fatura_ref===ref && ids.indexOf(x.id)<0;}).forEach(function(x) { if(x.tipo==='despesa')net+=x.valor_centavos; if(x.tipo==='estorno')net-=x.valor_centavos; if(x.tipo==='transferencia')paid+=x.valor_centavos; });
    if(paid>Math.max(0,net)) erro_('DEPENDENCIA_FINANCEIRA','Anule primeiro o pagamento da fatura antes de anular esta despesa.',{fatura_ref:ref});
  });
  return rows.map(function(x) { return domMeta_(Object.assign({}, x, {status:'cancelado',request_id:env.requestId || ''}),x,env); });
}

/** Materializa ocorrências mensais; cancelar uma previsão não a faz reaparecer. */
function gerarRecorrencias_(db, ate, env) {
  ate = domData_(ate, 'ate');
  if (ate > domDiaMes_(domSomarMes_(env.today.slice(0,7),24),31)) erro_('LIMITE_PROJECAO', 'Gere no máximo 24 meses à frente.');
  var result=[], simulated=Object.assign({},db,{Lancamentos:(db.Lancamentos || []).slice()}), seen={};
  simulated.Lancamentos.forEach(function(l) { if(l.recorrencia_id) seen[l.recorrencia_id+':'+(l.recorrencia_ref || l.data_ocorrencia.slice(0,7))]=true; });
  (db.Recorrencias || []).filter(function(r) { return r.ativa; }).forEach(function(r) {
    if (r.data_inicio > ate) return;
    var end = r.data_fim && r.data_fim < ate ? r.data_fim : ate;
    if (end < r.data_inicio) return;
    var missing=0;
    for (var mes=r.data_inicio.slice(0,7); mes<=end.slice(0,7); mes=domSomarMes_(mes,1)) {
      var date=domDiaMes_(mes,r.dia_vencimento);
      if (date<r.data_inicio || date>end) continue;
      if (seen[r.id+':'+mes]) continue;
      var input={tipo:r.tipo,descricao:r.descricao,valor_centavos:r.valor_previsto_centavos,categoria_id:r.categoria_id,natureza:r.natureza,conta_origem_id:r.conta_origem_id,conta_destino_id:r.conta_destino_id,forma_pagamento:r.forma_pagamento,data_ocorrencia:date,data_vencimento:date,status:'previsto'};
      // Em cartão, o dia da regra é o da cobrança prevista; o ciclo determina a fatura.
      if (r.forma_pagamento==='credito') delete input.data_vencimento;
      var row=domCriarLancamentos_(input,simulated,env,true)[0];
      if (row.data_vencimento>ate) continue;
      missing++;
      if(missing>24) erro_('LIMITE_PROJECAO','Há mais de 24 ocorrências ausentes desta recorrência. Gere primeiro um período menor.',{recorrencia_id:r.id});
      row.recorrencia_id=r.id; row.recorrencia_ref=mes; result.push(row); simulated.Lancamentos.push(row); seen[r.id+':'+mes]=true;
      if (result.length>1000) erro_('LIMITE_LOTE','Geração excedeu 1000 ocorrências. Reduza o período.');
    }
  });
  return result;
}

/** Saldo de apoio à validação de alocação das metas; snapshot é posição de fim de dia. */
function domSaldoConta_(db,id,asOf) {
  var account=domRef_(db,'Contas',id,false), anchor=account.data_saldo_inicial, balance=account.saldo_inicial_centavos;
  if (anchor>asOf) return 0;
  (db.SaldosPatrimoniais || []).filter(function(s) { return s.conta_id===id && s.data<=asOf; }).sort(function(a,b) { return a.data.localeCompare(b.data); }).forEach(function(s) { if(s.data>=anchor) {anchor=s.data;balance=s.valor_centavos;} });
  (db.Lancamentos || []).filter(function(l) { return l.status==='confirmado'; }).forEach(function(l) {
    var cardRefund=l.tipo==='estorno' && l.conta_destino_id && domRef_(db,'Contas',l.conta_destino_id,false).tipo==='cartao';
    var date=(l.tipo==='despesa' && l.forma_pagamento==='credito') || cardRefund ? l.data_ocorrencia : l.data_pagamento;
    if (!date || date<=anchor || date>asOf) return;
    if(l.conta_origem_id===id) balance-=l.valor_centavos;
    if(l.conta_destino_id===id) balance+=l.valor_centavos;
  });
  return balance;
}


/**
 * Relatórios puros: não escrevem dados nem usam serviços do Apps Script.
 * Todos os valores monetários são inteiros em centavos. Percentuais de consumo
 * podem ultrapassar 100 ou ficar negativos quando créditos superam despesas.
 * Compras de crédito reconhecem a dívida integral na aquisição. Apenas a
 * liquidação da fatura movimenta caixa. Projeções assumem quitação integral.
 */

function calcularDashboard_(db, opcoes, env) {
  opcoes = opcoes || {};
  var hoje = relData_(env.today, 'today');
  var mes = relMes_(opcoes.mes || hoje.slice(0, 7));
  var data = opcoes.data ? relData_(opcoes.data, 'data') : relMinData_(relFimMes_(mes), hoje);
  if (data > hoje) erro_('DATA_INVALIDA', 'A data do relatório não pode estar no futuro.');
  var periodoFuturo = mes > data.slice(0, 7);
  var saldos = relSaldos_(db, data);
  var categorias = relIndice_(relLinhas_(db, 'Categorias'));
  var despesas = 0, despesasFixas = 0, despesasVariaveis = 0, receitas = 0, aportes = 0, resgates = 0;
  var receitasOrcamento = 0, movimentosOrcamento = 0;
  var resgatesOrcamento = 0, resgatesPrevistos = 0;
  var porCategoria = {};
  var porGrupo = {};
  var fluxo = { entradas_centavos: 0, saidas_centavos: 0, variacao_centavos: 0,
    receitas_centavos: 0, despesas_diretas_centavos: 0, aportes_centavos: 0,
    resgates_centavos: 0, pagamentos_cartao_centavos: 0, pagamentos_divida_centavos: 0,
    estornos_recebidos_centavos: 0, ajustes_liquidos_centavos: 0 };
  var contas = relIndice_(relLinhas_(db, 'Contas'));
  relLinhas_(db, 'Lancamentos').forEach(function (l) {
    if (l.status === 'cancelado') return;
    var confirmado = l.status === 'confirmado';
    var dataEfeito = relDataEfeito_(l, contas);
    if (confirmado && dataEfeito && dataEfeito <= data && dataEfeito.slice(0, 7) === mes) {
      var valor = relNumero_(l.valor_centavos);
      if (l.tipo === 'receita') receitas += valor;
      if (l.tipo === 'aporte') aportes += valor;
      if (l.tipo === 'resgate') resgates += valor;
      var caixa = relEfeitoCaixa_(l, contas);
      if (caixa > 0) fluxo.entradas_centavos += caixa;
      if (caixa < 0) fluxo.saidas_centavos -= caixa;
      fluxo.variacao_centavos += caixa;
      if (l.tipo === 'receita') fluxo.receitas_centavos += caixa;
      else if (l.tipo === 'despesa') fluxo.despesas_diretas_centavos -= caixa;
      else if (l.tipo === 'aporte') fluxo.aportes_centavos -= caixa;
      else if (l.tipo === 'resgate') fluxo.resgates_centavos += caixa;
      else if (l.tipo === 'estorno') fluxo.estornos_recebidos_centavos += caixa;
      else if (l.tipo === 'ajuste') fluxo.ajustes_liquidos_centavos += caixa;
      else if (l.tipo === 'transferencia' && contas[l.conta_destino_id]) {
        if (contas[l.conta_destino_id].tipo === 'cartao') fluxo.pagamentos_cartao_centavos -= caixa;
        if (contas[l.conta_destino_id].tipo === 'divida') fluxo.pagamentos_divida_centavos -= caixa;
      }
    }
    if (l.competencia !== mes) return;
    if (confirmado && (!dataEfeito || dataEfeito > data)) return;
    // O balanço usa a competência para AMBOS os lados. Receitas recebidas no
    // mês (acima) permanecem no contrato de caixa dos indicadores existentes.
    // Salário previsto, resgate, aporte e transferência não viram renda aqui.
    if (confirmado && !periodoFuturo && (l.tipo === 'receita' || l.tipo === 'despesa' || l.tipo === 'estorno')) {
      movimentosOrcamento++;
      if (l.tipo === 'receita') receitasOrcamento += relNumero_(l.valor_centavos);
    }
    // Resgate não possui categoria de consumo. Abate o grupo metas sem criar
    // uma despesa fictícia ou redistribuir arbitrariamente entre categorias.
    if (l.tipo === 'resgate') {
      if (confirmado) resgatesOrcamento += relNumero_(l.valor_centavos);
      else resgatesPrevistos += relNumero_(l.valor_centavos);
      return;
    }
    var sinal = l.tipo === 'despesa' || l.tipo === 'aporte' ? 1 :
      l.tipo === 'estorno' || l.tipo === 'resgate' ? -1 : 0;
    if (!sinal) return;
    var categoriaId = l.categoria_id || '__sem_categoria__';
    if (!porCategoria[categoriaId]) porCategoria[categoriaId] = { realizado: 0, previsto: 0 };
    porCategoria[categoriaId][confirmado ? 'realizado' : 'previsto'] += sinal * relNumero_(l.valor_centavos);
    // A revisão pode atribuir uma compra específica a outro grupo sem alterar
    // o cadastro da categoria nem reclassificar seus lançamentos anteriores.
    var grupo = relGrupoLancamento_(l, categorias[categoriaId]);
    if (grupo) {
      if (!porGrupo[grupo]) porGrupo[grupo] = { realizado: 0, previsto: 0 };
      porGrupo[grupo][confirmado ? 'realizado' : 'previsto'] += sinal * relNumero_(l.valor_centavos);
    }
    if (confirmado && (l.tipo === 'despesa' || l.tipo === 'estorno')) {
      var despesa = sinal * relNumero_(l.valor_centavos);
      despesas += despesa;
      if (l.natureza === 'fixa') despesasFixas += despesa;
      else despesasVariaveis += despesa;
    }
  });
  var planejamento = relOrcamentos_(db, mes);
  var saidaCategorias = [];
  Object.keys(categorias).forEach(function (id) {
    var c = categorias[id];
    if (c.tipo_movimentacao !== 'receita' && (relAtivo_(c.ativa) || porCategoria[id] || planejamento.categorias[id])) {
      if (!porCategoria[id]) porCategoria[id] = { realizado: 0, previsto: 0 };
    }
  });
  var grupos = {};
  ['necessidades', 'desejos', 'metas'].forEach(function (g) {
    var limite = planejamento.grupos[g];
    grupos[g] = { grupo: g, realizado_centavos: 0, previsto_centavos: 0,
      percentual: limite.percentual, limite_centavos: limite.limite_centavos,
      origem_limite: limite.origem_limite };
  });
  Object.keys(porCategoria).sort().forEach(function (id) {
    var c = categorias[id] || { nome: 'Sem categoria', grupo_orcamento: '', tipo_movimentacao: 'despesa' };
    var valores = porCategoria[id];
    var orc = planejamento.categorias[id];
    var limite = orc ? relLimite_(orc, planejamento.renda_planejada_centavos) : null;
    saidaCategorias.push({ categoria_id: id, nome: c.nome, tipo_movimentacao: c.tipo_movimentacao,
      grupo_orcamento: c.grupo_orcamento, realizado_centavos: valores.realizado,
      previsto_centavos: valores.previsto, limite_centavos: limite,
      alerta: relAlerta_(valores.realizado, valores.previsto, limite) });
  });
  Object.keys(porGrupo).forEach(function (grupo) {
    if (!grupos[grupo]) return;
    grupos[grupo].realizado_centavos = porGrupo[grupo].realizado;
    grupos[grupo].previsto_centavos = porGrupo[grupo].previsto;
  });
  grupos.metas.resgates_centavos = resgatesOrcamento;
  grupos.metas.resgates_previstos_centavos = resgatesPrevistos;
  grupos.metas.realizado_centavos -= resgatesOrcamento;
  grupos.metas.previsto_centavos -= resgatesPrevistos;
  var saidaGrupos = Object.keys(grupos).map(function (g) {
    var linha = grupos[g];
    linha.alerta = relAlerta_(linha.realizado_centavos, linha.previsto_centavos, linha.limite_centavos);
    return linha;
  });
  var avaliacoes = relAvaliacoes_(db, data, saldos);
  var avisos = [];
  if (!planejamento.planejamento_cadastrado) avisos.push('RENDA_PLANEJADA_NAO_CADASTRADA');
  if (avaliacoes.some(function (a) { return a.desatualizada; })) avisos.push('AVALIACAO_PATRIMONIAL_DESATUALIZADA');
  if (saldos.cheque_especial_centavos > 0) avisos.push('SALDO_OPERACIONAL_NEGATIVO_CHEQUE_ESPECIAL');
  if (resgatesOrcamento || resgatesPrevistos) avisos.push('RESGATES_ABATIDOS_DE_METAS_SEM_CATEGORIA');
  var somaGrupos = saidaGrupos.reduce(function (total, g) { return total + (g.limite_centavos || 0); }, 0);
  if (planejamento.renda_planejada_centavos !== null && somaGrupos > planejamento.renda_planejada_centavos) avisos.push('LIMITES_GRUPOS_SUPERAM_RENDA_PLANEJADA');
  saidaGrupos.forEach(function (g) {
    var somaCategorias = saidaCategorias.filter(function (c) { return c.grupo_orcamento === g.grupo; })
      .reduce(function (total, c) { return total + (c.limite_centavos || 0); }, 0);
    if (g.limite_centavos !== null && somaCategorias > g.limite_centavos) avisos.push('LIMITES_CATEGORIAS_SUPERAM_GRUPO:' + g.grupo);
  });
  var metas = relMetas_(db, saldos, data);
  if (metas.some(function (m) { return m.alocacao_conta_excedida; })) avisos.push('METAS_SUPERAM_SALDO_DA_CONTA');
  if (data < hoje && metas.length) avisos.push('ALOCACOES_DE_METAS_SAO_ATUAIS_SEM_HISTORICO');
  var importacaoAviso = relAvisoImportacao_(db, data);
  if (importacaoAviso) avisos.push(importacaoAviso.codigo);
  metas.forEach(function (m) { m.data_referencia_alocacao = hoje; });
  var evolucao = [];
  var mesFinal = data.slice(0, 7);
  for (var i = -11; i <= 0; i++) {
    var mesHistorico = relSomarMes_(mesFinal, i);
    var referencia = relMinData_(relFimMes_(mesHistorico), data);
    var historico = relSaldos_(db, referencia);
    evolucao.push({ mes: mesHistorico, data: referencia,
      historico_disponivel: historico.contas.length > 0,
      patrimonio_liquido_centavos: historico.contas.length ? historico.patrimonio_liquido_centavos : null });
  }
  // Parcelas já contratadas podem pertencer a um mês futuro. Permanecem nos
  // relatórios de compromissos legados, sem aparecer como resultado realizado
  // antes de o mês começar.
  var despesasBalanco = periodoFuturo ? 0 : despesas;
  return { mes: mes, data_referencia: data, saldos: saldos,
    indicadores: { receitas_recebidas_centavos: receitas, despesas_orcamentarias_centavos: despesas,
      despesas_fixas_orcamentarias_centavos: despesasFixas, despesas_variaveis_orcamentarias_centavos: despesasVariaveis,
      aportes_centavos: aportes, resgates_centavos: resgates, poupanca_liquida_centavos: aportes - resgates,
      taxa_poupanca_percentual: receitas > 0 ? (aportes - resgates) * 100 / receitas : null },
    balanco_mensal: { receitas_centavos: receitasOrcamento, despesas_liquidas_centavos: despesasBalanco,
      resultado_centavos: receitasOrcamento - despesasBalanco,
      percentual_renda_consumida: receitasOrcamento > 0 ? despesasBalanco * 100 / receitasOrcamento : null,
      receita_registrada: receitasOrcamento > 0, tem_movimentacao: movimentosOrcamento > 0,
      periodo_futuro: periodoFuturo, criterio: 'competencia', data_referencia: data },
    fluxo_caixa: fluxo,
    orcamento: { renda_planejada_centavos: planejamento.renda_planejada_centavos,
      planejamento_cadastrado: planejamento.planejamento_cadastrado },
    categorias: saidaCategorias, grupos: saidaGrupos, metas: metas,
    gastos_cartoes: relGastosCartoes_(db, mes, data, contas, categorias), importacao_aviso: importacaoAviso,
    avaliacoes_patrimoniais: avaliacoes, evolucao_patrimonial: evolucao, avisos: avisos };
}

function listarFaturas_(db, opcoes, env) {
  opcoes = opcoes || {};
  var hoje = relData_(env.today, 'today');
  var data = opcoes.data ? relData_(opcoes.data, 'data') : hoje;
  if (data > hoje) erro_('DATA_INVALIDA', 'A data do relatório não pode estar no futuro.');
  var contas = relIndice_(relLinhas_(db, 'Contas'));
  if (opcoes.conta_id && (!contas[opcoes.conta_id] || contas[opcoes.conta_id].tipo !== 'cartao')) {
    erro_('CONTA_INVALIDA', 'Selecione uma conta do tipo cartão.');
  }
  var faturas = {};
  var vencimentosDefinidos = {};
  relLinhas_(db, 'Lancamentos').forEach(function (l) {
    if (l.status === 'cancelado' || !l.fatura_ref) return;
    var contaId = l.tipo === 'despesa' ? l.conta_origem_id : l.conta_destino_id;
    var conta = contas[contaId];
    if (!conta || conta.tipo !== 'cartao' || (opcoes.conta_id && contaId !== opcoes.conta_id)) return;
    var confirmado = l.status === 'confirmado';
    var efeito = relDataEfeito_(l, contas);
    if (confirmado && (!efeito || efeito > data)) return;
    var f = faturas[l.fatura_ref];
    if (!f) {
      var mes = l.fatura_ref.slice(-7);
      f = faturas[l.fatura_ref] = { fatura_ref: l.fatura_ref, conta_id: contaId,
        nome_cartao: conta.nome, mes: mes, data_vencimento: relDiaMes_(mes, conta.dia_vencimento || 1),
        total_confirmado_centavos: 0, estornos_centavos: 0, total_liquido_centavos: 0,
        pago_centavos: 0, restante_centavos: 0, saldo_credor_centavos: 0,
        previsto_credito_centavos: 0, pagamentos_previstos_centavos: 0, parcelas: [] };
    }
    var valor = relNumero_(l.valor_centavos);
    // O orçamento pode usar a data da compra, mas a obrigação permanece na
    // fatura indicada por fatura_ref. Um crédito isolado também pode fornecer
    // o vencimento explícito do PDF, desde que pertença ao mesmo ciclo.
    if ((l.tipo === 'despesa' && l.forma_pagamento === 'credito' || l.tipo === 'estorno' && confirmado) &&
        l.data_vencimento && l.data_vencimento.slice(0, 7) === f.mes) {
      f.data_vencimento = vencimentosDefinidos[l.fatura_ref] ? relMinData_(f.data_vencimento, l.data_vencimento) : l.data_vencimento;
      vencimentosDefinidos[l.fatura_ref] = true;
    }
    if (l.tipo === 'despesa' && l.forma_pagamento === 'credito') {
      if (confirmado) f.total_confirmado_centavos += valor;
      else f.previsto_credito_centavos += valor;
      f.parcelas.push({ id: l.id, compra_id: l.compra_id, descricao: l.descricao,
        parcela_numero: relNumero_(l.parcela_numero), parcelas_total: relNumero_(l.parcelas_total),
        valor_centavos: valor, status: l.status, data_ocorrencia: l.data_ocorrencia });
    } else if (l.tipo === 'estorno' && confirmado) f.estornos_centavos += valor;
    else if (l.tipo === 'transferencia') {
      if (confirmado) f.pago_centavos += valor;
      else f.pagamentos_previstos_centavos += valor;
    }
  });
  var lista = Object.keys(faturas).map(function (chave) {
    var f = faturas[chave];
    f.total_liquido_centavos = f.total_confirmado_centavos - f.estornos_centavos;
    f.restante_centavos = Math.max(0, f.total_liquido_centavos - f.pago_centavos);
    f.saldo_credor_centavos = Math.max(0, f.pago_centavos - f.total_liquido_centavos);
    f.atrasada = f.data_vencimento < data && f.restante_centavos > 0;
    f.status = f.restante_centavos === 0 ? (f.total_confirmado_centavos ? 'quitada' : 'prevista') :
      f.atrasada ? 'atrasada' : f.pago_centavos > 0 ? 'parcial' : 'aberta';
    return f;
  }).sort(function (a, b) { return a.data_vencimento.localeCompare(b.data_vencimento) || a.fatura_ref.localeCompare(b.fatura_ref); });
  var dividasConfirmadas = new Map();
  relSaldos_(db, data).contas.forEach(function (c) {
    if (c.tipo === 'cartao') dividasConfirmadas.set(c.conta_id, Math.max(0, -c.saldo_centavos));
  });
  var faturasAbertas = new Map();
  lista.forEach(function (f) {
    f.exige_conciliacao = false;
    faturasAbertas.set(f.conta_id, (faturasAbertas.get(f.conta_id) || 0) + f.restante_centavos);
  });
  var conciliacao = [];
  faturasAbertas.forEach(function (abertas, contaId) {
    // Sem âncora de saldo disponível nesta referência não há comparação
    // confiável. Nunca assumir que a ausência de histórico significa saldo zero.
    if (!dividasConfirmadas.has(contaId) || abertas <= dividasConfirmadas.get(contaId)) return;
    conciliacao.push({ conta_id: contaId, divida_confirmada_centavos: dividasConfirmadas.get(contaId),
      faturas_abertas_centavos: abertas,
      mensagem: 'Há faturas abertas que superam o saldo devedor confirmado deste cartão. Confira pagamentos anteriores e o saldo inicial antes de registrar outro pagamento.' });
    lista.forEach(function (f) {
      if (f.conta_id !== contaId) return;
      f.exige_conciliacao = true;
      if (f.status === 'aberta' || f.status === 'atrasada') f.status = 'conciliar';
    });
  });
  return { data_referencia: data, faturas: lista,
    conciliacao_necessaria: conciliacao,
    dividas_iniciais_sem_vencimento: relDividasIniciais_(db, data, opcoes.conta_id) };
}

function calcularProjecao_(db, opcoes, env) {
  opcoes = opcoes || {};
  var hoje = relData_(env.today, 'today');
  var mesAtual = hoje.slice(0, 7);
  var inicio = relMes_(opcoes.mes || mesAtual);
  var quantidade = opcoes.qtd_meses === undefined ? 12 : Number(opcoes.qtd_meses);
  if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > 24) {
    erro_('HORIZONTE_INVALIDO', 'A projeção deve conter de 1 a 24 meses.');
  }
  if (inicio < mesAtual) erro_('MES_INVALIDO', 'A projeção deve começar no mês atual ou em um mês futuro.');
  var ultimo = relSomarMes_(inicio, quantidade - 1);
  if (ultimo > relSomarMes_(mesAtual, 23)) {
    erro_('HORIZONTE_INVALIDO', 'O último mês deve estar dentro da janela de 24 meses a partir do mês atual.');
  }
  var fim = relFimMes_(ultimo);
  var contas = relIndice_(relLinhas_(db, 'Contas'));
  var virtuais = relRecorrenciasVirtuais_(db, mesAtual, ultimo, env);
  var simulado = {};
  Object.keys(db).forEach(function (chave) { simulado[chave] = db[chave]; });
  simulado.Lancamentos = relLinhas_(db, 'Lancamentos').concat(virtuais);
  var faturas = listarFaturas_(simulado, {}, env);
  var saldosHoje = relSaldos_(db, hoje);
  var compromissos = [];
  var avisos = ['FATURAS_PROJETADAS_COM_QUITACAO_INTEGRAL', 'RECEITAS_PREVISTAS_SAO_ESTIMATIVAS'];
  if (faturas.conciliacao_necessaria.length) avisos.push('CONCILIAR_FATURAS_E_SALDO_CARTAO');
  if (relHaRecorrenciasAntigasNaoProjetadas_(db, mesAtual)) avisos.push('RECORRENCIAS_ANTIGAS_NAO_PROJETADAS');
  if (faturas.faturas.some(function (f) { return f.saldo_credor_centavos > 0; }) ||
      saldosHoje.contas.some(function (c) { return c.tipo === 'cartao' && c.saldo_centavos > 0; })) {
    avisos.push('CREDITO_CARTAO_NAO_COMPENSADO_AUTOMATICAMENTE');
  }
  if (saldosHoje.cheque_especial_centavos > 0) avisos.push('SALDO_OPERACIONAL_NEGATIVO_CHEQUE_ESPECIAL');
  function adicionar(c) {
    if (!c.data_vencimento || c.data_vencimento > fim) return;
    c.atrasado = c.data_vencimento < hoje;
    c.anterior_ao_inicio = c.data_vencimento.slice(0, 7) < inicio;
    c.mes_projetado = c.anterior_ao_inicio ? inicio : c.data_vencimento.slice(0, 7);
    compromissos.push(c);
  }
  faturas.faturas.forEach(function (f) {
    var total = f.restante_centavos + f.previsto_credito_centavos;
    if (!total) return;
    adicionar({ id: f.fatura_ref, tipo: 'fatura', descricao: 'Fatura ' + f.nome_cartao,
      conta_id: f.conta_id, fatura_ref: f.fatura_ref, data_vencimento: f.data_vencimento,
      valor_centavos: total, efeito_caixa_centavos: -total,
      contratado_centavos: f.restante_centavos, estimado_centavos: f.previsto_credito_centavos,
      receita_estimada: false, origem: 'fatura',
      pagamentos_previstos_incorporados_centavos: f.pagamentos_previstos_centavos });
  });
  simulado.Lancamentos.forEach(function (l) {
    if (l.status !== 'previsto') return;
    // A compra de crédito e sua transferência de quitação são representadas
    // uma única vez pelo saldo da fatura acima.
    if (l.tipo === 'despesa' && l.forma_pagamento === 'credito') return;
    if (l.tipo === 'transferencia' && l.fatura_ref && contas[l.conta_destino_id] &&
        contas[l.conta_destino_id].tipo === 'cartao') return;
    var caixa = relEfeitoCaixa_(l, contas);
    if (!caixa) return;
    adicionar({ id: l.id, tipo: l.tipo, descricao: l.descricao,
      data_vencimento: l.data_vencimento || l.data_ocorrencia,
      valor_centavos: relNumero_(l.valor_centavos), efeito_caixa_centavos: caixa,
      contratado_centavos: 0, estimado_centavos: Math.abs(caixa),
      receita_estimada: l.tipo === 'receita', recorrencia_id: l.recorrencia_id || '',
      recorrencia_ref: l.recorrencia_ref || '',
      origem: l._virtual ? 'recorrencia_virtual' : 'lancamento_previsto' });
  });
  compromissos.sort(function (a, b) { return a.data_vencimento.localeCompare(b.data_vencimento) || a.id.localeCompare(b.id); });
  var saldo = saldosHoje.disponivel_centavos;
  var saldoHoje = saldo;
  var meses = [];
  for (var i = 0; i < quantidade; i++) {
    var mes = relSomarMes_(inicio, i);
    var lista = compromissos.filter(function (c) { return c.mes_projetado === mes; });
    var entradas = 0, saidas = 0, receitasEstimadas = 0, contratado = 0;
    lista.forEach(function (c) {
      if (c.efeito_caixa_centavos > 0) entradas += c.efeito_caixa_centavos;
      else saidas -= c.efeito_caixa_centavos;
      if (c.receita_estimada) receitasEstimadas += c.efeito_caixa_centavos;
      contratado += c.contratado_centavos;
    });
    var inicial = saldo;
    saldo += entradas - saidas;
    meses.push({ mes: mes, saldo_inicial_centavos: inicial,
      entradas_previstas_centavos: entradas, saidas_previstas_centavos: saidas,
      receitas_estimadas_centavos: receitasEstimadas, divida_cartao_contratada_centavos: contratado,
      saldo_final_centavos: saldo, saldo_negativo: saldo < 0, compromissos: lista });
  }
  if (faturas.dividas_iniciais_sem_vencimento.length) avisos.push('DIVIDAS_INICIAIS_SEM_DATA_NAO_DEDUZIDAS_DA_PROJECAO');
  if (inicio > mesAtual) avisos.push('COMPROMISSOS_ANTERIORES_AO_INICIO_TRANSPORTADOS_PARA_PRIMEIRO_MES');
  return { data_referencia: hoje, mes_inicial: inicio, qtd_meses: quantidade,
    saldo_disponivel_hoje_centavos: saldoHoje, meses: meses,
    dividas_iniciais_sem_vencimento: faturas.dividas_iniciais_sem_vencimento,
    recorrencias_virtuais: virtuais.length, avisos: avisos };
}

function relLinhas_(db, tabela) { return Array.isArray(db[tabela]) ? db[tabela] : []; }
function relNumero_(valor) { return valor === '' || valor === null || valor === undefined ? 0 : Number(valor); }
function relAtivo_(valor) { return valor === true || valor === 'true'; }
function relIndice_(linhas) {
  var indice = {};
  linhas.forEach(function (linha) { indice[linha.id] = linha; });
  return indice;
}
function relData_(valor, campo) {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) erro_('DATA_INVALIDA', 'Data inválida: ' + campo + '.');
  var d = new Date(valor + 'T00:00:00Z');
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== valor || valor < '1900-01-01' || valor > '2200-12-31') erro_('DATA_INVALIDA', 'Data inválida: ' + campo + '.');
  return valor;
}
function relMes_(valor) {
  if (typeof valor !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(valor) || valor < '1900-01' || valor > '2200-12') erro_('MES_INVALIDO', 'Use um mês no formato AAAA-MM, entre 1900 e 2200.');
  return valor;
}
function relSomarMes_(mes, delta) {
  var partes = mes.split('-').map(Number);
  var total = partes[0] * 12 + partes[1] - 1 + delta;
  return String(Math.floor(total / 12)).padStart(4, '0') + '-' + String(total % 12 + 1).padStart(2, '0');
}
function relFimMes_(mes) {
  var proximo = relSomarMes_(mes, 1);
  var d = new Date(proximo + '-01T00:00:00Z');
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}
function relDiaMes_(mes, dia) {
  return mes + '-' + String(Math.max(1, Math.min(Number(dia), Number(relFimMes_(mes).slice(-2))))).padStart(2, '0');
}
function relMinData_(a, b) { return a < b ? a : b; }
function relOperacional_(conta) { return !!conta && (conta.tipo === 'corrente' || conta.tipo === 'carteira'); }

function relGrupoLancamento_(l, categoria) {
  var grupos = ['necessidades', 'desejos', 'metas'];
  // Estornos manuais vinculados à compra herdam a mesma classificação.
  if ((l.importacao_id || l.tipo === 'estorno' && l.estorno_de_id) && grupos.indexOf(l.grupo_orcamento_importacao) >= 0) return l.grupo_orcamento_importacao;
  return categoria && grupos.indexOf(categoria.grupo_orcamento) >= 0 ? categoria.grupo_orcamento : '';
}

/** Despesas de cartão por competência, preservando caixa e KPIs globais. */
function relGastosCartoes_(db, mes, data, contas, categorias) {
  var porFinal = {}, porConta = {};
  relLinhas_(db, 'Cartoes').forEach(function (c) {
    if (!/^\d{4}$/.test(c.final || '')) return;
    porFinal[c.final] = c;
    if (!porConta[c.conta_id]) porConta[c.conta_id] = [];
    if (!porConta[c.conta_id].some(function (x) { return x.final === c.final; })) porConta[c.conta_id].push(c);
  });
  var grupos = {};
  relLinhas_(db, 'Lancamentos').forEach(function (l) {
    if (l.status === 'cancelado' || l.competencia !== mes) return;
    var despesa = l.tipo === 'despesa' && l.forma_pagamento === 'credito';
    var estorno = l.tipo === 'estorno';
    var contaId = despesa ? l.conta_origem_id : estorno ? l.conta_destino_id : '';
    if (!contas[contaId] || contas[contaId].tipo !== 'cartao') return;
    var confirmado = l.status === 'confirmado';
    var efeito = relDataEfeito_(l, contas);
    if (confirmado && (!efeito || efeito > data)) return;
    var final = /^\d{4}$/.test(l.cartao_final || '') ? l.cartao_final : '';
    if (!final && porConta[contaId] && porConta[contaId].length === 1) final = porConta[contaId][0].final;
    var cadastro = final && porFinal[final] && porFinal[final].conta_id === contaId ? porFinal[final] : null;
    var chave = contaId + ':' + final;
    if (!grupos[chave]) grupos[chave] = {
      final: final, apelido: cadastro ? cadastro.apelido : final ? 'Cartão final ' + final : 'Cartão sem final identificado',
      modalidade: cadastro ? cadastro.modalidade : '', responsavel: cadastro ? cadastro.responsavel : '',
      conta_id: contaId, realizado_centavos: 0, previsto_centavos: 0, categorias: {},
    };
    var grupo = grupos[chave];
    var valor = (estorno ? -1 : 1) * relNumero_(l.valor_centavos);
    var campo = confirmado ? 'realizado_centavos' : 'previsto_centavos';
    grupo[campo] += valor;
    var categoriaId = l.categoria_id || '__sem_categoria__';
    if (!grupo.categorias[categoriaId]) grupo.categorias[categoriaId] = {
      categoria_id: categoriaId, nome: categorias[categoriaId] ? categorias[categoriaId].nome : 'Sem categoria',
      realizado_centavos: 0, previsto_centavos: 0,
    };
    grupo.categorias[categoriaId][campo] += valor;
  });
  return Object.keys(grupos).sort().map(function (chave) {
    var grupo = grupos[chave];
    grupo.categorias = Object.keys(grupo.categorias).sort().map(function (id) { return grupo.categorias[id]; });
    return grupo;
  });
}

/** Estimativas da importação continuam separadas dos saldos confirmados. */
function relAvisoImportacao_(db, data) {
  var lancamentos = relLinhas_(db, 'Lancamentos');
  var parcelas = lancamentos.filter(function (l) {
    return l.status === 'previsto' && l.tipo === 'despesa' && l.forma_pagamento === 'credito' &&
      l.importacao_id && relAtivo_(l.valor_estimado);
  });
  // Mesmo sem opt-in de projeção, a parcela 02/06 revela uma série conhecida.
  // Avisar sobre os ordinais restantes não cria despesas ou altera o saldo.
  var porSerie = new Map();
  lancamentos.forEach(function (l) {
    var id = l.id_parcelamento || l.compra_id;
    if (!id || l.status === 'cancelado' || l.tipo !== 'despesa' || l.forma_pagamento !== 'credito') return;
    if (!porSerie.has(id)) porSerie.set(id, []);
    porSerie.get(id).push(l);
  });
  var naoProjetadas = 0, valorNaoProjetado = 0;
  relLinhas_(db, 'Parcelamentos').forEach(function (serie) {
    var total = relNumero_(serie.parcelas_total), valor = relNumero_(serie.valor_parcela_centavos);
    if (!Number.isSafeInteger(total) || total < 2 || !Number.isSafeInteger(valor) || valor <= 0) return;
    var registros = (porSerie.get(serie.id) || []).filter(function (l) { return l.conta_origem_id === serie.conta_id; });
    var ultima = 0;
    var registrados = new Set();
    registros.forEach(function (l) {
      var numero = relNumero_(l.parcela_numero);
      if (!Number.isSafeInteger(numero) || numero < 1 || numero > total) return;
      registrados.add(numero);
      if (l.status === 'confirmado' && l.data_ocorrencia && l.data_ocorrencia <= data) ultima = Math.max(ultima, numero);
    });
    if (!ultima) return;
    for (var n = ultima + 1; n <= total; n++) {
      if (!registrados.has(n)) { naoProjetadas++; valorNaoProjetado += valor; }
    }
  });
  if (!parcelas.length && !naoProjetadas) return null;
  return {
    codigo: 'PARCELAS_IMPORTADAS_ESTIMADAS_FORA_DO_PATRIMONIO',
    mensagem: 'Há parcelas futuras estimadas ou não projetadas fora do patrimônio confirmado. Confira as séries e o saldo total do cartão; os valores não projetados ainda não aparecem nas previsões.',
    parcelas_estimadas: parcelas.length,
    valor_estimado_centavos: parcelas.reduce(function (total, l) { return total + relNumero_(l.valor_centavos); }, 0),
    parcelas_nao_projetadas: naoProjetadas,
    valor_nao_projetado_estimado_centavos: valorNaoProjetado,
    incluidas_no_saldo: false,
  };
}

function relDataEfeito_(l, contas) {
  var origem = contas[l.conta_origem_id];
  var destino = contas[l.conta_destino_id];
  if (l.tipo === 'despesa' && origem && origem.tipo === 'cartao' && l.forma_pagamento === 'credito') return l.data_ocorrencia;
  if (l.tipo === 'estorno' && destino && destino.tipo === 'cartao') return l.data_ocorrencia;
  return l.data_pagamento || '';
}

function relEfeitos_(l) {
  var valor = relNumero_(l.valor_centavos);
  var efeitos = [];
  if (l.conta_origem_id) efeitos.push({ conta_id: l.conta_origem_id, valor_centavos: -valor });
  if (l.conta_destino_id) efeitos.push({ conta_id: l.conta_destino_id, valor_centavos: valor });
  return efeitos;
}

function relEfeitoCaixa_(l, contas) {
  return relEfeitos_(l).reduce(function (total, e) {
    return total + (relOperacional_(contas[e.conta_id]) ? e.valor_centavos : 0);
  }, 0);
}

function relSaldos_(db, data) {
  var contas = relIndice_(relLinhas_(db, 'Contas'));
  var ancoras = {};
  Object.keys(contas).forEach(function (id) {
    var c = contas[id];
    if (c.data_saldo_inicial > data) return;
    ancoras[id] = { data: c.data_saldo_inicial, valor: relNumero_(c.saldo_inicial_centavos), origem: 'saldo_inicial' };
  });
  relLinhas_(db, 'SaldosPatrimoniais').forEach(function (s) {
    var c = contas[s.conta_id];
    if (!c || (c.tipo !== 'investimento' && c.tipo !== 'reserva') || s.data > data) return;
    var anterior = ancoras[s.conta_id];
    if (anterior && s.data >= anterior.data) ancoras[s.conta_id] = { data: s.data, valor: relNumero_(s.valor_centavos), origem: 'avaliacao' };
  });
  var valores = {};
  Object.keys(ancoras).forEach(function (id) { valores[id] = ancoras[id].valor; });
  relLinhas_(db, 'Lancamentos').forEach(function (l) {
    if (l.status !== 'confirmado') return;
    var dia = relDataEfeito_(l, contas);
    if (!dia || dia > data) return;
    relEfeitos_(l).forEach(function (e) {
      if (ancoras[e.conta_id] && dia > ancoras[e.conta_id].data) valores[e.conta_id] += e.valor_centavos;
    });
  });
  var resultado = { disponivel_centavos: 0, investimentos_centavos: 0, reservas_centavos: 0,
    dividas_centavos: 0, cheque_especial_centavos: 0, dividas_totais_centavos: 0,
    patrimonio_liquido_centavos: 0, contas: [] };
  Object.keys(contas).forEach(function (id) {
    var c = contas[id];
    if (!ancoras[id]) return;
    var valor = valores[id];
    resultado.contas.push({ conta_id: id, nome: c.nome, tipo: c.tipo, ativa: relAtivo_(c.ativa),
      saldo_centavos: valor, data_ancora: ancoras[id].data, origem_ancora: ancoras[id].origem });
    resultado.patrimonio_liquido_centavos += valor;
    if (relOperacional_(c)) resultado.disponivel_centavos += valor;
    if (relOperacional_(c) && valor < 0) resultado.cheque_especial_centavos -= valor;
    if (c.tipo === 'investimento') resultado.investimentos_centavos += valor;
    if (c.tipo === 'reserva') resultado.reservas_centavos += valor;
    if ((c.tipo === 'cartao' || c.tipo === 'divida') && valor < 0) resultado.dividas_centavos -= valor;
  });
  resultado.dividas_totais_centavos = resultado.dividas_centavos + resultado.cheque_especial_centavos;
  resultado.historico_disponivel = resultado.contas.length > 0;
  return resultado;
}

function relLimite_(orcamento, renda) {
  if (orcamento.percentual !== null && orcamento.percentual !== undefined && orcamento.percentual !== '') {
    return renda === null ? null : Math.round(renda * Number(orcamento.percentual) / 100);
  }
  return relNumero_(orcamento.limite_centavos);
}

function relOrcamentos_(db, mes) {
  var linhas = relLinhas_(db, 'Orcamentos').filter(function (o) { return o.mes === mes; });
  var geral = linhas.filter(function (o) { return o.escopo === 'geral'; })[0];
  var renda = geral ? relNumero_(geral.renda_base_centavos) : null;
  var config = {};
  relLinhas_(db, 'Configuracoes').forEach(function (c) { config[c.chave] = c.valor; });
  var resultado = { renda_planejada_centavos: renda, planejamento_cadastrado: !!geral, grupos: {}, categorias: {} };
  var padroes = { necessidades: 50, desejos: 30, metas: 20 };
  Object.keys(padroes).forEach(function (g) {
    var linha = linhas.filter(function (o) { return o.escopo === 'grupo' && o.referencia_id === g; })[0];
    var percentual = linha ? linha.percentual : Number(config['percentual_' + g] === undefined ? padroes[g] : config['percentual_' + g]);
    var limite = linha ? relLimite_(linha, renda) : renda === null ? null : Math.round(renda * percentual / 100);
    resultado.grupos[g] = { percentual: percentual === '' || percentual === null || percentual === undefined ? null : Number(percentual),
      limite_centavos: limite, origem_limite: linha ? 'orcamento_mensal' : 'percentual_padrao' };
  });
  linhas.filter(function (o) { return o.escopo === 'categoria'; }).forEach(function (o) { resultado.categorias[o.referencia_id] = o; });
  return resultado;
}

function relAlerta_(realizado, previsto, limite) {
  if (limite === null) return 'sem_orcamento';
  if (realizado > limite) return 'ultrapassado';
  if (realizado + previsto > limite) return 'risco';
  return 'dentro';
}

function relMetas_(db, saldos, data) {
  var porConta = {}, alocados = {};
  saldos.contas.forEach(function (c) { porConta[c.conta_id] = c.saldo_centavos; });
  relLinhas_(db, 'Metas').forEach(function (m) {
    if (relAtivo_(m.ativa)) alocados[m.conta_id] = (alocados[m.conta_id] || 0) + relNumero_(m.valor_alocado_centavos);
  });
  return relLinhas_(db, 'Metas').filter(function (m) { return relAtivo_(m.ativa); }).map(function (m) {
    var alvo = relNumero_(m.valor_alvo_centavos), alocado = relNumero_(m.valor_alocado_centavos);
    return { meta_id: m.id, nome: m.nome, tipo: m.tipo, conta_id: m.conta_id,
      valor_alvo_centavos: alvo, valor_alocado_centavos: alocado, data_alvo: m.data_alvo,
      progresso_percentual: alvo > 0 ? alocado * 100 / alvo : null,
      falta_centavos: Math.max(0, alvo - alocado),
      prazo_vencido: !!m.data_alvo && m.data_alvo < data && alocado < alvo,
      saldo_conta_centavos: porConta[m.conta_id] === undefined ? null : porConta[m.conta_id],
      alocacao_conta_excedida: (alocados[m.conta_id] || 0) > Math.max(0, porConta[m.conta_id] || 0),
      historico_alocacao_disponivel: false };
  });
}

function relAvaliacoes_(db, data, saldos) {
  return saldos.contas.filter(function (c) { return c.tipo === 'investimento' || c.tipo === 'reserva'; }).map(function (c) {
    var dias = Math.floor((new Date(data + 'T00:00:00Z').getTime() - new Date(c.data_ancora + 'T00:00:00Z').getTime()) / 86400000);
    return { conta_id: c.conta_id, data_ultima_avaliacao: c.data_ancora, origem: c.origem_ancora,
      dias_desde_avaliacao: dias, desatualizada: dias > 31, saldo_centavos: c.saldo_centavos };
  });
}

function relDividasIniciais_(db, data, contaFiltro) {
  var contas = relIndice_(relLinhas_(db, 'Contas'));
  var resultado = [];
  Object.keys(contas).forEach(function (id) {
    var c = contas[id];
    if ((c.tipo !== 'cartao' && c.tipo !== 'divida') || (contaFiltro && id !== contaFiltro) || c.data_saldo_inicial > data) return;
    var restante = Math.max(0, -relNumero_(c.saldo_inicial_centavos));
    relLinhas_(db, 'Lancamentos').forEach(function (l) {
      if (l.status !== 'confirmado' || l.fatura_ref || l.tipo !== 'transferencia' || l.conta_destino_id !== id) return;
      var dia = relDataEfeito_(l, contas);
      if (dia && dia > c.data_saldo_inicial && dia <= data) restante -= relNumero_(l.valor_centavos);
    });
    if (restante > 0) resultado.push({ conta_id: id, nome: c.nome, tipo: c.tipo,
      valor_centavos: restante, data_vencimento: null, incluido_na_projecao: false });
  });
  return resultado;
}

function relRecorrenciasVirtuais_(db, inicio, fim, env) {
  // Reutiliza a mesma regra de ciclo/deduplicação da persistência. Apenas a
  // cópia recebe o início limitado: o cadastro original permanece intocado.
  var simulado = {};
  Object.keys(db).forEach(function (chave) { simulado[chave] = db[chave]; });
  simulado.Recorrencias = relLinhas_(db, 'Recorrencias').map(function (r) {
    var copia = Object.assign({}, r);
    if (copia.data_inicio < inicio + '-01') copia.data_inicio = inicio + '-01';
    return copia;
  });
  var contador = 0;
  var ambiente = Object.assign({}, env, { uuid: function () {
    contador++;
    return 'virtual-' + String(contador).padStart(8, '0');
  } });
  return gerarRecorrencias_(simulado, relFimMes_(fim), ambiente).map(function (l) {
    return Object.assign({}, l, { _virtual: true });
  });
}

function relHaRecorrenciasAntigasNaoProjetadas_(db, mesAtual) {
  var existentes = {};
  relLinhas_(db, 'Lancamentos').forEach(function (l) {
    if (l.recorrencia_id) existentes[l.recorrencia_id + ':' + (l.recorrencia_ref || l.data_ocorrencia.slice(0, 7))] = true;
  });
  return relLinhas_(db, 'Recorrencias').some(function (r) {
    if (!relAtivo_(r.ativa) || r.data_inicio.slice(0, 7) >= mesAtual) return false;
    var ultimo = relMinData_(r.data_fim || relFimMes_(relSomarMes_(mesAtual, -1)), relFimMes_(relSomarMes_(mesAtual, -1)));
    var mes = r.data_inicio.slice(0, 7);
    while (mes <= ultimo.slice(0, 7)) {
      var dia = relDiaMes_(mes, r.dia_vencimento);
      if (dia >= r.data_inicio && dia <= ultimo && !existentes[r.id + ':' + mes]) return true;
      mes = relSomarMes_(mes, 1);
    }
    return false;
  });
}


/**
 * Importação de fatura: valida e prepara um lote SEM executar I/O ou alterar db.
 * A API chama esta função sob ScriptLock e grava mudanças + recibo atomicamente.
 * A entrada usa centavos COM sinal; Lancamentos mantém o contrato positivo/tipo.
 */
function impNormalizar_(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}
function impEstabelecimento_(value) {
  return impNormalizar_(value).replace(/^(?:ESTORNO|DEVOLUCAO|REEMBOLSO)(?: DE| DA)?\s*[:*\-]?\s+/u, '')
    .replace(/(?<![\d/])(\d{1,2})\s*\/\s*(\d{1,2})(?=\s|$)/g, function (whole, current, total) {
      return Number(total) > 1 && Number(current) > 0 && Number(current) <= Number(total) ? ' ' : whole;
    }).replace(/\s+/g, ' ').trim();
}
function impHash_(parts, env) {
  var text = JSON.stringify(parts);
  if (env && typeof env.hash === 'function') return env.hash(text);
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}
function impPagamento_(description) {
  return impNormalizar_(description) === 'PAGAMENTO' || /\b(?:PAGAMENTO (?:EFETUADO|RECEBIDO|DE FATURA|DA FATURA)|DEBITO AUTOMATICO(?: DE| DA)? FATURA|PGTO(?: DE| DA)? FATURA|PAGTO(?: DE| DA)? FATURA)\b/u.test(impNormalizar_(description));
}
function impAssinado_(row) { return row.tipo === 'estorno' ? -row.valor_centavos : row.valor_centavos; }
function impConta_(row) { return row.tipo === 'estorno' ? row.conta_destino_id : row.conta_origem_id; }
function impMesFatura_(row) {
  var ref = /:(\d{4}-\d{2})$/.exec(row.fatura_ref || '');
  return row.mes_fatura || (ref && ref[1]) || (row.data_vencimento || '').slice(0, 7);
}
function impParcela_(row) { return Number.isSafeInteger(row.parcela_numero) && row.parcela_numero > 0 ? row.parcela_numero : 1; }
function impAssinatura_(row, signed, final) {
  return [row.data_ocorrencia || row.data_compra, impEstabelecimento_(row.descricao), signed,
    final || row.cartao_final || '', row.mes_fatura || impMesFatura_(row), impParcela_(row)];
}
function impConflito_(message, id) {
  erro_('IMPORTACAO_CONFLITO', message, id ? { id_cliente: id } : undefined);
}
function impLista_(value, name, max, optional) {
  if (optional && value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) erro_('LIMITE_LOTE', 'Lista inválida ou grande demais: ' + name);
  return value;
}
function impBool_(value, name) {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') erro_('VALIDACAO', name + ' deve ser booleano.');
  return value;
}

function importarLote_(dados, db, env) {
  domObj_(dados, ['confirmado', 'vencimento', 'criterio_mes', 'cartoes', 'lancamentos']);
  if (dados.confirmado !== true) erro_('IMPORTACAO_NAO_CONFIRMADA', 'Confirme a revisão antes de salvar a fatura.');
  var vencimento = domData_(dados.vencimento, 'vencimento');
  var criterion = domEnum_(dados.criterio_mes, 'criterio_mes', ['vencimento', 'compra']);
  var month = vencimento.slice(0, 7);
  var inputs = impLista_(dados.lancamentos, 'lancamentos', APP_.MAX_IMPORT_ITENS || 200);
  if (!inputs.length) erro_('VALIDACAO', 'Selecione pelo menos um lançamento.');
  var cardInputs = impLista_(dados.cartoes, 'cartoes', 200, true);
  var changes = [], changeMap = new Map(), idClientes = new Set();
  var cardRows = (db.Cartoes || []).map(function (r) { return Object.assign({}, r); });
  var seriesRows = (db.Parcelamentos || []).map(function (r) { return Object.assign({}, r); });
  var originalSeries = (db.Parcelamentos || []).slice();
  var transactionRows = (db.Lancamentos || []).slice();
  var rules = (db.Regras_Categorizacao || []).slice();
  var receipt = { importacao_id: env.requestId || env.uuid(), quantidade: inputs.length, inseridos: 0,
    reconciliados: 0, ignorados: 0, projetados: 0, regras_salvas: 0, cartoes_salvos: 0, metadados_atualizados: 0, ids: [] };
  function stage(table, row) {
    var key = table + ':' + row.id;
    if (changeMap.has(key)) changes[changeMap.get(key)] = { tabela: table, registro: row };
    else { changeMap.set(key, changes.length); changes.push({ tabela: table, registro: row }); }
    return row;
  }
  function metadata(row, previous) { return domMeta_(row, previous || null, env); }

  // Nenhum final pode ser religado silenciosamente a outra conta já movimentada.
  var seenCards = new Set();
  cardInputs.forEach(function (v) {
    domObj_(v, ['final', 'apelido', 'modalidade', 'responsavel', 'conta_id']);
    var final = domTexto_(v.final, 'final', true, 4);
    if (!/^\d{4}$/.test(final) || seenCards.has(final)) erro_('VALIDACAO', 'Informe finais de cartão únicos com quatro dígitos.');
    seenCards.add(final);
    var accountId = domId_(v.conta_id, 'conta_id', true), account = domRef_(db, 'Contas', accountId, true);
    domTipoConta_(account, ['cartao'], 'conta do cartão');
    var found = cardRows.filter(function (c) { return c.final === final; });
    if (found.length > 1) erro_('BANCO_INCONSISTENTE', 'Final duplicado em Cartoes.');
    var previous = found[0];
    if (previous && previous.conta_id !== accountId && transactionRows.some(function (l) { return l.cartao_final === final; })) impConflito_('O final já tem lançamentos em outra conta. Corrija o vínculo antes de importar.');
    var card = { id: previous ? previous.id : env.uuid(), final: final,
      apelido: (v.apelido === undefined && previous ? previous.apelido : domTexto_(v.apelido, 'apelido', false, 100)) || 'Cartão ' + final,
      modalidade: domEnum_(v.modalidade, 'modalidade', ['fisico', 'virtual', 'adicional'], previous ? previous.modalidade : 'fisico'),
      responsavel: v.responsavel === undefined && previous ? previous.responsavel : domTexto_(v.responsavel, 'responsavel', false, 100), conta_id: accountId, ativa: true };
    var same = previous && ['final', 'apelido', 'modalidade', 'responsavel', 'conta_id', 'ativa'].every(function (k) { return card[k] === previous[k]; });
    if (!same) {
      card = metadata(card, previous); stage('Cartoes', card); receipt.cartoes_salvos++;
      if (previous) cardRows[cardRows.indexOf(previous)] = card; else cardRows.push(card);
    }
  });
  var cardMap = new Map();
  cardRows.forEach(function (c) {
    if (cardMap.has(c.final)) erro_('BANCO_INCONSISTENTE', 'Final duplicado em Cartoes.');
    cardMap.set(c.final, c);
  });
  var current = inputs.map(function (v) {
    domObj_(v, ['id_cliente', 'data_compra', 'descricao', 'valor_centavos', 'categoria_id', 'grupo_orcamento', 'cartao_final', 'parcela_numero', 'parcelas_total', 'id_parcelamento', 'projetar', 'aprender', 'duplicidade_revisada', 'ocorrencia']);
    var id = domId_(v.id_cliente, 'id_cliente', true);
    if (idClientes.has(id)) erro_('VALIDACAO', 'Identificador de linha repetido.');
    idClientes.add(id);
    var description = domTexto_(v.descricao, 'descricao', true, 500);
    if (impPagamento_(description)) erro_('VALIDACAO', 'Pagamento de fatura não é lançamento de consumo: desmarque esta linha.', { id_cliente: id });
    var amount = v.valor_centavos;
    if (!Number.isSafeInteger(amount) || amount === 0 || Math.abs(amount) > 9000000000000) erro_('VALIDACAO', 'Valor inválido da linha.', { id_cliente: id });
    if (amount > 0 && /^(?:ESTORNO|CREDITO|CREDITOS|DESCONTO|CASHBACK|DEVOLUCAO|REEMBOLSO)\b/.test(impNormalizar_(description))) erro_('VALIDACAO', 'Crédito/estorno deve ter valor negativo.', { id_cliente: id });
    var date = domData_(v.data_compra, 'data_compra');
    if (date > env.today || date > vencimento) erro_('DATA_FUTURA', 'A compra deve ter ocorrido até hoje e até o vencimento.', { id_cliente: id });
    var final = domTexto_(v.cartao_final, 'cartao_final', true, 4);
    if (!/^\d{4}$/.test(final)) erro_('VALIDACAO', 'Final do cartão inválido.', { id_cliente: id });
    var card = cardMap.get(final);
    if (!card || card.ativa === false) erro_('REFERENCIA_INVALIDA', 'Vincule o final ' + final + ' a uma conta de cartão ativa.');
    var account = domRef_(db, 'Contas', card.conta_id, true); domTipoConta_(account, ['cartao'], 'conta do cartão');
    var categoryId = domId_(v.categoria_id, 'categoria_id', true), category = domRef_(db, 'Categorias', categoryId, true);
    if (category.tipo_movimentacao !== 'despesa') erro_('CATEGORIA_INCOMPATIVEL', 'Escolha uma categoria de despesa.', { id_cliente: id });
    var group = domEnum_(v.grupo_orcamento, 'grupo_orcamento', ['necessidades', 'desejos', 'metas']);
    var n = 1, total = 1;
    if (v.parcelas_total !== undefined && v.parcelas_total !== null && v.parcelas_total !== '') {
      total = domInt_(v.parcelas_total, 'parcelas_total', 2, 99);
      n = domInt_(v.parcela_numero, 'parcela_numero', 1, total);
    } else if (v.parcela_numero !== undefined && v.parcela_numero !== null && v.parcela_numero !== '') erro_('VALIDACAO', 'Parcela sem total.');
    var project = impBool_(v.projetar, 'projetar'), learn = impBool_(v.aprender, 'aprender');
    impBool_(v.duplicidade_revisada, 'duplicidade_revisada');
    if (project && (total === 1 || amount < 0 || n === total)) erro_('VALIDACAO', 'Não há parcelas futuras válidas nesta linha.');
    var seriesId = domId_(v.id_parcelamento, 'id_parcelamento', false);
    if (seriesId && total === 1) erro_('VALIDACAO', 'Compra à vista não recebe parcelamento.');
    // Ordinal da linha entre TODOS os itens iguais da revisão, não somente os
    // selecionados. Isso permite importar duas compras legítimas em lotes separados.
    var occurrenceOrdinal = v.ocorrencia === undefined ? null : domInt_(v.ocorrencia, 'ocorrencia', 1, 50000);
    return { id_cliente: id, data_compra: date, descricao: description, descricao_base: impEstabelecimento_(description),
      valor_centavos: amount, categoria_id: categoryId, categoria: category, grupo_orcamento: group,
      cartao_final: final, conta_id: card.conta_id, parcela_numero: n, parcelas_total: total,
      id_parcelamento: seriesId, projetar: project, aprender: learn, mes_fatura: month, ocorrencia: occurrenceOrdinal };
  });
  var futureCount = current.reduce(function (n, r) { return n + (r.projetar ? r.parcelas_total - r.parcela_numero : 0); }, 0);
  if (futureCount > (APP_.MAX_IMPORT_PROJECOES || 1200)) erro_('LIMITE_PROJECAO', 'Reduza as parcelas futuras deste lote.');
  var sum = current.reduce(function (n, r) { return n + Math.abs(r.valor_centavos); }, 0);
  if (!Number.isSafeInteger(sum)) erro_('VALIDACAO', 'Total fora do limite permitido.');
  var exposure = current.reduce(function (n, r) { return n + Math.abs(r.valor_centavos) * (1 + (r.projetar ? r.parcelas_total - r.parcela_numero : 0)); }, 0);
  if (!Number.isSafeInteger(exposure)) erro_('VALIDACAO', 'O total das parcelas ultrapassa o limite de centavos exatos.');

  // Índices do estado inicial + consumo por ocorrência: duas compras iguais
  // legítimas usam ordinais distintos, sem eliminar ambas por um Set de hashes.
  var strong = new Map(), consumed = new Set(), occurrence = new Map(), occurrenceKeys = new Set(), usedSeries = new Set();
  transactionRows.forEach(function (r) {
    if (r.importacao_chave) {
      if (strong.has(r.importacao_chave)) erro_('BANCO_INCONSISTENTE', 'Chave de importação duplicada no banco.');
      strong.set(r.importacao_chave, r);
    }
  });
  function sameRowBase(existing, item, includeValue) {
    if (['despesa', 'estorno'].indexOf(existing.tipo) < 0 || impConta_(existing) !== item.conta_id || existing.data_ocorrencia !== item.data_compra) return false;
    if (existing.cartao_final && existing.cartao_final !== item.cartao_final) return false;
    if (impEstabelecimento_(existing.descricao) !== item.descricao_base || impParcela_(existing) !== item.parcela_numero || impMesFatura_(existing) !== month) return false;
    if ((existing.tipo === 'estorno') !== (item.valor_centavos < 0)) return false;
    return !includeValue || impAssinado_(existing) === item.valor_centavos;
  }
  function legacyMatches(item, includeValue, status) {
    var candidates = transactionRows.filter(function (r) { return !consumed.has(r.id) && (!status || r.status === status) && sameRowBase(r, item, includeValue); });
    if (item.id_parcelamento && item.parcelas_total > 1 && item.valor_centavos > 0) {
      var knownId = seriesRows.some(function (s) { return s.id === item.id_parcelamento; }) || transactionRows.some(function (r) { return (r.id_parcelamento || r.compra_id) === item.id_parcelamento; });
      if (knownId) return candidates.filter(function (r) { return (r.id_parcelamento || r.compra_id) === item.id_parcelamento; });
      // Um UUID novo fornecido pelo cliente não resolve duas previsões antigas.
      if (candidates.length > 1) impConflito_('A série informada não identifica as previsões existentes. Selecione o vínculo correto.', item.id_cliente);
    }
    return candidates;
  }
  function replaceTransaction(row, previous) {
    if (previous) {
      var index = transactionRows.findIndex(function (r) { return r.id === previous.id; });
      if (index >= 0) transactionRows[index] = row;
    } else transactionRows.push(row);
    stage('Lancamentos', row);
    return row;
  }
  function seriesMatches(series, item, firstMonth) {
    return series.cartao_final === item.cartao_final && series.conta_id === item.conta_id && series.data_compra === item.data_compra &&
      impEstabelecimento_(series.descricao_base) === item.descricao_base && series.parcelas_total === item.parcelas_total && series.mes_primeira_fatura === firstMonth;
  }
  function resolveSeries(item, matched) {
    if (item.parcelas_total === 1 || item.valor_centavos < 0) return null;
    var firstMonth = domMes_(domSomarMes_(month, -(item.parcela_numero - 1)));
    if (matched && Number.isSafeInteger(matched.parcelas_total) && matched.parcelas_total !== item.parcelas_total) impConflito_('O total de parcelas difere da compra já cadastrada.', item.id_cliente);
    var knownId = matched && (matched.id_parcelamento || matched.compra_id);
    var id = knownId || item.id_parcelamento;
    var previous = id && seriesRows.find(function (s) { return s.id === id; });
    if (previous && !seriesMatches(previous, item, firstMonth)) impConflito_('A série informada pertence a outra compra ou ciclo.', item.id_cliente);
    if (id && !previous) {
      var legacyReferences = transactionRows.filter(function (r) { return (r.id_parcelamento || r.compra_id) === id && r.tipo === 'despesa'; });
      if (legacyReferences.some(function (r) {
        return impConta_(r) !== item.conta_id || r.data_ocorrencia !== item.data_compra ||
          (r.cartao_final && r.cartao_final !== item.cartao_final) || impEstabelecimento_(r.descricao) !== item.descricao_base ||
          r.parcelas_total !== item.parcelas_total || domSomarMes_(impMesFatura_(r), -(impParcela_(r) - 1)) !== firstMonth;
      })) impConflito_('O identificador legado pertence a outra compra ou ciclo.', item.id_cliente);
    }
    if (!previous && !knownId) {
      var possible = originalSeries.filter(function (s) { return seriesMatches(s, item, firstMonth) && !usedSeries.has(s.id + ':' + item.parcela_numero); });
      if (possible.length > 1 && !id) impConflito_('Há mais de um parcelamento compatível. Selecione o vínculo correto antes de importar.', item.id_cliente);
      if (!id && possible.length === 1) { previous = possible[0]; id = previous.id; }
    }
    if (id && usedSeries.has(id + ':' + item.parcela_numero)) impConflito_('A mesma parcela foi vinculada duas vezes à série.', item.id_cliente);
    if (!id) id = env.uuid();
    var row = { id: id, cartao_final: item.cartao_final, descricao_base: item.descricao_base,
      data_compra: item.data_compra, parcelas_total: item.parcelas_total, valor_parcela_centavos: Math.abs(item.valor_centavos),
      mes_primeira_fatura: firstMonth, conta_id: item.conta_id };
    if (!previous) {
      row = metadata(row, null); seriesRows.push(row); stage('Parcelamentos', row);
    } else {
      // Só o valor observado desta parcela muda; a identidade/ciclo é preservada.
      if (previous.valor_parcela_centavos !== row.valor_parcela_centavos) {
        row = metadata(row, previous); seriesRows[seriesRows.findIndex(function (s) { return s.id === previous.id; })] = row; stage('Parcelamentos', row);
      } else row = previous;
    }
    usedSeries.add(id + ':' + item.parcela_numero);
    return row;
  }
  function createTransaction(item, due, n, status, series, hash, key, previous) {
    var row = domBlankLancamento_();
    row.tipo = item.valor_centavos < 0 ? 'estorno' : 'despesa'; row.descricao = item.descricao;
    row.valor_centavos = Math.abs(item.valor_centavos); row.categoria_id = item.categoria_id;
    row.natureza = /\bIOF\b/.test(impNormalizar_(item.descricao)) ? 'variavel' : domEnum_(item.categoria.natureza_padrao, 'natureza da categoria', ['fixa', 'variavel'], 'variavel');
    row.forma_pagamento = row.tipo === 'estorno' ? 'transferencia' : 'credito';
    row.conta_origem_id = row.tipo === 'despesa' ? item.conta_id : '';
    row.conta_destino_id = row.tipo === 'estorno' ? item.conta_id : '';
    row.data_ocorrencia = item.data_compra; row.competencia = criterion === 'compra' ? item.data_compra.slice(0, 7) : due.slice(0, 7);
    row.data_vencimento = due; row.data_pagamento = ''; row.status = status;
    row.compra_id = series ? series.id : previous && previous.compra_id || env.uuid();
    row.parcela_numero = n; row.parcelas_total = item.parcelas_total; row.fatura_ref = item.conta_id + ':' + due.slice(0, 7);
    row.cartao_final = item.cartao_final; row.id_parcelamento = series ? series.id : '';
    row.importacao_hash = hash; row.importacao_chave = key; row.importacao_id = receipt.importacao_id;
    row.criterio_mes = criterion; row.grupo_orcamento_importacao = item.grupo_orcamento;
    row.credito_importado = row.tipo === 'estorno'; row.valor_estimado = status === 'previsto'; row.mes_fatura = due.slice(0, 7);
    row.request_id = env.requestId || '';
    if (previous && previous.estorno_de_id) row.estorno_de_id = previous.estorno_de_id;
    return metadata(row, previous);
  }
  var learning = new Map();
  current.forEach(function (item) {
    if (item.id_parcelamento && item.parcelas_total > 1 && item.valor_centavos > 0) {
      var requestedSeries = seriesRows.find(function (s) { return s.id === item.id_parcelamento; });
      if (requestedSeries && !seriesMatches(requestedSeries, item, domSomarMes_(month, -(item.parcela_numero - 1)))) impConflito_('A série informada pertence a outra compra ou ciclo.', item.id_cliente);
    }
    var hash = impHash_([item.data_compra, item.descricao_base, item.valor_centavos], env);
    var base = JSON.stringify([hash, item.cartao_final, month, item.parcela_numero]);
    var sequentialOrdinal = (occurrence.get(base) || 0) + 1;
    var ordinal = item.ocorrencia === null ? sequentialOrdinal : item.ocorrencia;
    occurrence.set(base, Math.max(sequentialOrdinal, ordinal));
    var occurrenceKey = base + ':' + ordinal;
    if (occurrenceKeys.has(occurrenceKey)) erro_('VALIDACAO', 'A mesma ocorrência foi selecionada mais de uma vez.', { id_cliente: item.id_cliente });
    occurrenceKeys.add(occurrenceKey);
    var key = impHash_([hash, item.cartao_final, month, item.parcela_numero, ordinal], env);
    var exact = strong.get(key), matched = exact;
    if (exact && item.id_parcelamento && (exact.id_parcelamento || exact.compra_id) && (exact.id_parcelamento || exact.compra_id) !== item.id_parcelamento && seriesRows.some(function (s) { return s.id === item.id_parcelamento; })) impConflito_('O vínculo escolhido difere da ocorrência já importada. Confira a série antes de continuar.', item.id_cliente);
    if (exact && exact.status === 'cancelado') impConflito_('O item já foi importado e cancelado. Resolva o cancelamento antes de reinserir.', item.id_cliente);
    if (!matched) {
      var legacy = legacyMatches(item, true).filter(function (r) { return !r.importacao_chave || r.status === 'previsto'; });
      var confirmed = legacy.filter(function (r) { return r.status === 'confirmado'; });
      if (confirmed.length) matched = confirmed[0];
      else {
        var forecast = legacy.filter(function (r) { return r.status === 'previsto'; });
        if (forecast.length === 1) matched = forecast[0];
        else if (forecast.length > 1) impConflito_('Há previsões indistinguíveis para esta parcela. Revise os vínculos.', item.id_cliente);
        else if (legacy.some(function (r) { return r.status === 'cancelado'; })) impConflito_('O lançamento correspondente já está cancelado. Resolva o cancelamento antes de reinserir.', item.id_cliente);
      }
    }
    if (!matched) {
      // Preserve a identidade de uma previsão legada mesmo se o valor observado
      // na fatura tiver ajuste de centavos em relação à estimativa.
      var varyingForecasts = legacyMatches(item, false, 'previsto');
      if (varyingForecasts.length === 1) matched = varyingForecasts[0];
      else if (varyingForecasts.length > 1) impConflito_('Previsões ambíguas com outro valor. Confira antes de importar.', item.id_cliente);
    }
    var series = resolveSeries(item, matched);
    if (!matched && series) {
      var seriesMatchesRows = transactionRows.filter(function (r) { return !consumed.has(r.id) && (r.id_parcelamento || r.compra_id) === series.id && impParcela_(r) === item.parcela_numero && (r.tipo === 'despesa') && impMesFatura_(r) === month; });
      if (seriesMatchesRows.length > 1) impConflito_('Mais de um lançamento para a mesma parcela.', item.id_cliente);
      matched = seriesMatchesRows[0];
    }
    if (matched && matched.status === 'cancelado') impConflito_('A parcela já está cancelada. Resolva o cancelamento antes de confirmar.', item.id_cliente);
    if (matched && matched.status === 'confirmado') {
      if (!sameRowBase(matched, item, true)) impConflito_('O valor ou a identidade de uma parcela já confirmada mudou. Corrija o registro existente.', item.id_cliente);
      if (matched.data_vencimento !== vencimento) erro_('VENCIMENTO_FATURA_DIVERGENTE', 'O lançamento existente possui outro vencimento confirmado.');
      // Vincular um lançamento manual já registrado não cria outra despesa nem
      // aplica a categoria/competência escolhida para a linha duplicada. Apenas
      // preenche os metadados que faltavam para a próxima importação e filtros.
      var enrichment = { cartao_final: item.cartao_final, importacao_hash: hash, importacao_chave: key,
        importacao_id: matched.importacao_id || receipt.importacao_id, mes_fatura: month };
      if (series) enrichment.id_parcelamento = series.id;
      var missingMetadata = Object.keys(enrichment).some(function (field) { return matched[field] !== enrichment[field]; });
      if (missingMetadata) {
        var enriched = metadata(Object.assign({}, matched, enrichment, { request_id: env.requestId || '' }), matched);
        replaceTransaction(enriched, matched); strong.set(key, enriched); receipt.metadados_atualizados++;
      }
      consumed.add(matched.id); receipt.ignorados++; receipt.ids.push(matched.id);
    } else {
      var conflictingDue = transactionRows.some(function (r) { return r.id !== (matched && matched.id) && r.status === 'confirmado' && ['despesa', 'estorno'].indexOf(r.tipo) >= 0 && r.fatura_ref === item.conta_id + ':' + month && r.data_vencimento !== vencimento; });
      if (conflictingDue) erro_('VENCIMENTO_FATURA_DIVERGENTE', 'A fatura já possui outro vencimento confirmado.');
      var row = createTransaction(item, vencimento, item.parcela_numero, 'confirmado', series, hash, key, matched);
      replaceTransaction(row, matched); strong.set(key, row); consumed.add(row.id); receipt.ids.push(row.id);
      if (matched) receipt.reconciliados++; else receipt.inseridos++;
    }
    if (item.projetar && series) {
      for (var n = item.parcela_numero + 1; n <= item.parcelas_total; n++) {
        var due = domDiaMes_(domMes_(domSomarMes_(month, n - item.parcela_numero)), Number(vencimento.slice(8, 10)));
        var oldRows = transactionRows.filter(function (r) { return (r.id_parcelamento || r.compra_id) === series.id && impParcela_(r) === n && r.tipo === 'despesa'; });
        if (oldRows.length > 1) impConflito_('Há mais de uma previsão para uma parcela futura.', item.id_cliente);
        var old = oldRows[0];
        if (old && (old.status === 'confirmado' || old.status === 'cancelado')) continue;
        var projectedHash = hash;
        var projectedKey = impHash_(['parcela_prevista', series.id, n], env);
        var futureItem = Object.assign({}, item, { descricao: item.descricao_base });
        var future = createTransaction(futureItem, due, n, 'previsto', series, projectedHash, projectedKey, old);
        var sameFuture = old && ['tipo', 'descricao', 'valor_centavos', 'categoria_id', 'natureza', 'forma_pagamento', 'conta_origem_id', 'conta_destino_id', 'data_ocorrencia', 'competencia', 'data_vencimento', 'data_pagamento', 'compra_id', 'parcela_numero', 'parcelas_total', 'fatura_ref', 'status', 'cartao_final', 'id_parcelamento', 'importacao_hash', 'importacao_chave', 'criterio_mes', 'grupo_orcamento_importacao', 'credito_importado', 'valor_estimado', 'mes_fatura'].every(function (field) { return old[field] === future[field]; });
        if (sameFuture) continue;
        replaceTransaction(future, old); receipt.projetados++;
      }
    }
    if (item.aprender) {
      var learned = { estabelecimento: item.descricao_base, categoria_id: item.categoria_id, grupo_orcamento: item.grupo_orcamento };
      var before = learning.get(learned.estabelecimento);
      if (before && (before.categoria_id !== learned.categoria_id || before.grupo_orcamento !== learned.grupo_orcamento)) erro_('REGRA_CONFLITANTE', 'A mesma loja recebeu categorias ou grupos diferentes para aprender.');
      learning.set(learned.estabelecimento, learned);
    }
  });
  learning.forEach(function (rule) {
    var found = rules.filter(function (r) { return impNormalizar_(r.estabelecimento) === rule.estabelecimento; });
    if (found.length > 1) erro_('BANCO_INCONSISTENTE', 'Estabelecimento duplicado nas regras.');
    var old = found[0];
    var same = old && old.ativa === true && old.categoria_id === rule.categoria_id && old.grupo_orcamento === rule.grupo_orcamento;
    if (!same) { stage('Regras_Categorizacao', metadata(Object.assign({ id: old ? old.id : env.uuid(), ativa: true }, rule), old)); receipt.regras_salvas++; }
  });
  return { entidade: 'Importacao', ids: receipt.ids.slice(), mudancas: changes, data: receipt };
}


export { normalizarEntidade_, criarLancamentos_, confirmarLancamento_, cancelarLancamento_, gerarRecorrencias_, calcularDashboard_, calcularProjecao_, listarFaturas_, categoriasPadrao_, configuracoesPadrao_, importarLote_ };
