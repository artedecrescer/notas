// Constantes e regras compartilhadas pela interface e pelo modo demonstração.

export const DISCIPLINAS = [
  { id: 'portugues',  nome: 'Português' },
  { id: 'matematica', nome: 'Matemática' },
  { id: 'ciencias',   nome: 'Ciências' },
  { id: 'historia',   nome: 'História' },
  { id: 'geografia',  nome: 'Geografia' },
  { id: 'ingles',     nome: 'Inglês' },
  { id: 'artes',      nome: 'Artes' },
  { id: 'edfisica',   nome: 'Ed. Física' },
];
export const NOME_DISC = Object.fromEntries(DISCIPLINAS.map(d => [d.id, d.nome]));
export const BIMESTRES = [1, 2, 3, 4];

export const PERFIS = {
  admin:   'Coordenação / Direção',
  titular: 'Professora titular',
  ingles:  'Professor(a) de Inglês',
};

export const PROVA_MAX = 7;
export const ATV_MAX = 3;

// ---------- permissões (espelham o arquivo firestore.rules) ----------
export function podeEditar(perfil, turmaId, disc) {
  if (!perfil || !perfil.ativo) return false;
  if (perfil.role === 'admin') return true;
  if (perfil.role === 'ingles') return disc === 'ingles';
  if (perfil.role === 'titular') return disc !== 'ingles' && (perfil.turmas || []).includes(turmaId);
  return false;
}
export function podeVer(perfil, turmaId, disc) {
  if (!perfil || !perfil.ativo) return false;
  if (perfil.role === 'admin') return true;
  if (perfil.role === 'ingles') return disc === 'ingles';
  if (perfil.role === 'titular') return (perfil.turmas || []).includes(turmaId);
  return false;
}
export function turmasDoPerfil(perfil, turmas) {
  if (!perfil) return [];
  if (perfil.role === 'admin' || perfil.role === 'ingles') return turmas;
  return turmas.filter(t => (perfil.turmas || []).includes(t.id));
}
export function disciplinasDoPerfil(perfil) {
  if (!perfil) return [];
  if (perfil.role === 'admin') return DISCIPLINAS;
  if (perfil.role === 'ingles') return DISCIPLINAS.filter(d => d.id === 'ingles');
  if (perfil.role === 'titular') return DISCIPLINAS.filter(d => d.id !== 'ingles');
  return [];
}
export function veBoletins(perfil) { return perfil && (perfil.role === 'admin' || perfil.role === 'titular'); }
export function isAdmin(perfil) { return perfil && perfil.role === 'admin' && perfil.ativo; }

// ---------- números (vírgula brasileira) ----------
export function parseNum(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(',', '.');
  if (s === '') return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}
export function parseInt0(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === '') return null;
  const n = parseInt(s, 10);
  return isNaN(n) || n < 0 ? null : n;
}
export function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
export function arred(n) { return Math.round(n * 100) / 100; }
export function fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return '';
  return arred(n).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

// Nota final de um lançamento: prova + atividade; se só houver nota importada, usa ela.
export function notaFinal(e) {
  if (!e) return null;
  const p = parseNum(e.prova), a = parseNum(e.atv);
  if (p !== null && a !== null) return arred(p + a);
  const f = parseNum(e.final);
  return f;
}

// Código de uma planilha de notas: ANO__turma__disciplina__bimestre. O ano faz parte do código,
// então as notas de um ano nunca são sobrescritas pelas do ano seguinte.
export function planilhaId(ano, turmaId, disc, bim) { return `${ano}__${turmaId}__${disc}__${bim}`; }
// Turma do aluno num ano letivo (o histórico fica em aluno.matriculas = { '2026': 'ano1', '2027': 'ano2' }).
export function turmaNoAno(aluno, ano, anoAtivo) {
  const m = (aluno && aluno.matriculas) || {};
  if (m[ano] !== undefined) return m[ano] || null;
  return String(ano) === String(anoAtivo) ? (aluno.turmaId || null) : null;
}

