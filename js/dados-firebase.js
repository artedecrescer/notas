// Acesso a dados via Firebase (Authentication + Cloud Firestore).
import {
  initializeApp, deleteApp, getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, onAuthStateChanged, sendPasswordResetEmail, setPersistence, browserLocalPersistence,
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs,
  writeBatch, serverTimestamp, updatePassword, reauthenticateWithCredential, EmailAuthProvider,
  connectAuthEmulator, connectFirestoreEmulator,
} from '../vendor/firebase.js';
import { planilhaId, novoId, ordenarTurmas, loginParaEmail, ehUsuarioInterno, emailParaLogin, emailVariante, normalizarBackup, alunoParaImportar } from './comum.js';

const ERROS = {
  'auth/invalid-credential': 'E-mail ou senha incorretos.',
  'auth/wrong-password': 'E-mail ou senha incorretos.',
  'auth/user-not-found': 'E-mail ou senha incorretos.',
  'auth/invalid-email': 'E-mail inválido.',
  'auth/email-already-in-use': 'Já existe uma conta com este e-mail ou usuário.',
  'auth/weak-password': 'A senha precisa ter pelo menos 6 caracteres.',
  'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
  'auth/network-request-failed': 'Sem conexão com a internet.',
  'permission-denied': 'Você não tem permissão para esta ação.',
  'unavailable': 'Sem conexão com o servidor. Tente de novo.',
  'auth/requires-recent-login': 'Por segurança, saia e entre de novo antes de trocar a senha.',
  'aluno-com-notas': 'Este aluno tem notas no sistema: registre a saída em vez de apagar o cadastro.',
  'usuario-existente': 'Já existe um acesso com este nome de usuário. Use outro nome ou exclua o acesso antigo.',
  'usuario-com-email': 'Este acesso usa e-mail: use o botão de enviar e-mail para redefinir a senha.',
  'usuario-sem-email': 'Quem entra com nome de usuário não recebe e-mail. Peça à coordenação para cadastrar uma senha nova.',
};
export function msgErro(e) {
  const c = e && (e.code || '').replace(/^firestore\//, '');
  return ERROS[c] || (e && e.message) || 'Erro inesperado.';
}

// opcoes.emulador: modo de teste automático (só em localhost): Auth e Firestore do emulador, nunca o banco real.
export const EMULADOR = { auth: 'http://127.0.0.1:9099', host: '127.0.0.1', firestore: 8085 };
export function criarApiFirebase(config, opcoes = {}) {
  const app = initializeApp(config);
  const auth = getAuth(app);
  if (opcoes.emulador) connectAuthEmulator(auth, EMULADOR.auth, { disableWarnings: true });
  setPersistence(auth, browserLocalPersistence).catch(() => {});
  const db = getFirestore(app);
  if (opcoes.emulador) connectFirestoreEmulator(db, EMULADOR.host, EMULADOR.firestore);
  let usuarioAtual = null;
  let anoAtivo = null; // atualizado sempre que a configuração da escola é lida
  // Ao gravar a turma de um aluno, registra também a matrícula no ano letivo em andamento.
  const comMatricula = d => (d.turmaId && anoAtivo ? { ...d, matriculas: { [anoAtivo]: d.turmaId } } : d);
  let bloquearCallback = false;

  async function lerPerfil(user) {
    if (!user) return null;
    const s = await getDoc(doc(db, 'users', user.uid));
    if (!s.exists()) return { uid: user.uid, email: user.email, semPerfil: true };
    return { uid: user.uid, ...s.data() };
  }

  // Usuário (sem @) -> e-mail da conta atual. Depois de "Gerar nova senha", a conta muda e o mapa aponta para a nova.
  async function resolverLogin(v) {
    const em = loginParaEmail(v);
    if (!ehUsuarioInterno(em)) return em;
    try { const s = await getDoc(doc(db, 'logins', emailParaLogin(em))); if (s.exists() && s.data().email) return s.data().email; } catch (e) { /* sem mapa: usa o padrão */ }
    return em;
  }
  async function criarConta(email, senha) { // app secundário: não desconecta quem está logado
    const sec = initializeApp(config, 'sec-' + Date.now());
    try {
      const secAuth = getAuth(sec);
      if (opcoes.emulador) connectAuthEmulator(secAuth, EMULADOR.auth, { disableWarnings: true });
      const cred = await createUserWithEmailAndPassword(secAuth, email, senha);
      await signOut(secAuth); return cred.user.uid;
    } finally { await deleteApp(sec).catch(() => {}); }
  }

  async function lotes(ops, mesclar = false) { // grava em lotes de até 450 operações
    for (let i = 0; i < ops.length; i += 450) {
      const b = writeBatch(db);
      ops.slice(i, i + 450).forEach(([ref, data]) => (mesclar ? b.set(ref, data, { merge: true }) : b.set(ref, data)));
      await b.commit();
    }
  }

  return {
    modo: 'firebase',
    msgErro,

    onAuth(cb) {
      return onAuthStateChanged(auth, async (user) => {
        usuarioAtual = user;
        if (bloquearCallback) return;
        try { cb(await lerPerfil(user)); } catch (e) { cb({ erro: msgErro(e) }); }
      });
    },
    async recarregarPerfil() { return lerPerfil(auth.currentUser); },
    async login(email, senha) { await signInWithEmailAndPassword(auth, await resolverLogin(email), senha); },
    async logout() { await signOut(auth); },
    async resetSenha(email) {
      const e = loginParaEmail(email);
      if (ehUsuarioInterno(e)) { const er = new Error('sem e-mail'); er.code = 'usuario-sem-email'; throw er; }
      await sendPasswordResetEmail(auth, e);
    },
    async trocarSenha(atual, nova) {
      const u = auth.currentUser;
      await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, atual));
      await updatePassword(u, nova);
    },

    // ---------- primeiro acesso ----------
    async setupFeito() { return (await getDoc(doc(db, 'config', 'setup'))).exists(); },
    async setupInicial({ escola, ano, coordenadora, nome, email, senha }) {
      bloquearCallback = true;
      try {
        const em = loginParaEmail(email);
        const cred = await createUserWithEmailAndPassword(auth, em, senha);
        const uid = cred.user.uid;
        const b = writeBatch(db);
        b.set(doc(db, 'users', uid), { nome, email: em, role: 'admin', turmas: [], ativo: true });
        b.set(doc(db, 'config', 'setup'), { criadoEm: serverTimestamp(), por: uid });
        await b.commit();
        await setDoc(doc(db, 'config', 'escola'), {
          nome: escola, ano: String(ano), coordenadora: coordenadora || '', corte: 6,
          bimestreAtual: 1, travas: { '1': false, '2': false, '3': false, '4': false }, versaoDados: 2,
        });
      } finally { bloquearCallback = false; }
      return lerPerfil(auth.currentUser);
    },

    // ---------- escola ----------
    async getEscola() {
      const s = await getDoc(doc(db, 'config', 'escola')); const e = s.exists() ? s.data() : {};
      if (e.ano) anoAtivo = String(e.ano); return e;
    },
    async listarAnos() { // anos letivos encerrados (arquivo)
      const s = await getDocs(collection(db, 'anos'));
      return s.docs.map(d => ({ ...d.data(), ano: d.id })).sort((a, b) => b.ano.localeCompare(a.ano));
    },
    // Migração única para o formato com ano: COPIA cada planilha antiga (turma__disc__bim) para
    // ANO__turma__disc__bim e registra a matrícula do ano em cada aluno. As antigas não são apagadas.
    // Pode rodar quantas vezes for preciso: só copia o que ainda não existe e confere tudo no fim.
    async migrarParaAnos() {
      if (!anoAtivo) await this.getEscola();
      const ano = anoAtivo; if (!ano) return { copiadas: 0, conferidas: 0 };
      const todas = (await getDocs(collection(db, 'planilhas'))).docs.map(d => ({ id: d.id, ...d.data() }));
      const legado = todas.filter(p => p.id.split('__').length === 3);
      const existentes = new Set(todas.filter(p => p.id.split('__').length === 4).map(p => p.id));
      const ops = [];
      legado.forEach(p => {
        const nid = planilhaId(ano, p.turmaId, p.disc, Number(p.bim));
        if (existentes.has(nid)) return;
        const { id: _, ...d } = p; ops.push([doc(db, 'planilhas', nid), { ...d, ano, bim: Number(p.bim) }]);
      });
      const alunos = (await getDocs(collection(db, 'alunos'))).docs.map(d => ({ id: d.id, ...d.data() }));
      alunos.filter(a => a.turmaId && !(a.matriculas && a.matriculas[ano])).forEach(a => ops.push([doc(db, 'alunos', a.id), { matriculas: { [ano]: a.turmaId } }]));
      if (ops.length) await lotes(ops, true);
      // Conferência: cada planilha antiga tem que ter a cópia com as mesmas notas.
      const depois = new Map((await getDocs(query(collection(db, 'planilhas'), where('ano', '==', ano)))).docs.map(d => [d.id, d.data()]));
      const canon = o => JSON.stringify(Object.keys(o || {}).sort().map(k => [k, Object.keys(o[k] || {}).sort().map(c => [c, o[k][c]])]));
      const diferentes = legado.filter(p => {
        const nid = planilhaId(ano, p.turmaId, p.disc, Number(p.bim));
        if (existentes.has(nid)) return false;            // já existia antes: pode ter sido editada depois, não compara
        const n = depois.get(nid); return !n || canon(n.alunos) !== canon(p.alunos);
      });
      // Tudo conferido: marca a migração como concluída para não reler o banco a cada login da coordenação.
      if (!diferentes.length) await setDoc(doc(db, 'config', 'escola'), { versaoDados: 2 }, { merge: true });
      return { copiadas: ops.length, conferidas: legado.length, diferentes: diferentes.map(p => p.id) };
    },
    async registrarBackup() { await updateDoc(doc(db, 'config', 'escola'), { ultimoBackup: serverTimestamp() }); },
    // Virada do ano letivo: arquiva o ano que termina, grava a nova turma de cada aluno e avança o ano.
    // Tudo num único lote: ou acontece inteiro, ou nada muda. Nenhuma nota é tocada.
    async iniciarAnoLetivo({ novoAno, arquivo, mudancas }) {
      const atual = anoAtivo; if (String(Number(atual) + 1) !== String(novoAno)) throw new Error('Ano inválido.');
      if (mudancas.length > 450) throw new Error('Muitos alunos para um único lote.');
      const b = writeBatch(db);
      b.set(doc(db, 'anos', atual), { ...arquivo, ano: atual, arquivadoEm: serverTimestamp(), arquivadoPor: usuarioAtual.uid });
      mudancas.forEach(m => b.set(doc(db, 'alunos', m.id), {
        turmaId: m.turmaId || '',
        matriculas: { [atual]: m.turmaAnterior, [novoAno]: m.turmaId || '' },
        ...(m.turmaId ? {} : { saida: { ano: atual, motivo: m.motivo || 'Concluiu / saiu na virada do ano' } }),
      }, { merge: true }));
      b.update(doc(db, 'config', 'escola'), { ano: String(novoAno), bimestreAtual: 1, travas: { '1': false, '2': false, '3': false, '4': false } });
      await b.commit(); anoAtivo = String(novoAno);
    },
    async salvarEscola(dados) { await setDoc(doc(db, 'config', 'escola'), dados, { merge: true }); },

    // ---------- turmas ----------
    async listarTurmas() {
      const s = await getDocs(collection(db, 'turmas'));
      return ordenarTurmas(s.docs.map(d => ({ id: d.id, ...d.data() })));
    },
    async salvarTurma(t) {
      const id = t.id || novoId(); const { id: _, ...dados } = t;
      await setDoc(doc(db, 'turmas', id), dados, { merge: true }); return id;
    },
    async excluirTurma(id) { await deleteDoc(doc(db, 'turmas', id)); },

    // ---------- alunos ----------
    async listarAlunos(turmaId) {
      const s = await getDocs(query(collection(db, 'alunos'), where('turmaId', '==', turmaId)));
      return s.docs.map(d => ({ id: d.id, ...d.data() }));
    },
    async salvarAluno(a) {
      const id = a.id || novoId(); const { id: _, ...dados } = a;
      await setDoc(doc(db, 'alunos', id), comMatricula(dados), { merge: true }); return id;
    },
    async salvarAlunosEmLote(lista) {
      await lotes(lista.map(a => { const id = a.id || novoId(); const { id: _, ...d } = a; return [doc(db, 'alunos', id), comMatricula(d)]; }), true);
    },
    async excluirAluno(id) { // só para cadastro feito por engano: recusa se houver qualquer nota do aluno no ano, em qualquer turma
      const pls = (await getDocs(query(collection(db, 'planilhas'), where('ano', '==', anoAtivo)))).docs.map(d => d.data());
      const tem = pls.some(p => { const e = p.alunos && p.alunos[id]; return e && Object.values(e).some(v => v !== null && v !== undefined && v !== ''); });
      if (tem) { const er = new Error('tem notas'); er.code = 'aluno-com-notas'; throw er; }
      await deleteDoc(doc(db, 'alunos', id));
    },
    async listarTodosAlunos() { // coordenação: todos, inclusive quem já saiu
      return (await getDocs(collection(db, 'alunos'))).docs.map(d => ({ id: d.id, ...d.data() }));
    },
    async registrarSaida(id, motivo) {
      await setDoc(doc(db, 'alunos', id), { turmaId: '', saida: { ano: anoAtivo, motivo: motivo || '', em: serverTimestamp() } }, { merge: true });
    },
    async reativarAluno(id, turmaId) {
      await setDoc(doc(db, 'alunos', id), { turmaId, saida: null, matriculas: { [anoAtivo]: turmaId } }, { merge: true });
    },

    // ---------- usuários / professores ----------
    async listarUsuarios() {
      const s = await getDocs(collection(db, 'users'));
      return s.docs.map(d => ({ uid: d.id, ...d.data() }));
    },
    async criarUsuario({ nome, email, senha, role, turmas }) {
      let em = loginParaEmail(email);
      const interno = ehUsuarioInterno(em), login = emailParaLogin(em);
      if (interno) {
        const existentes = (await getDocs(collection(db, 'users'))).docs.map(d => d.data());
        if (existentes.some(u => ehUsuarioInterno(u.email) && emailParaLogin(u.email) === login)) {
          const er = new Error('existente'); er.code = 'usuario-existente'; throw er;
        }
      }
      let uid;
      try { uid = await criarConta(em, senha); } catch (e) {
        // Usuário de um acesso excluído: a conta antiga continua no Firebase, então cria outra com o mesmo nome.
        if (!(interno && e.code === 'auth/email-already-in-use')) throw e;
        em = emailVariante(login); uid = await criarConta(em, senha);
      }
      const b = writeBatch(db);
      b.set(doc(db, 'users', uid), { nome, email: em, role, turmas: turmas || [], ativo: true });
      if (interno) b.set(doc(db, 'logins', login), { email: em, uid });
      await b.commit();
      return uid;
    },
    async novaSenhaUsuario(uid, senha) {
      const s = await getDoc(doc(db, 'users', uid)); const u = s.data();
      if (!ehUsuarioInterno(u.email)) { const er = new Error('com e-mail'); er.code = 'usuario-com-email'; throw er; }
      const login = emailParaLogin(u.email), em = emailVariante(login);
      const novo = await criarConta(em, senha);
      const b = writeBatch(db);
      b.set(doc(db, 'users', novo), { ...u, email: em, uidsAnteriores: [...(u.uidsAnteriores || []), uid] });
      b.delete(doc(db, 'users', uid));
      b.set(doc(db, 'logins', login), { email: em, uid: novo });
      await b.commit();
      return novo;
    },
    async excluirUsuario(uid) {
      const s = await getDoc(doc(db, 'users', uid)); const u = s.exists() ? s.data() : {};
      const b = writeBatch(db);
      b.delete(doc(db, 'users', uid));
      if (ehUsuarioInterno(u.email)) {
        const login = emailParaLogin(u.email), m = await getDoc(doc(db, 'logins', login));
        if (m.exists() && m.data().email === u.email) b.delete(doc(db, 'logins', login));
      }
      await b.commit();
    },
    async atualizarUsuario(uid, dados) { await updateDoc(doc(db, 'users', uid), dados); },

    // ---------- lançamentos (planilhas) ----------
    async getPlanilha(turmaId, disc, bim, ano = anoAtivo) {
      const s = await getDoc(doc(db, 'planilhas', planilhaId(ano, turmaId, disc, bim)));
      return s.exists() ? s.data() : null;
    },
    async salvarLancamento(turmaId, disc, bim, alunoId, valores) { // sempre no ano letivo em andamento
      await setDoc(doc(db, 'planilhas', planilhaId(anoAtivo, turmaId, disc, bim)), {
        ano: anoAtivo, turmaId, disc, bim: Number(bim),
        alunos: { [alunoId]: valores },
        atualizadoPor: usuarioAtual ? usuarioAtual.uid : null,
        atualizadoEm: serverTimestamp(),
      }, { merge: true });
    },
    async getPlanilhasTurma(turmaId, ano = anoAtivo) {
      const s = await getDocs(query(collection(db, 'planilhas'), where('ano', '==', String(ano)), where('turmaId', '==', turmaId)));
      return s.docs.map(d => d.data());
    },
    async getPlanilhasBimestre(bim, ano = anoAtivo) {
      const s = await getDocs(query(collection(db, 'planilhas'), where('ano', '==', String(ano)), where('bim', '==', Number(bim))));
      return s.docs.map(d => d.data());
    },
    async getPlanilhasAno(ano) { // coordenação
      const s = await getDocs(query(collection(db, 'planilhas'), where('ano', '==', String(ano))));
      return s.docs.map(d => d.data());
    },

    // ---------- planejamentos (arquivo guardado em partes dentro do próprio banco) ----------
    async enviarPlanejamento(meta, partes) {
      const id = novoId(); const u = usuarioAtual;
      const b = writeBatch(db);
      b.set(doc(db, 'planejamentos', id), { ...meta, autorUid: u.uid, partes: partes.length, status: 'enviado', comentario: '', enviadoEm: serverTimestamp() });
      partes.forEach((d, i) => b.set(doc(db, 'planejamentos', id, 'partes', String(i)), { d }));
      await b.commit(); return id;
    },
    async listarPlanejamentos(todos) {
      let docs;
      if (todos) docs = (await getDocs(collection(db, 'planejamentos'))).docs;
      else {
        const p = await lerPerfil(usuarioAtual);
        const uids = [usuarioAtual.uid, ...((p && p.uidsAnteriores) || [])];
        docs = (await Promise.all(uids.map(x => getDocs(query(collection(db, 'planejamentos'), where('autorUid', '==', x)))))).flatMap(s => s.docs);
      }
      return docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => ((b.enviadoEm && b.enviadoEm.seconds) || 9e9) - ((a.enviadoEm && a.enviadoEm.seconds) || 9e9));
    },
    async baixarPartes(id, n) {
      const ss = await Promise.all(Array.from({ length: n }, (_, i) => getDoc(doc(db, 'planejamentos', id, 'partes', String(i)))));
      return ss.map(s => (s.exists() ? s.data().d : ''));
    },
    async avaliarPlanejamento(id, dados) {
      await updateDoc(doc(db, 'planejamentos', id), { ...dados, avaliadoEm: serverTimestamp(), avaliadoPor: usuarioAtual.uid });
    },
    async excluirPlanejamento(id, n) {
      const b = writeBatch(db);
      for (let i = 0; i < n; i++) b.delete(doc(db, 'planejamentos', id, 'partes', String(i)));
      b.delete(doc(db, 'planejamentos', id)); await b.commit();
    },

    // ---------- backup ----------
    async exportarTudo() {
      const ler = async (c) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() }));
      const [turmas, alunos, planilhas, users, anos] = await Promise.all([ler('turmas'), ler('alunos'), ler('planilhas'), ler('users'), ler('anos')]);
      const semData = o => { const r = { ...o }; ['atualizadoEm', 'arquivadoEm', 'ultimoBackup'].forEach(k => delete r[k]);
        if (r.saida && r.saida.em) r.saida = { ...r.saida, em: null }; return r; };
      return {
        formato: 'sistema-notas-adc', versao: 2, exportadoEm: new Date().toISOString(),
        escola: semData(await this.getEscola()), anos: anos.map(semData), turmas, alunos: alunos.map(semData), planilhas: planilhas.map(semData),
        professores: users.map(u => ({ nome: u.nome, email: u.email, role: u.role, turmas: u.turmas, ativo: u.ativo })),
      };
    },
    // Importa um backup. Anos encerrados são somente leitura: só entram planilhas que estejam FALTANDO;
    // as que já existem não são tocadas. Planilhas do ano em andamento são mescladas.
    async importarTudo(dados) {
      if (!anoAtivo) await this.getEscola();
      const n = normalizarBackup(dados, anoAtivo);
      const ops = [];
      if (!n.antigo && Object.keys(n.escola).length) await setDoc(doc(db, 'config', 'escola'), n.escola, { merge: true });
      const turmasExist = new Set((await getDocs(collection(db, 'turmas'))).docs.map(d => d.id));
      const alunosExist = new Set((await getDocs(collection(db, 'alunos'))).docs.map(d => d.id));
      n.turmas.forEach(t => { const { id, ...d } = t; if (!n.antigo || !turmasExist.has(id)) ops.push([doc(db, 'turmas', id), d]); });
      n.alunos.forEach(a0 => { const { id, ...d } = alunoParaImportar(a0, alunosExist.has(a0.id), n, anoAtivo); ops.push([doc(db, 'alunos', id), d]); });
      let puladas = 0;
      for (const p of n.planilhas) {
        const { id, ...d } = p;
        if (p.ano !== anoAtivo && (await getDoc(doc(db, 'planilhas', id))).exists()) { puladas++; continue; }
        ops.push([doc(db, 'planilhas', id), d]);
      }
      await lotes(ops, true);
      return { turmas: n.turmas.length, alunos: n.alunos.length, planilhas: n.planilhas.length - puladas, puladas };
    },
  };
}
