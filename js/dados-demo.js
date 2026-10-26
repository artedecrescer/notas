// MODO DEMONSTRAÇÃO — mesma interface do Firebase, mas tudo fica no navegador.
// Dados 100% fictícios. Aplica as mesmas permissões das regras do servidor.
import { planilhaId, novoId, ordenarTurmas, podeEditar, podeVer, DISCIPLINAS, loginParaEmail, ehUsuarioInterno, normalizarBackup, alunoParaImportar } from './comum.js';

const KEY = 'sistema-notas-demo-v2';
const SENHA = 'demo123';

function erro(code, message) { const e = new Error(message || code); e.code = code; return e; }

function semear() {
  const turmas = ['1º ano', '2º ano', '3º ano', '4º ano', '5º ano'].map((nome, i) => ({
    id: 'turma' + (i + 1), nome, ordem: i + 1, professora: ['ANA PAULA', 'BEATRIZ', 'CAROLINA', 'DANIELA', 'DANIELA'][i],
  }));
  const nomes = {
    turma1: ['ALICE MORAES', 'BENTO CARDOSO', 'CECÍLIA ROCHA', 'DAVI MENEZES', 'ELISA FARIAS'],
    turma2: ['FELIPE ARAÚJO', 'GIOVANA PIRES', 'HEITOR LIMA', 'ISIS TEIXEIRA'],
    turma3: ['JÚLIA CAMPOS', 'KAUÃ RIBEIRO', 'LARA MENDES', 'MIGUEL SOARES'],
    turma4: ['NINA BARROS', 'OTÁVIO REIS', 'PIETRA LOPES'],
    turma5: ['RAFAEL DUARTE', 'SOFIA NUNES', 'TOMÁS VIANA'],
  };
  const alunos = [];
  Object.entries(nomes).forEach(([turmaId, lista]) => lista.forEach((nome, i) => alunos.push({ id: novoId(), nome, turmaId, ordem: i, matriculas: { '2026': turmaId } })));
  // Quem estava no 1º ano em 2025 passou para o 2º ano em 2026; e um aluno se transferiu no fim de 2025.
  alunos.filter(a => a.turmaId === 'turma2').forEach(a => { a.matriculas['2025'] = 'turma1'; });
  alunos.push({ id: 'transferido', nome: 'ZECA TRANSFERIDO', turmaId: '', ordem: 9, matriculas: { '2025': 'turma1' }, saida: { ano: '2025', motivo: 'Transferência' } });
  // Notas fictícias do 1º e 2º bimestre para mostrar o boletim
  const planilhas = {};
  const rnd = (a, b) => Math.round((a + Math.random() * (b - a)) * 4) / 4;
  turmas.forEach(t => DISCIPLINAS.forEach(d => [1, 2].forEach(bim => {
    const al = {};
    alunos.filter(a => a.turmaId === t.id).forEach(a => {
      al[a.id] = { prova: rnd(4.5, 7), atv: rnd(1.5, 3), faltas: Math.random() < 0.25 ? 1 + Math.floor(Math.random() * 3) : 0, obs: '' };
    });
    planilhas[planilhaId('2026', t.id, d.id, bim)] = { ano: '2026', turmaId: t.id, disc: d.id, bim, alunos: al };
  })));
  // Ano encerrado de 2025 (somente consulta): 1º ano completo
  DISCIPLINAS.forEach(d => [1, 2, 3, 4].forEach(bim => {
    const al = {};
    alunos.filter(a => a.matriculas['2025'] === 'turma1').forEach(a => { al[a.id] = { final: rnd(6, 10), faltas: 0 }; });
    planilhas[planilhaId('2025', 'turma1', d.id, bim)] = { ano: '2025', turmaId: 'turma1', disc: d.id, bim, alunos: al };
  }));
  const anos = { '2025': { ano: '2025', escola: { nome: 'Escola Demonstração', coordenadora: 'COORDENAÇÃO DEMO', corte: 6 },
    turmas: Object.fromEntries(turmas.map(t => [t.id, { nome: t.nome, professora: 'PROFESSORA DE 2025' }])),
    travas: { '1': true, '2': true, '3': true, '4': true }, arquivadoEm: '2026-01-20T12:00:00Z' } };
  const users = {
    'u-coord':   { nome: 'Coordenação (demo)', email: 'coordenacao@demo.escola', role: 'admin',   turmas: [],         ativo: true },
    'u-titular': { nome: 'Titular do 1º ano (demo)', email: 'titular@demo.escola', role: 'titular', turmas: ['turma1'], ativo: true },
    'u-ingles':  { nome: 'Professor de Inglês (demo)', email: 'ingles@demo.escola', role: 'ingles',  turmas: [],         ativo: true },
  };
  return {
    escola: { nome: 'Escola Demonstração', ano: '2026', coordenadora: 'COORDENAÇÃO DEMO', corte: 6, bimestreAtual: 3,
              travas: { '1': true, '2': false, '3': false, '4': false } },
    turmas: Object.fromEntries(turmas.map(t => [t.id, t])),
    alunos: Object.fromEntries(alunos.map(a => [a.id, a])),
    planilhas, anos, users, planejamentos: {}, partes: {}, senhas: Object.fromEntries(Object.values(users).map(u => [u.email, SENHA])), sessao: null,
  };
}