export function novoId() {
  const a = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 16; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

export function ordenarPorNome(lista) {
  return [...lista].sort((x, y) => (x.nome || '').localeCompare(y.nome || '', 'pt-BR', { sensitivity: 'base' }));
}
export function ordenarTurmas(lista) {
  return [...lista].sort((x, y) => (x.ordem ?? 99) - (y.ordem ?? 99) || (x.nome || '').localeCompare(y.nome || '', 'pt-BR'));
}

export function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------- login por usuário (sem e-mail) ----------
// Quem não tem e-mail entra só com o nome de usuário; por baixo vira um e-mail interno.
export const DOMINIO_INTERNO = '@usuarios.artedecrescer.app';
export function loginParaEmail(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return s;
  if (s.includes('@')) return s;
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9._-]/g, '') + DOMINIO_INTERNO;
}
export function emailParaLogin(e) {
  const s = String(e || '');
  return s.endsWith(DOMINIO_INTERNO) ? s.slice(0, -DOMINIO_INTERNO.length).split('+')[0] : s;
}
export const ehUsuarioInterno = e => String(e || '').endsWith(DOMINIO_INTERNO);
// Conta nova para o mesmo usuário (ao gerar nova senha): joao -> joao+k3x9@usuarios...
export const emailVariante = login => loginParaEmail(login).replace(DOMINIO_INTERNO, '+' + Math.random().toString(36).slice(2, 6) + DOMINIO_INTERNO);

// ---------- planejamentos ----------
export const STATUS_PLAN = {
  enviado:  { nome: 'Enviado', cls: 'st-enviado', dica: 'Aguardando a coordenação' },
  visto:    { nome: 'Visto', cls: 'st-visto', dica: 'A coordenação já abriu' },
  aprovado: { nome: 'Aprovado', cls: 'st-aprovado', dica: 'Tudo certo' },
  ajustar:  { nome: 'Ajustar', cls: 'st-ajustar', dica: 'A coordenação pediu ajustes' },
};
export const MAX_ARQUIVO = 6 * 1024 * 1024;      // 6 MB
export const TAM_PARTE = 700 * 1024;             // cada parte vira ~930 KB em base64 (limite do Firestore: 1 MB)
export function tamanhoLegivel(b) { return b < 1024 * 1024 ? Math.max(1, Math.round(b / 1024)) + ' KB' : (b / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' MB'; }
export function bufParaB64(buf) {
  const u = new Uint8Array(buf); let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
export function b64ParaBytes(b64) { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
export async function fatiarArquivo(file) {
  const buf = await file.arrayBuffer(); const partes = [];
  for (let i = 0; i < buf.byteLength; i += TAM_PARTE) partes.push(bufParaB64(buf.slice(i, i + TAM_PARTE)));
  if (!partes.length) partes.push('');
  return partes;
}
export function dataBR(v) {
  const d = v && v.toDate ? v.toDate() : (v ? new Date(v) : null);
  if (!d || isNaN(d)) return '';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// ---------- cópia de segurança ----------
// Converte um backup (formato antigo ou novo) para o formato com ano: planilhas ANO__turma__disc__bim
// e alunos com matriculas. Nada é descartado; o ano do arquivo antigo vem de escola.ano do próprio backup.
export function normalizarBackup(dados, anoAtivo) {
  const anoArq = String((dados.escola && dados.escola.ano) || anoAtivo);
  const planilhas = []; const vistos = new Set();
  // As planilhas já no formato com ano vêm primeiro: se o backup tiver a cópia antiga e a nova, vale a nova.
  const ordem = [...(dados.planilhas || [])].sort((a, b) => (String(b.id || '').split('__').length === 4) - (String(a.id || '').split('__').length === 4));
  ordem.forEach(p => {
    const partes = String(p.id || '').split('__');
    const ano = partes.length === 4 ? partes[0] : String(p.ano || anoArq);
    const id = planilhaId(ano, p.turmaId, p.disc, Number(p.bim));
    if (vistos.has(id)) return; vistos.add(id);
    const { id: _, ...d } = p;
    planilhas.push({ id, ...d, ano, bim: Number(d.bim) });
  });
  const alunos = (dados.alunos || []).map(a => {
    const m = { ...(a.matriculas || {}) };
    if (a.turmaId && m[anoArq] === undefined) m[anoArq] = a.turmaId;
    return { ...a, matriculas: m };
  });
  const escola = { ...(dados.escola || {}) }; delete escola.ano; // o ano letivo só muda pela virada de ano
  return { escola, turmas: dados.turmas || [], alunos, planilhas, anos: dados.anos || [], anoArq, antigo: anoArq !== String(anoAtivo) };
}
// Backup de um ano anterior não pode mexer no ano em andamento: não muda turma, ordem nem dados da escola.
// De quem já existe, só acrescenta o histórico de matrículas; quem não existe volta como "saiu".
export function alunoParaImportar(a, existente, n, anoAtivo) {
  if (!n.antigo) return a;
  const matriculas = { ...(a.matriculas || {}) }; delete matriculas[String(anoAtivo)];
  if (existente) return { id: a.id, matriculas };
  return { ...a, matriculas, turmaId: '', saida: { ano: n.anoArq, motivo: 'restaurado de cópia de segurança' } };
}
