// MODO DEMONSTRAÇÃO — mesma interface do Firebase, mas tudo fica no navegador.
// Dados 100% fictícios. Aplica as mesmas permissões das regras do servidor.
import { planilhaId, novoId, ordenarTurmas, podeEditar, podeVer, DISCIPLINAS, loginParaEmail, ehUsuarioInterno } from './comum.js';

const KEY = 'sistema-notas-demo-v1';
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
  Object.entries(nomes).forEach(([turmaId, lista]) => lista.forEach((nome, i) => alunos.push({ id: novoId(), nome, turmaId, ordem: i })));
  // Notas fictícias do 1º e 2º bimestre para mostrar o boletim
  const planilhas = {};
  const rnd = (a, b) => Math.round((a + Math.random() * (b - a)) * 4) / 4;
  turmas.forEach(t => DISCIPLINAS.forEach(d => [1, 2].forEach(bim => {
    const al = {};
    alunos.filter(a => a.turmaId === t.id).forEach(a => {
      al[a.id] = { prova: rnd(4.5, 7), atv: rnd(1.5, 3), faltas: Math.random() < 0.25 ? 1 + Math.floor(Math.random() * 3) : 0, obs: '' };
    });
    planilhas[planilhaId(t.id, d.id, bim)] = { turmaId: t.id, disc: d.id, bim, alunos: al };
  })));
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
    planilhas, users, planejamentos: {}, partes: {}, senhas: Object.fromEntries(Object.values(users).map(u => [u.email, SENHA])), sessao: null,
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
    async salvarEscola(d) { exigirAdmin(); st.escola = { ...st.escola, ...d }; salvar(); },

    async listarTurmas() { await atraso(); return ordenarTurmas(Object.values(st.turmas)); },
    async salvarTurma(t) { exigirAdmin(); const id = t.id || novoId(); st.turmas[id] = { ...(st.turmas[id] || {}), ...t, id }; salvar(); return id; },
    async excluirTurma(id) { exigirAdmin(); delete st.turmas[id]; salvar(); },

    async listarAlunos(turmaId) {
      await atraso(); const p = perfilAtual();
      if (!p || !(p.role !== 'titular' || p.turmas.includes(turmaId))) throw erro('permission-denied');
      return Object.values(st.alunos).filter(a => a.turmaId === turmaId);
    },
    async salvarAluno(a) { exigirAdmin(); const id = a.id || novoId(); st.alunos[id] = { ...(st.alunos[id] || {}), ...a, id }; salvar(); return id; },
    async salvarAlunosEmLote(lista) { exigirAdmin(); lista.forEach(a => { const id = a.id || novoId(); st.alunos[id] = { ...(st.alunos[id] || {}), ...a, id }; }); salvar(); },
    async excluirAluno(id) { exigirAdmin(); delete st.alunos[id]; salvar(); },

    async listarUsuarios() { exigirAdmin(); return Object.entries(st.users).map(([uid, u]) => ({ uid, ...u })); },
    async criarUsuario({ nome, email, senha, role, turmas }) {
      exigirAdmin(); const e = loginParaEmail(email);
      if (st.senhas[e]) throw erro('auth/email-already-in-use');
      if (!senha || senha.length < 6) throw erro('auth/weak-password');
      const uid = 'u-' + novoId(); st.users[uid] = { nome, email: e, role, turmas: turmas || [], ativo: true }; st.senhas[e] = senha; salvar(); return uid;
    },
    async atualizarUsuario(uid, d) { exigirAdmin(); st.users[uid] = { ...st.users[uid], ...d }; salvar(); },

    async getPlanilha(turmaId, disc, bim) {
      await atraso(); if (!podeVer(perfilAtual(), turmaId, disc)) throw erro('permission-denied');
      const p = st.planilhas[planilhaId(turmaId, disc, bim)]; return p ? JSON.parse(JSON.stringify(p)) : null;
    },
    async salvarLancamento(turmaId, disc, bim, alunoId, valores) {
      const p = perfilAtual();
      if (!podeEditar(p, turmaId, disc)) throw erro('permission-denied');
      if (p.role !== 'admin' && st.escola.travas && st.escola.travas[String(bim)]) throw erro('permission-denied', 'Bimestre fechado pela coordenação.');
      const id = planilhaId(turmaId, disc, bim);
      const pl = st.planilhas[id] || { turmaId, disc, bim: Number(bim), alunos: {} };
      pl.alunos[alunoId] = { ...(pl.alunos[alunoId] || {}), ...valores };
      pl.atualizadoPor = p.uid; st.planilhas[id] = pl; salvar();
    },
    async getPlanilhasTurma(turmaId) {
      await atraso(); const p = perfilAtual();
      if (!p || !(p.role === 'admin' || (p.role === 'titular' && p.turmas.includes(turmaId)))) throw erro('permission-denied');
      return Object.values(st.planilhas).filter(x => x.turmaId === turmaId).map(x => JSON.parse(JSON.stringify(x)));
    },
    async getPlanilhasBimestre(bim) { exigirAdmin(); return Object.values(st.planilhas).filter(x => x.bim === Number(bim)); },

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
      return { formato: 'sistema-notas-adc', versao: 1, exportadoEm: new Date().toISOString(), escola: st.escola,
        turmas: Object.values(st.turmas), alunos: Object.values(st.alunos),
        planilhas: Object.entries(st.planilhas).map(([id, p]) => ({ id, ...p })),
        professores: Object.values(st.users).map(u => ({ nome: u.nome, email: u.email, role: u.role, turmas: u.turmas, ativo: u.ativo })) };
    },
    async importarTudo(d) {
      exigirAdmin();
      if (d.escola) st.escola = { ...st.escola, ...d.escola };
      (d.turmas || []).forEach(t => { st.turmas[t.id] = t; });
      (d.alunos || []).forEach(a => { st.alunos[a.id] = a; });
      (d.planilhas || []).forEach(p => { const id = p.id || planilhaId(p.turmaId, p.disc, p.bim); const { id: _, ...r } = p; st.planilhas[id] = { ...r, bim: Number(r.bim) }; });
      salvar();
      return { turmas: (d.turmas || []).length, alunos: (d.alunos || []).length, planilhas: (d.planilhas || []).length };
    },
  };
}