export function criarApiDemo() {
  let st;
  try { st = JSON.parse(localStorage.getItem(KEY)); } catch (e) { st = null; }
  if (!st || !st.users) st = semear();
  const salvar = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} };
  salvar();
  let ouvinte = null;
  const atraso = () => new Promise(r => setTimeout(r, 120));
  const perfilAtual = () => (st.sessao && st.users[st.sessao]) ? { uid: st.sessao, ...st.users[st.sessao] } : null;
  const exigirAdmin = () => { const p = perfilAtual(); if (!p || p.role !== 'admin' || !p.ativo) throw erro('permission-denied'); };
  const notificar = () => ouvinte && ouvinte(perfilAtual());
  const gravarAluno = (id, a) => {
    const atual = st.alunos[id] || {}; const novo = { ...atual, ...a, id };
    if (a.turmaId) novo.matriculas = { ...(atual.matriculas || {}), [st.escola.ano]: a.turmaId };
    st.alunos[id] = novo;
  };
  const anoAt = () => String(st.escola.ano);
  const podeVerAno = (p, ano) => p && (p.role === 'admin' || String(ano) === anoAt());

  return {
    modo: 'demo',
    msgErro(e) {
      const m = { 'auth/invalid-credential': 'E-mail ou senha incorretos.', 'permission-denied': 'Você não tem permissão para esta ação.',
                  'auth/email-already-in-use': 'Já existe uma conta com este e-mail ou usuário.', 'auth/weak-password': 'A senha precisa ter pelo menos 6 caracteres.',
                  'usuario-sem-email': 'Quem entra com nome de usuário não recebe e-mail. Peça à coordenação para cadastrar uma senha nova.' };
      return m[e && e.code] || (e && e.message) || 'Erro inesperado.';
    },
    contasDemo: [
      { rotulo: 'Coordenação / Direção', email: 'coordenacao@demo.escola' },
      { rotulo: 'Titular do 1º ano', email: 'titular@demo.escola' },
      { rotulo: 'Professor de Inglês', email: 'ingles@demo.escola' },
    ],
    senhaDemo: SENHA,
    resetarDemo() { st = semear(); salvar(); notificar(); },

    onAuth(cb) { ouvinte = cb; setTimeout(notificar, 0); return () => { ouvinte = null; }; },
    async recarregarPerfil() { return perfilAtual(); },
    async login(email, senha) {
      await atraso();
      const e = loginParaEmail(email);
      if (st.senhas[e] !== senha) throw erro('auth/invalid-credential');
      const uid = Object.keys(st.users).find(k => st.users[k].email === e);
      st.sessao = uid; salvar(); notificar();
    },
    async logout() { st.sessao = null; salvar(); notificar(); },
    async resetSenha(email) { await atraso(); if (ehUsuarioInterno(loginParaEmail(email))) throw erro('usuario-sem-email'); },
    async trocarSenha(atual, nova) {
      const p = perfilAtual(); if (st.senhas[p.email] !== atual) throw erro('auth/invalid-credential', 'Senha atual incorreta.');
      if (!nova || nova.length < 6) throw erro('auth/weak-password'); st.senhas[p.email] = nova; salvar();
    },
    async setupFeito() { return true; },
    async setupInicial() { throw erro('demo', 'Não disponível no modo demonstração.'); },

    async getEscola() { return { ...st.escola }; },
    async salvarEscola(d) { exigirAdmin(); if (d.ano && String(d.ano) !== String(st.escola.ano)) throw erro('permission-denied'); st.escola = { ...st.escola, ...d }; salvar(); },
    async listarAnos() { exigirAdmin(); return Object.values(st.anos || {}).sort((a, b) => b.ano.localeCompare(a.ano)); },
    async registrarBackup() { exigirAdmin(); st.escola.ultimoBackup = new Date().toISOString(); salvar(); },
    async iniciarAnoLetivo({ novoAno, arquivo, mudancas }) {
      exigirAdmin(); const atual = String(st.escola.ano);
      if (String(Number(atual) + 1) !== String(novoAno) || (st.anos || {})[atual]) throw erro('permission-denied');
      st.anos = st.anos || {}; st.anos[atual] = { ...arquivo, ano: atual, arquivadoEm: new Date().toISOString() };
      mudancas.forEach(m => { const a = st.alunos[m.id]; a.matriculas = { ...(a.matriculas || {}), [atual]: m.turmaAnterior, [novoAno]: m.turmaId || '' };
        a.turmaId = m.turmaId || ''; if (!m.turmaId) a.saida = { ano: atual, motivo: m.motivo || 'Concluiu / saiu na virada do ano' }; });
      st.escola = { ...st.escola, ano: String(novoAno), bimestreAtual: 1, travas: { '1': false, '2': false, '3': false, '4': false } }; salvar();
    },

    async listarTurmas() { await atraso(); return ordenarTurmas(Object.values(st.turmas)); },
    async salvarTurma(t) { exigirAdmin(); const id = t.id || novoId(); st.turmas[id] = { ...(st.turmas[id] || {}), ...t, id }; salvar(); return id; },
    async excluirTurma(id) { exigirAdmin(); delete st.turmas[id]; salvar(); },

    async listarAlunos(turmaId) {
      await atraso(); const p = perfilAtual();
      if (!p || !(p.role !== 'titular' || p.turmas.includes(turmaId))) throw erro('permission-denied');
      return Object.values(st.alunos).filter(a => a.turmaId === turmaId);
    },
    async salvarAluno(a) { exigirAdmin(); const id = a.id || novoId(); gravarAluno(id, a); salvar(); return id; },
    async salvarAlunosEmLote(lista) { exigirAdmin(); lista.forEach(a => gravarAluno(a.id || novoId(), a)); salvar(); },
    async excluirAluno(id) {
      exigirAdmin(); const m = Object.keys((st.alunos[id] || {}).matriculas || {});
      if (m.some(x => x !== String(st.escola.ano))) throw erro('permission-denied'); delete st.alunos[id]; salvar();
    },
    async listarTodosAlunos() { exigirAdmin(); return Object.values(st.alunos).map(a => ({ ...a })); },
    async registrarSaida(id, motivo) { exigirAdmin(); Object.assign(st.alunos[id], { turmaId: '', saida: { ano: String(st.escola.ano), motivo: motivo || '' } }); salvar(); },
    async reativarAluno(id, turmaId) { exigirAdmin(); const a = st.alunos[id]; a.turmaId = turmaId; a.saida = null; a.matriculas = { ...(a.matriculas || {}), [st.escola.ano]: turmaId }; salvar(); },

    async listarUsuarios() { exigirAdmin(); return Object.entries(st.users).map(([uid, u]) => ({ uid, ...u })); },
    async criarUsuario({ nome, email, senha, role, turmas }) {
      exigirAdmin(); const e = loginParaEmail(email);
      if (st.senhas[e]) throw erro('auth/email-already-in-use');
      if (!senha || senha.length < 6) throw erro('auth/weak-password');
      const uid = 'u-' + novoId(); st.users[uid] = { nome, email: e, role, turmas: turmas || [], ativo: true }; st.senhas[e] = senha; salvar(); return uid;
    },
    async atualizarUsuario(uid, d) { exigirAdmin(); st.users[uid] = { ...st.users[uid], ...d }; salvar(); },
    async novaSenhaUsuario(uid, senha) {
      exigirAdmin(); await atraso(); const u = st.users[uid];
      if (!ehUsuarioInterno(u.email)) throw erro('usuario-com-email');
      if (!senha || senha.length < 6) throw erro('auth/weak-password');
      st.senhas[u.email] = senha; salvar(); return uid;
    },
    async excluirUsuario(uid) { exigirAdmin(); const u = st.users[uid]; delete st.users[uid]; if (u) delete st.senhas[u.email]; salvar(); },

    async getPlanilha(turmaId, disc, bim, ano = anoAt()) {
      await atraso(); const pf = perfilAtual(); if (!podeVer(pf, turmaId, disc) || !podeVerAno(pf, ano)) throw erro('permission-denied');
      const p = st.planilhas[planilhaId(ano, turmaId, disc, bim)]; return p ? JSON.parse(JSON.stringify(p)) : null;
    },
    async salvarLancamento(turmaId, disc, bim, alunoId, valores) {
      const p = perfilAtual();
      if (!podeEditar(p, turmaId, disc)) throw erro('permission-denied');
      if (p.role !== 'admin' && st.escola.travas && st.escola.travas[String(bim)]) throw erro('permission-denied', 'Bimestre fechado pela coordenação.');
      const id = planilhaId(anoAt(), turmaId, disc, bim);
      const pl = st.planilhas[id] || { ano: anoAt(), turmaId, disc, bim: Number(bim), alunos: {} };
      pl.alunos[alunoId] = { ...(pl.alunos[alunoId] || {}), ...valores };
      pl.atualizadoPor = p.uid; st.planilhas[id] = pl; salvar();
    },
    async getPlanilhasTurma(turmaId, ano = anoAt()) {
      await atraso(); const p = perfilAtual();
      if (!p || !(p.role === 'admin' || (p.role === 'titular' && p.turmas.includes(turmaId))) || !podeVerAno(p, ano)) throw erro('permission-denied');
      return Object.values(st.planilhas).filter(x => x.turmaId === turmaId && String(x.ano) === String(ano)).map(x => JSON.parse(JSON.stringify(x)));
    },
    async getPlanilhasBimestre(bim, ano = anoAt()) { exigirAdmin(); return Object.values(st.planilhas).filter(x => x.bim === Number(bim) && String(x.ano) === String(ano)); },
    async getPlanilhasAno(ano) { exigirAdmin(); return Object.values(st.planilhas).filter(x => String(x.ano) === String(ano)); },

    async enviarPlanejamento(meta, partes) {
      await atraso(); const p = perfilAtual(); if (!p || !p.ativo) throw erro('permission-denied');
      const id = novoId();
      st.planejamentos = st.planejamentos || {}; st.partes = st.partes || {};
      st.planejamentos[id] = { ...meta, autorUid: p.uid, partes: partes.length, status: 'enviado', comentario: '', enviadoEm: new Date().toISOString() };
      st.partes[id] = partes;
      try { salvar(); localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { delete st.planejamentos[id]; delete st.partes[id]; throw erro('demo', 'No modo demonstração o navegador só guarda arquivos pequenos.'); }
      return id;
    },
    async listarPlanejamentos(todos) {
      await atraso(); const p = perfilAtual(); if (todos) exigirAdmin();
      return Object.entries(st.planejamentos || {}).map(([id, x]) => ({ id, ...x })).filter(x => todos || x.autorUid === p.uid)
        .sort((a, b) => String(b.enviadoEm).localeCompare(String(a.enviadoEm)));
    },
    async baixarPartes(id) {
      const p = perfilAtual(), x = (st.planejamentos || {})[id];
      if (!x || !(p.role === 'admin' || x.autorUid === p.uid)) throw erro('permission-denied');
      return st.partes[id] || [];
    },
    async avaliarPlanejamento(id, d) { exigirAdmin(); st.planejamentos[id] = { ...st.planejamentos[id], ...d, avaliadoEm: new Date().toISOString() }; salvar(); },
    async excluirPlanejamento(id) {
      const p = perfilAtual(), x = st.planejamentos[id];
      if (!(p.role === 'admin' || (x.autorUid === p.uid && x.status === 'enviado'))) throw erro('permission-denied');
      delete st.planejamentos[id]; delete st.partes[id]; salvar();
    },

    async exportarTudo() {
      exigirAdmin();
      return { formato: 'sistema-notas-adc', versao: 2, exportadoEm: new Date().toISOString(), escola: st.escola, anos: Object.values(st.anos || {}),
        turmas: Object.values(st.turmas), alunos: Object.values(st.alunos),
        planilhas: Object.entries(st.planilhas).map(([id, p]) => ({ id, ...p })),
        professores: Object.values(st.users).map(u => ({ nome: u.nome, email: u.email, role: u.role, turmas: u.turmas, ativo: u.ativo })) };
    },
    async migrarParaAnos() { return { copiadas: 0, conferidas: 0, diferentes: [] }; },
    async importarTudo(d) {
      exigirAdmin(); const n = normalizarBackup(d, anoAt());
      if (!n.antigo) st.escola = { ...st.escola, ...n.escola };
      n.turmas.forEach(t => { if (!n.antigo || !st.turmas[t.id]) st.turmas[t.id] = { ...(st.turmas[t.id] || {}), ...t }; });
      n.alunos.forEach(a0 => { const ex = st.alunos[a0.id], a = alunoParaImportar(a0, !!ex, n, anoAt());
        st.alunos[a.id] = { ...(ex || {}), ...a, matriculas: { ...((ex && ex.matriculas) || {}), ...(a.matriculas || {}) } }; });
      let puladas = 0;
      n.planilhas.forEach(p => { const { id, ...r } = p; if (r.ano !== anoAt() && st.planilhas[id]) { puladas++; return; } st.planilhas[id] = r; });
      salvar();
      return { turmas: n.turmas.length, alunos: n.alunos.length, planilhas: n.planilhas.length - puladas, puladas };
    },
  };
}
