// Acesso a dados via Firebase (Authentication + Cloud Firestore).
import {
  initializeApp, deleteApp, getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, onAuthStateChanged, sendPasswordResetEmail, setPersistence, browserLocalPersistence,
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs,
  writeBatch, serverTimestamp, updatePassword, reauthenticateWithCredential, EmailAuthProvider,
} from '../vendor/firebase.js';
import { planilhaId, novoId, ordenarTurmas, loginParaEmail, ehUsuarioInterno } from './comum.js';

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
  'usuario-sem-email': 'Quem entra com nome de usuário não recebe e-mail. Peça à coordenação para cadastrar uma senha nova.',
};
export function msgErro(e) {
  const c = e && (e.code || '').replace(/^firestore\//, '');
  return ERROS[c] || (e && e.message) || 'Erro inesperado.';
}

export function criarApiFirebase(config) {
  const app = initializeApp(config);
  const auth = getAuth(app);
  setPersistence(auth, browserLocalPersistence).catch(() => {});
  const db = getFirestore(app);
  let usuarioAtual = null;
  let bloquearCallback = false;

  async function lerPerfil(user) {
    if (!user) return null;
    const s = await getDoc(doc(db, 'users', user.uid));
    if (!s.exists()) return { uid: user.uid, email: user.email, semPerfil: true };
    return { uid: user.uid, ...s.data() };
  }

  async function lotes(ops) { // grava em lotes de até 450 operações
    for (let i = 0; i < ops.length; i += 450) {
      const b = writeBatch(db);
      ops.slice(i, i + 450).forEach(([ref, data]) => b.set(ref, data));
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
    async login(email, senha) { await signInWithEmailAndPassword(auth, loginParaEmail(email), senha); },
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
          bimestreAtual: 1, travas: { '1': false, '2': false, '3': false, '4': false },
        });
      } finally { bloquearCallback = false; }
      return lerPerfil(auth.currentUser);
    },

    // ---------- escola ----------
    async getEscola() { const s = await getDoc(doc(db, 'config', 'escola')); return s.exists() ? s.data() : {}; },
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
      await setDoc(doc(db, 'alunos', id), dados, { merge: true }); return id;
    },
    async salvarAlunosEmLote(lista) {
      await lotes(lista.map(a => { const id = a.id || novoId(); const { id: _, ...d } = a; return [doc(db, 'alunos', id), d]; }));
    },
    async excluirAluno(id) { await deleteDoc(doc(db, 'alunos', id)); },

    // ---------- usuários / professores ----------
    async listarUsuarios() {
      const s = await getDocs(collection(db, 'users'));
      return s.docs.map(d => ({ uid: d.id, ...d.data() }));
    },
    async criarUsuario({ nome, email, senha, role, turmas }) {
      // App secundário: cria a conta sem desconectar quem está logado.
      const sec = initializeApp(config, 'sec-' + Date.now());
      try {
        const secAuth = getAuth(sec);
        const em = loginParaEmail(email);
        const cred = await createUserWithEmailAndPassword(secAuth, em, senha);
        await signOut(secAuth);
        await setDoc(doc(db, 'users', cred.user.uid), {
          nome, email: em, role, turmas: turmas || [], ativo: true,
        });
        return cred.user.uid;
      } finally { await deleteApp(sec).catch(() => {}); }
    },
    async atualizarUsuario(uid, dados) { await updateDoc(doc(db, 'users', uid), dados); },

    // ---------- lançamentos (planilhas) ----------
    async getPlanilha(turmaId, disc, bim) {
      const s = await getDoc(doc(db, 'planilhas', planilhaId(turmaId, disc, bim)));
      return s.exists() ? s.data() : null;
    },
    async salvarLancamento(turmaId, disc, bim, alunoId, valores) {
      await setDoc(doc(db, 'planilhas', planilhaId(turmaId, disc, bim)), {
        turmaId, disc, bim: Number(bim),
        alunos: { [alunoId]: valores },
        atualizadoPor: usuarioAtual ? usuarioAtual.uid : null,
        atualizadoEm: serverTimestamp(),
      }, { merge: true });
    },
    async getPlanilhasTurma(turmaId) {
      const s = await getDocs(query(collection(db, 'planilhas'), where('turmaId', '==', turmaId)));
      return s.docs.map(d => d.data());
    },
    async getPlanilhasBimestre(bim) {
      const s = await getDocs(query(collection(db, 'planilhas'), where('bim', '==', Number(bim))));
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
      const q = todos ? collection(db, 'planejamentos') : query(collection(db, 'planejamentos'), where('autorUid', '==', usuarioAtual.uid));
      const s = await getDocs(q);
      return s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => ((b.enviadoEm && b.enviadoEm.seconds) || 9e9) - ((a.enviadoEm && a.enviadoEm.seconds) || 9e9));
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
      const [turmas, alunos, planilhas, users] = await Promise.all([ler('turmas'), ler('alunos'), ler('planilhas'), ler('users')]);
      planilhas.forEach(p => { delete p.atualizadoEm; });
      return {
        formato: 'sistema-notas-adc', versao: 1, exportadoEm: new Date().toISOString(),
        escola: await this.getEscola(), turmas, alunos, planilhas,
        professores: users.map(u => ({ nome: u.nome, email: u.email, role: u.role, turmas: u.turmas, ativo: u.ativo })),
      };
    },
    async importarTudo(dados) {
      const ops = [];
      if (dados.escola) await setDoc(doc(db, 'config', 'escola'), dados.escola, { merge: true });
      (dados.turmas || []).forEach(t => { const { id, ...d } = t; ops.push([doc(db, 'turmas', id), d]); });
      (dados.alunos || []).forEach(a => { const { id, ...d } = a; ops.push([doc(db, 'alunos', id), d]); });
      (dados.planilhas || []).forEach(p => {
        const { id, ...d } = p;
        ops.push([doc(db, 'planilhas', id || planilhaId(d.turmaId, d.disc, d.bim)), { ...d, bim: Number(d.bim) }]);
      });
      await lotes(ops);
      return { turmas: (dados.turmas || []).length, alunos: (dados.alunos || []).length, planilhas: (dados.planilhas || []).length };
    },
  };
}
