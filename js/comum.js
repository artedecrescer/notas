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

export function planilhaId(turmaId, disc, bim) { return `${turmaId}__${disc}__${bim}`; }

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
