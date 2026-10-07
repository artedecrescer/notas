// Sistema de Notas e Boletins — interface
import { firebaseConfig } from './firebase-config.js';
import {
  DISCIPLINAS, NOME_DISC, BIMESTRES, PERFIS, PROVA_MAX, ATV_MAX, podeEditar, turmasDoPerfil,
  disciplinasDoPerfil, veBoletins, isAdmin, parseNum, parseInt0, clamp, fmt, notaFinal, esc,
} from './comum.js';
import { gerarBoletinsPDF, linhasBoletim, indexarPlanilhas } from './boletim.js';

const params = new URLSearchParams(location.search);
const configurado = !!(firebaseConfig && firebaseConfig.apiKey && !String(firebaseConfig.apiKey).includes('COLE_AQUI'));
const api = (configurado && !params.has('demo'))
  ? (await import('./dados-firebase.js')).criarApiFirebase(firebaseConfig)
  : (await import('./dados-demo.js')).criarApiDemo();

const S = {
  perfil: null, escola: {}, turmas: [], setupFeito: true,
  view: 'lancar', sub: 'turmas',
  lanc: { turmaId: null, disc: null, bim: null },
  bol: { turmaId: null, alunoId: null, obs: false },
  pend: { bim: null },
  cadTurma: null,
  alunosCache: {},
};
let LOGO = null;
const fila = { p: Promise.resolve(), pend: 0 };

// ---------------- utilidades ----------------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
let tt;
function toast(m, tipo = 'ok') { const el = $('#toast'); el.textContent = m; el.className = 'toast show ' + tipo; clearTimeout(tt); tt = setTimeout(() => (el.className = 'toast'), 3600); }
function baixar(nome, blob) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000); }
function slug(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, ''); }
function fmtIn(v) { const n = parseNum(v); return n === null ? '' : fmt(n); }
function corte() { const c = parseNum(S.escola.corte); return c === null ? 6 : c; }
function senhaAleatoria() { const a = 'abcdefghjkmnpqrstuvwxyz23456789'; let s = ''; for (let i = 0; i < 8; i++) s += a[Math.floor(Math.random() * a.length)]; return s; }
function carregarXLSX() {
  if (window.XLSX) return Promise.resolve();
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/xlsx.full.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
}
async function carregarLogo() {
  try { const r = await fetch('img/logo.png'); const b = await r.blob(); LOGO = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); }); } catch (e) { LOGO = null; }
}
window.addEventListener('beforeunload', e => { if (fila.pend > 0) { e.preventDefault(); e.returnValue = ''; } });

// ---------------- dados base ----------------
async function carregarBase() {
  S.escola = (await api.getEscola()) || {};
  S.turmas = await api.listarTurmas();
  S.alunosCache = {};
  const ts = turmasDoPerfil(S.perfil, S.turmas), ds = disciplinasDoPerfil(S.perfil);
  if (!ts.find(t => t.id === S.lanc.turmaId)) S.lanc.turmaId = ts[0] ? ts[0].id : null;
  if (!ds.find(d => d.id === S.lanc.disc)) S.lanc.disc = ds[0] ? ds[0].id : null;
  if (!S.lanc.bim) S.lanc.bim = Number(S.escola.bimestreAtual) || 1;
  if (!S.pend.bim) S.pend.bim = Number(S.escola.bimestreAtual) || 1;
  if (!ts.find(t => t.id === S.bol.turmaId)) S.bol.turmaId = ts[0] ? ts[0].id : null;
}
async function alunosDe(turmaId, forcar) {
  if (!forcar && S.alunosCache[turmaId]) return S.alunosCache[turmaId];
  const l = await api.listarAlunos(turmaId);
  l.sort((x, y) => (x.ordem ?? 999) - (y.ordem ?? 999) || (x.nome || '').localeCompare(y.nome || '', 'pt-BR'));
  S.alunosCache[turmaId] = l;
  return l;
}

// ---------------- inicialização ----------------
carregarLogo();
if (api.modo === 'firebase') { try { S.setupFeito = await api.setupFeito(); } catch (e) { S.setupFeito = true; } }
api.onAuth(async perfil => {
  S.perfil = perfil;
  if (perfil && perfil.ativo && !perfil.semPerfil && !perfil.erro) {
    try { await carregarBase(); } catch (e) { toast(api.msgErro(e), 'erro'); }
  }
  render();
});

// ---------------- telas de acesso ----------------
function render() {
  const app = $('#app');
  const p = S.perfil;
  if (!p) {
    app.innerHTML = (api.modo === 'firebase' && !S.setupFeito) ? telaSetup() : telaLogin();
    return ligarAcesso();
  }
  if (p.erro || p.semPerfil || !p.ativo) {
    app.innerHTML = `<div class="login"><div class="card"><img src="img/logo.png" alt=""><h1>Acesso não liberado</h1>
      <p class="sub">${p.erro ? esc(p.erro) : 'Sua conta existe, mas ainda não foi liberada (ou foi desativada) pela coordenação.'}</p>
      <button class="primario" id="sair" style="width:100%">Sair</button></div></div>`;
    $('#sair').onclick = () => api.logout();
    return;
  }
  app.innerHTML = telaPrincipal();
  ligarPrincipal();
  renderView();
}

function telaLogin() {
  const demo = api.modo === 'demo';
  return `${demo ? '<div class="demo-faixa">MODO DEMONSTRAÇÃO — dados fictícios, guardados só neste navegador</div>' : ''}
  <div class="login"><div class="card">
    <img src="img/logo.png" alt="Logo">
    <h1>Sistema de Notas e Boletins</h1><p class="sub">Entre com o e-mail e a senha que a coordenação te passou.</p>
    <form id="f-login">
      <input id="l-email" type="email" placeholder="E-mail" autocomplete="username" required>
      <input id="l-senha" type="password" placeholder="Senha" autocomplete="current-password" required>
      <button class="primario" type="submit">Entrar</button>
      <button class="leve" type="button" id="l-esqueci">Esqueci minha senha</button>
      <div id="l-msg"></div>
    </form>
    ${demo ? `<div class="demo-box"><div class="suave">Experimente cada perfil (senha: <b>${api.senhaDemo}</b>):</div>
      ${api.contasDemo.map(c => `<button class="mini" data-demo="${c.email}">Entrar como ${c.rotulo}</button>`).join('')}
      <button class="leve mini" id="demo-reset">Recomeçar demonstração do zero</button></div>` : ''}
  </div></div>`;
}

function telaSetup() {
  return `<div class="login" style="max-width:520px"><div class="card">
    <img src="img/logo.png" alt="Logo"><h1>Configuração inicial</h1>
    <p class="sub">Primeiro acesso ao sistema. Crie a conta da <b>coordenação/direção</b> — ela terá acesso total e cadastrará os professores.</p>
    <form id="f-setup">
      <input id="s-escola" placeholder="Nome da escola" value="Colégio Arte de Crescer" required>
      <input id="s-ano" placeholder="Ano letivo" value="${new Date().getFullYear()}" required>
      <input id="s-coord" placeholder="Coordenadora pedagógica (nome que sai no boletim)">
      <input id="s-nome" placeholder="Seu nome" required>
      <input id="s-email" type="email" placeholder="Seu e-mail" required>
      <input id="s-senha" type="password" placeholder="Senha (mínimo 6 caracteres)" required>
      <input id="s-senha2" type="password" placeholder="Repita a senha" required>
      <button class="primario" type="submit">Criar conta da coordenação</button>
      <div id="s-msg"></div>
    </form></div></div>`;
}

function ligarAcesso() {
  const fl = $('#f-login');
  if (fl) {
    fl.onsubmit = async ev => {
      ev.preventDefault(); $('#l-msg').innerHTML = '';
      const b = fl.querySelector('button[type=submit]'); b.disabled = true; b.textContent = 'Entrando…';
      try { await api.login($('#l-email').value, $('#l-senha').value); }
      catch (e) { $('#l-msg').innerHTML = `<div class="erro">${esc(api.msgErro(e))}</div>`; b.disabled = false; b.textContent = 'Entrar'; }
    };
    $('#l-esqueci').onclick = async () => {
      const email = $('#l-email').value.trim();
      if (!email) { $('#l-msg').innerHTML = '<div class="aviso">Digite seu e-mail no campo acima e clique de novo.</div>'; return; }
      try { await api.resetSenha(email); $('#l-msg').innerHTML = '<div class="ok-box">Se o e-mail estiver cadastrado, você vai receber um link para criar uma nova senha. Confira também o spam.</div>'; }
      catch (e) { $('#l-msg').innerHTML = `<div class="erro">${esc(api.msgErro(e))}</div>`; }
    };
    $$('[data-demo]').forEach(b => b.onclick = () => { $('#l-email').value = b.dataset.demo; $('#l-senha').value = api.senhaDemo; fl.requestSubmit(); });
    const r = $('#demo-reset'); if (r) r.onclick = () => { api.resetarDemo(); toast('Demonstração reiniciada.'); };
  }
  const fs = $('#f-setup');
  if (fs) {
    fs.onsubmit = async ev => {
      ev.preventDefault(); const msg = $('#s-msg'); msg.innerHTML = '';
      if ($('#s-senha').value !== $('#s-senha2').value) { msg.innerHTML = '<div class="erro">As senhas não conferem.</div>'; return; }
      const b = fs.querySelector('button'); b.disabled = true; b.textContent = 'Criando…';
      try {
        const perfil = await api.setupInicial({ escola: $('#s-escola').value.trim(), ano: $('#s-ano').value.trim(), coordenadora: $('#s-coord').value.trim(),
          nome: $('#s-nome').value.trim(), email: $('#s-email').value, senha: $('#s-senha').value });
        S.setupFeito = true; S.perfil = perfil; await carregarBase(); S.view = 'cadastros'; render();
        toast('Pronto! Agora cadastre as turmas, os alunos e os professores.');
      } catch (e) { msg.innerHTML = `<div class="erro">${esc(api.msgErro(e))}</div>`; b.disabled = false; b.textContent = 'Criar conta da coordenação'; }
    };
  }
}

// ---------------- tela principal ----------------
function abas() {
  const p = S.perfil, l = [['lancar', 'Lançar notas']];
  if (veBoletins(p)) l.push(['boletins', 'Boletins']);
  if (isAdmin(p)) l.push(['pendencias', 'Pendências'], ['cadastros', 'Cadastros'], ['escola', 'Escola']);
  return l;
}
function telaPrincipal() {
  const p = S.perfil;
  const turmasTxt = p.role === 'titular' ? ' · ' + S.turmas.filter(t => (p.turmas || []).includes(t.id)).map(t => t.nome).join(', ') : '';
  return `${api.modo === 'demo' ? '<div class="demo-faixa">MODO DEMONSTRAÇÃO — dados fictícios, guardados só neste navegador</div>' : ''}
  <div class="topo"><div class="wrap">
    <img src="img/logo.png" alt="Logo">
    <div class="escola"><b>${esc(S.escola.nome || 'Sistema de Notas')}</b><span>Ano letivo ${esc(S.escola.ano || '')}</span></div>
    <div class="usuario"><b>${esc(p.nome || p.email)}</b><span class="selo ${p.role === 'admin' ? 'admin' : ''}">${PERFIS[p.role] || p.role}</span><span class="suave">${esc(turmasTxt)}</span></div>
    <button class="mini" id="sair">Sair</button>
  </div></div>
  <div class="wrap">
    <nav class="abas">${abas().map(([k, n]) => `<button data-view="${k}" class="${S.view === k ? 'ativa' : ''}">${n}</button>`).join('')}</nav>
    <main id="conteudo"></main>
  </div>`;
}
function ligarPrincipal() {
  $('#sair').onclick = async () => {
    if (fila.pend > 0 && !confirm('Ainda há notas sendo salvas. Sair mesmo assim?')) return;
    await api.logout();
  };
  $$('[data-view]').forEach(b => b.onclick = () => { S.view = b.dataset.view; $$('[data-view]').forEach(x => x.classList.toggle('ativa', x === b)); renderView(); });
}
function renderView() {
  if (!abas().find(a => a[0] === S.view)) S.view = 'lancar';
  const v = { lancar: viewLancar, boletins: viewBoletins, pendencias: viewPendencias, cadastros: viewCadastros, escola: viewEscola }[S.view];
  v().catch(e => { $('#conteudo').innerHTML = `<div class="card erro">${esc(api.msgErro(e))}</div>`; });
}

// ================= LANÇAR NOTAS =================
async function viewLancar() {
  const c = $('#conteudo');
  const ts = turmasDoPerfil(S.perfil, S.turmas), ds = disciplinasDoPerfil(S.perfil);
  if (!ts.length) { c.innerHTML = '<div class="card vazio">Nenhuma turma liberada para você ainda. Fale com a coordenação.</div>'; return; }
  const travas = S.escola.travas || {};
  const { turmaId, disc, bim } = S.lanc;
  const travado = !!travas[String(bim)] && !isAdmin(S.perfil);
  c.innerHTML = `<div class="card">
    <div class="filtros">
      <label>Turma<select id="l-turma">${ts.map(t => `<option value="${t.id}" ${t.id === turmaId ? 'selected' : ''}>${esc(t.nome)}</option>`).join('')}</select></label>
      <label>Disciplina<select id="l-disc">${ds.map(d => `<option value="${d.id}" ${d.id === disc ? 'selected' : ''}>${d.nome}</option>`).join('')}</select></label>
      <label>Bimestre<select id="l-bim">${BIMESTRES.map(b => `<option value="${b}" ${b === bim ? 'selected' : ''}>${b}º bimestre${travas[String(b)] ? ' 🔒' : ''}</option>`).join('')}</select></label>
      <span id="status" class="status"></span>
    </div>
    ${travado ? `<div class="aviso">🔒 O ${bim}º bimestre foi fechado pela coordenação. As notas estão disponíveis só para consulta.</div>` : ''}
    ${isAdmin(S.perfil) && travas[String(bim)] ? `<div class="aviso">🔒 Bimestre fechado para os professores. Como coordenação, você ainda pode editar.</div>` : ''}
    <div id="tabela-lanc" class="carregando-bloco">Carregando…</div>
  </div>`;
  ['l-turma', 'l-disc', 'l-bim'].forEach(id => $('#' + id).onchange = () => {
    S.lanc = { turmaId: $('#l-turma').value, disc: $('#l-disc').value, bim: Number($('#l-bim').value) }; viewLancar();
  });
  let alunos, pl;
  try { [alunos, pl] = await Promise.all([alunosDe(turmaId), api.getPlanilha(turmaId, disc, bim)]); }
  catch (e) { $('#tabela-lanc').innerHTML = `<div class="erro">${esc(api.msgErro(e))}</div>`; return; }
  const dados = (pl && pl.alunos) || {};
  const editavel = podeEditar(S.perfil, turmaId, disc) && !travado;
  const status = (tipo, msg) => { const s = $('#status'); if (!s) return; s.className = 'status ' + (tipo || '');
    s.textContent = tipo === 'salvando' ? 'Salvando…' : tipo === 'ok' ? '✓ Tudo salvo' : tipo === 'erro' ? '⚠ ' + msg : msg; };
  status('', editavel ? 'Salva automaticamente' : 'Somente consulta');
  if (!alunos.length) { $('#tabela-lanc').innerHTML = '<div class="vazio">Esta turma ainda não tem alunos cadastrados.</div>'; return; }
  const linha = (a, i) => {
    const e = dados[a.id] || {}; const nf = notaFinal(e);
    const imp = parseNum(e.prova) === null && parseNum(e.atv) === null && parseNum(e.final) !== null;
    const dis = editavel ? '' : 'disabled';
    return `<tr data-id="${a.id}"><td class="n">${i + 1}</td><td class="esq nome">${esc(a.nome)}</td>
      <td><input data-k="prova" inputmode="decimal" value="${fmtIn(e.prova)}" ${dis} aria-label="Prova"></td>
      <td><input data-k="atv" inputmode="decimal" value="${fmtIn(e.atv)}" ${dis} aria-label="Atividades"></td>
      <td class="final ${nf !== null && nf < corte() ? 'baixo' : ''}">${nf === null ? '—' : fmt(nf)}${imp ? '<span class="tag">importada</span>' : ''}</td>
      <td><input data-k="faltas" class="faltas" inputmode="numeric" value="${e.faltas ?? ''}" ${dis} aria-label="Faltas"></td>
      <td><button class="obs ${e.obs ? 'tem' : ''}" data-obs title="${esc(e.obs || 'Adicionar observação')}" ${dis}>💬</button></td></tr>`;
  };
  $('#tabela-lanc').className = '';
  $('#tabela-lanc').innerHTML = `<div class="tabela-wrap"><table class="lanc">
    <thead><tr><th>Nº</th><th class="esq">Aluno</th><th>Prova<small>0 a ${PROVA_MAX}</small></th><th>Atividades<small>0 a ${ATV_MAX}</small></th><th>Nota<small>0 a 10</small></th><th>Faltas</th><th>Obs.</th></tr></thead>
    <tbody>${alunos.map(linha).join('')}</tbody></table></div>
    <div class="resumo" id="resumo"></div>
    <p class="suave">Dica: aperte <b>Enter</b> para descer para o próximo aluno. A nota é a soma de prova + atividades. Faltas: número de faltas no bimestre.</p>`;
  const tbody = $('#tabela-lanc tbody');
  const resumo = () => {
    const fs = alunos.map(a => notaFinal(dados[a.id])).filter(x => x !== null);
    const media = fs.length ? fs.reduce((s, x) => s + x, 0) / fs.length : null;
    const faltas = alunos.reduce((s, a) => s + (parseInt0(dados[a.id] && dados[a.id].faltas) || 0), 0);
    $('#resumo').innerHTML = `<div><b>${fs.length}/${alunos.length}</b>notas lançadas</div><div><b>${media === null ? '—' : fmt(media)}</b>média da turma</div>
      <div><b>${fs.filter(x => x < corte()).length}</b>abaixo de ${fmt(corte())}</div><div><b>${faltas}</b>faltas no bimestre</div>`;
  };
  resumo();
  const salvar = alunoId => {
    const e = dados[alunoId] || {};
    const payload = { prova: e.prova ?? null, atv: e.atv ?? null, faltas: e.faltas ?? null, obs: e.obs || '', final: e.final ?? null };
    status('salvando'); fila.pend++;
    fila.p = fila.p.then(() => api.salvarLancamento(turmaId, disc, bim, alunoId, payload))
      .then(() => { fila.pend--; if (!fila.pend) status('ok'); })
      .catch(err => { fila.pend--; status('erro', 'Não salvou: ' + api.msgErro(err)); toast('Não foi possível salvar: ' + api.msgErro(err), 'erro'); });
  };
  tbody.addEventListener('change', ev => {
    const inp = ev.target.closest('input'); if (!inp) return;
    const tr = inp.closest('tr'), id = tr.dataset.id, k = inp.dataset.k;
    const e = dados[id] = dados[id] || {};
    if (k === 'faltas') { const n = parseInt0(inp.value); e.faltas = n; inp.value = n === null ? '' : n; }
    else {
      const max = k === 'prova' ? PROVA_MAX : ATV_MAX; let n = parseNum(inp.value);
      if (n !== null && (n > max || n < 0)) { toast(`${k === 'prova' ? 'A prova' : 'As atividades'} vão de 0 a ${max}. Ajustei para ${fmt(clamp(n, 0, max))}.`, 'erro'); n = clamp(n, 0, max); }
      e[k] = n; inp.value = fmtIn(n);
    }
    const nf = notaFinal(e), cel = tr.querySelector('.final');
    const imp = parseNum(e.prova) === null && parseNum(e.atv) === null && parseNum(e.final) !== null;
    cel.innerHTML = (nf === null ? '—' : fmt(nf)) + (imp ? '<span class="tag">importada</span>' : '');
    cel.classList.toggle('baixo', nf !== null && nf < corte());
    resumo(); salvar(id);
  });
  tbody.addEventListener('keydown', ev => {
    if (ev.key !== 'Enter') return; const inp = ev.target.closest('input'); if (!inp) return;
    ev.preventDefault(); const prox = inp.closest('tr').nextElementSibling;
    const nx = prox && prox.querySelector(`input[data-k="${inp.dataset.k}"]`); inp.blur(); if (nx) { nx.focus(); nx.select(); }
  });
  tbody.addEventListener('click', ev => {
    const b = ev.target.closest('[data-obs]'); if (!b) return;
    const tr = b.closest('tr'), id = tr.dataset.id, e = dados[id] = dados[id] || {};
    const v = prompt(`Observação — ${tr.querySelector('.nome').textContent}\n(${NOME_DISC[disc]}, ${bim}º bimestre)`, e.obs || '');
    if (v === null) return; e.obs = v.trim(); b.classList.toggle('tem', !!e.obs); b.title = e.obs || 'Adicionar observação'; salvar(id);
  });
}

// ================= BOLETINS =================
function htmlBoletim(aluno, turma, mapa) {
  const l = linhasBoletim(aluno.id, mapa);
  const n = v => (v === null ? '' : fmt(v)), f = v => (v === null ? '' : v);
  const obs = []; l.forEach(x => x.obs.forEach(o => obs.push(`<b>${x.nome}</b> (${o.bim}º bim): ${esc(o.texto)}`)));
  return `<div class="bol-cab"><img src="img/logo.png" alt=""><b>BOLETIM ESCOLAR ${esc(S.escola.ano || '')}</b></div>
    <div class="bol-linha"><span>Aluno(a): <b>${esc((aluno.nome || '').toUpperCase())}</b></span><span>Série: ${esc((turma.nome || '').toUpperCase())}</span></div>
    <table class="bol"><thead>
      <tr><th rowspan="2">Componentes Curriculares</th><th colspan="4">NOTAS</th><th colspan="4">FALTAS</th><th rowspan="2">5º CONCEITO</th><th rowspan="2">Total de Faltas</th><th rowspan="2">Resultado Final</th></tr>
      <tr>${[1, 2, 3, 4].map(b => `<th>${b}º BIM</th>`).join('')}${[1, 2, 3, 4].map(b => `<th>${b}º BIM</th>`).join('')}</tr></thead>
      <tbody>${l.map(x => `<tr><td class="esq">${x.nome}</td>${x.notas.map(v => `<td>${n(v)}</td>`).join('')}${x.faltas.map(v => `<td>${f(v)}</td>`).join('')}<td></td><td>${f(x.total)}</td><td></td></tr>`).join('')}</tbody></table>
    <div class="bol-linha"><span>Professora: ${esc((aluno.professora || turma.professora || '').toUpperCase())}</span><span>Coordenadora Pedagógica: ${esc((S.escola.coordenadora || '').toUpperCase())}</span></div>
    ${obs.length ? `<div class="suave" style="margin-top:8px">Observações: ${obs.join(' • ')}</div>` : ''}`;
}
async function viewBoletins() {
  const c = $('#conteudo');
  const ts = turmasDoPerfil(S.perfil, S.turmas);
  if (!ts.length) { c.innerHTML = '<div class="card vazio">Nenhuma turma disponível.</div>'; return; }
  if (!ts.find(t => t.id === S.bol.turmaId)) S.bol.turmaId = ts[0].id;
  const turma = ts.find(t => t.id === S.bol.turmaId);
  c.innerHTML = `<div class="card"><div class="filtros">
      <label>Turma<select id="b-turma">${ts.map(t => `<option value="${t.id}" ${t.id === turma.id ? 'selected' : ''}>${esc(t.nome)}</option>`).join('')}</select></label>
      <label class="chk"><input type="checkbox" id="b-obs" ${S.bol.obs ? 'checked' : ''}> incluir observações no PDF</label>
      <button class="primario" id="b-pdf-turma" style="margin-left:auto">⤓ Boletins da turma (PDF)</button>
    </div>
    <div class="duas-colunas"><div class="lista-alunos" id="b-lista"><div class="vazio">Carregando…</div></div><div class="previa" id="b-prev"><div class="vazio">Escolha um aluno para ver o boletim.</div></div></div>
    <p class="suave">O PDF sai no modelo da escola, dois boletins por folha, sem fundo colorido (economiza tinta).</p></div>`;
  $('#b-turma').onchange = () => { S.bol.turmaId = $('#b-turma').value; S.bol.alunoId = null; viewBoletins(); };
  $('#b-obs').onchange = () => { S.bol.obs = $('#b-obs').checked; };
  const [alunos, planilhas] = await Promise.all([alunosDe(turma.id), api.getPlanilhasTurma(turma.id)]);
  const mapa = indexarPlanilhas(planilhas);
  if (!alunos.length) { $('#b-lista').innerHTML = '<div class="vazio">Sem alunos nesta turma.</div>'; return; }
  const mostrar = id => {
    S.bol.alunoId = id; const a = alunos.find(x => x.id === id);
    $$('#b-lista button').forEach(b => b.classList.toggle('sel', b.dataset.id === id));
    $('#b-prev').innerHTML = htmlBoletim(a, turma, mapa) + `<div class="acoes"><button id="b-pdf-um">⤓ PDF deste aluno</button></div>`;
    $('#b-pdf-um').onclick = () => pdf([a], `Boletim_${slug(a.nome)}`);
  };
  const pdf = (lista, nome) => {
    try {
      const doc = gerarBoletinsPDF({ escola: S.escola, turma, alunos: lista, planilhas, logo: LOGO, incluirObs: $('#b-obs').checked });
      doc.save(`${nome}_${slug(S.escola.ano)}.pdf`); toast('PDF gerado.');
    } catch (e) { toast('Erro ao gerar PDF: ' + e.message, 'erro'); }
  };
  $('#b-lista').innerHTML = alunos.map(a => `<button data-id="${a.id}">${esc(a.nome)}</button>`).join('');
  $$('#b-lista button').forEach(b => b.onclick = () => mostrar(b.dataset.id));
  $('#b-pdf-turma').onclick = () => pdf(alunos, `Boletins_${slug(turma.nome)}`);
  mostrar(alunos.find(a => a.id === S.bol.alunoId) ? S.bol.alunoId : alunos[0].id);
}

// ================= PENDÊNCIAS =================
async function viewPendencias() {
  const c = $('#conteudo'); const bim = S.pend.bim;
  c.innerHTML = `<div class="card"><h2>Acompanhamento de lançamentos</h2><div class="filtros">
    <label>Bimestre<select id="p-bim">${BIMESTRES.map(b => `<option value="${b}" ${b === bim ? 'selected' : ''}>${b}º bimestre</option>`).join('')}</select></label>
    <button id="p-atual">↻ Atualizar</button></div><div id="p-tab" class="carregando-bloco">Carregando…</div></div>`;
  $('#p-bim').onchange = () => { S.pend.bim = Number($('#p-bim').value); viewPendencias(); };
  $('#p-atual').onclick = () => { S.alunosCache = {}; viewPendencias(); };
  const [planilhas, listas] = await Promise.all([api.getPlanilhasBimestre(bim), Promise.all(S.turmas.map(t => alunosDe(t.id)))]);
  let falta = 0, total = 0;
  const linhas = S.turmas.map((t, i) => {
    const al = listas[i];
    return `<tr><td class="esq"><b>${esc(t.nome)}</b><br><span class="suave">${al.length} alunos</span></td>${DISCIPLINAS.map(d => {
      const pl = planilhas.find(p => p.turmaId === t.id && p.disc === d.id);
      const x = al.filter(a => notaFinal(pl && pl.alunos && pl.alunos[a.id]) !== null).length; const y = al.length;
      total += y; falta += y - x;
      const cls = y === 0 ? 'p-vazio' : x === y ? 'p-ok' : x > 0 ? 'p-parc' : 'p-vazio';
      return `<td class="${cls}">${y ? `${x}/${y}` : '—'}</td>`;
    }).join('')}</tr>`;
  }).join('');
  $('#p-tab').className = '';
  $('#p-tab').innerHTML = `<div class="tabela-wrap"><table class="pend"><thead><tr><th class="esq">Turma</th>${DISCIPLINAS.map(d => `<th>${d.nome}</th>`).join('')}</tr></thead><tbody>${linhas}</tbody></table></div>
    <div class="legenda"><span class="l1">completo</span><span class="l2">em andamento</span><span class="l3">nada lançado</span></div>
    <p class="${falta ? 'aviso' : 'ok-box'}">${falta ? `Faltam <b>${falta}</b> de ${total} notas no ${bim}º bimestre.` : `Todas as notas do ${bim}º bimestre foram lançadas.`}</p>`;
}

// ================= CADASTROS =================
async function viewCadastros() {
  const c = $('#conteudo');
  c.innerHTML = `<div class="card"><div class="subabas">${[['turmas', 'Turmas'], ['alunos', 'Alunos'], ['professores', 'Professores e acessos']]
    .map(([k, n]) => `<button data-sub="${k}" class="${S.sub === k ? 'ativa' : ''}">${n}</button>`).join('')}</div><div id="sub"></div></div>`;
  $$('[data-sub]').forEach(b => b.onclick = () => { S.sub = b.dataset.sub; viewCadastros(); });
  await ({ turmas: cadTurmas, alunos: cadAlunos, professores: cadProfessores }[S.sub])();
}

async function cadTurmas() {
  const el = $('#sub');
  el.innerHTML = `<p class="suave">A "professora titular" é o nome que sai no rodapé do boletim. O acesso de cada professora é liberado em <b>Professores e acessos</b>.</p>
    <div class="tabela-wrap"><table class="cad"><thead><tr><th class="esq">Turma</th><th class="esq">Professora titular (boletim)</th><th>Ordem</th><th></th></tr></thead>
    <tbody>${S.turmas.map(t => `<tr data-id="${t.id}"><td><input class="t-nome" value="${esc(t.nome)}"></td><td><input class="t-prof" value="${esc(t.professora || '')}"></td>
      <td style="width:90px"><input class="t-ordem" type="number" value="${t.ordem ?? ''}"></td>
      <td style="white-space:nowrap"><button class="mini primario" data-salvar>Salvar</button> <button class="mini perigo" data-excluir>Excluir</button></td></tr>`).join('')}
    <tr><td><input id="nt-nome" placeholder="Nova turma (ex.: 1º ano)"></td><td><input id="nt-prof" placeholder="Professora titular"></td><td></td><td><button class="mini primario" id="nt-add">Adicionar</button></td></tr>
    </tbody></table></div>`;
  const recarregar = async () => { S.turmas = await api.listarTurmas(); await cadTurmas(); };
  $$('[data-salvar]').forEach(b => b.onclick = async () => {
    const tr = b.closest('tr');
    try { await api.salvarTurma({ id: tr.dataset.id, nome: $('.t-nome', tr).value.trim(), professora: $('.t-prof', tr).value.trim(), ordem: Number($('.t-ordem', tr).value) || 0 }); toast('Turma salva.'); await recarregar(); }
    catch (e) { toast(api.msgErro(e), 'erro'); }
  });
  $$('[data-excluir]').forEach(b => b.onclick = async () => {
    const id = b.closest('tr').dataset.id, t = S.turmas.find(x => x.id === id);
    const al = await alunosDe(id, true);
    if (al.length) { alert(`A turma ${t.nome} tem ${al.length} aluno(s). Mova ou exclua os alunos antes de excluir a turma.`); return; }
    if (!confirm(`Excluir a turma ${t.nome}?`)) return;
    try { await api.excluirTurma(id); toast('Turma excluída.'); await recarregar(); } catch (e) { toast(api.msgErro(e), 'erro'); }
  });
  $('#nt-add').onclick = async () => {
    const nome = $('#nt-nome').value.trim(); if (!nome) return toast('Digite o nome da turma.', 'erro');
    try { await api.salvarTurma({ nome, professora: $('#nt-prof').value.trim(), ordem: S.turmas.length + 1 }); toast('Turma criada.'); await recarregar(); }
    catch (e) { toast(api.msgErro(e), 'erro'); }
  };
}

async function cadAlunos() {
  const el = $('#sub');
  if (!S.turmas.length) { el.innerHTML = '<div class="vazio">Cadastre uma turma primeiro.</div>'; return; }
  if (!S.turmas.find(t => t.id === S.cadTurma)) S.cadTurma = S.turmas[0].id;
  const turma = S.turmas.find(t => t.id === S.cadTurma);
  const alunos = await alunosDe(turma.id, true);
  el.innerHTML = `<div class="filtros"><label>Turma<select id="ca-turma">${S.turmas.map(t => `<option value="${t.id}" ${t.id === turma.id ? 'selected' : ''}>${esc(t.nome)}</option>`).join('')}</select></label>
      <span class="suave">${alunos.length} aluno(s)</span></div>
    <h3>Adicionar alunos</h3><textarea id="ca-novos" placeholder="Cole os nomes completos, um por linha"></textarea>
    <div class="acoes"><button class="primario" id="ca-add">Adicionar à turma ${esc(turma.nome)}</button></div>
    <h3>Alunos da turma</h3>
    ${alunos.length ? `<div class="tabela-wrap"><table class="cad"><thead><tr><th>Nº</th><th class="esq">Nome completo</th><th class="esq">Professora no boletim <small>(só se for diferente da turma)</small></th><th class="esq">Turma</th><th></th></tr></thead>
    <tbody>${alunos.map((a, i) => `<tr data-id="${a.id}"><td class="n">${i + 1}</td><td><input class="a-nome" value="${esc(a.nome)}"></td>
      <td><input class="a-prof" value="${esc(a.professora || '')}" placeholder="${esc(turma.professora || '')}"></td>
      <td><select class="a-turma">${S.turmas.map(t => `<option value="${t.id}" ${t.id === a.turmaId ? 'selected' : ''}>${esc(t.nome)}</option>`).join('')}</select></td>
      <td><button class="mini perigo" data-excluir>Excluir</button></td></tr>`).join('')}</tbody></table></div>
    <div class="acoes"><button class="primario" id="ca-salvar">Salvar alterações</button><button id="ca-az">Ordenar A–Z</button><span class="suave" id="ca-info"></span></div>` : '<div class="vazio">Nenhum aluno ainda.</div>'}`;
  $('#ca-turma').onchange = () => { S.cadTurma = $('#ca-turma').value; cadAlunos(); };
  $('#ca-add').onclick = async () => {
    const nomes = $('#ca-novos').value.split('\n').map(s => s.trim()).filter(Boolean);
    if (!nomes.length) return toast('Cole pelo menos um nome.', 'erro');
    const base = alunos.reduce((m, a) => Math.max(m, a.ordem ?? 0), 0);
    try { await api.salvarAlunosEmLote(nomes.map((nome, i) => ({ nome, turmaId: turma.id, ordem: base + i + 1 }))); toast(`${nomes.length} aluno(s) adicionado(s).`); await cadAlunos(); }
    catch (e) { toast(api.msgErro(e), 'erro'); }
  };
  if (!alunos.length) return;
  $$('#sub tbody tr').forEach(tr => tr.addEventListener('input', () => { tr.classList.add('mudou'); $('#ca-info').textContent = 'Há alterações não salvas.'; }));
  $$('#sub tbody tr').forEach(tr => $('select', tr).addEventListener('change', () => { tr.classList.add('mudou'); $('#ca-info').textContent = 'Há alterações não salvas.'; }));
  $('#ca-salvar').onclick = async () => {
    const mud = $$('#sub tbody tr.mudou').map(tr => ({ id: tr.dataset.id, nome: $('.a-nome', tr).value.trim(), professora: $('.a-prof', tr).value.trim(), turmaId: $('.a-turma', tr).value }));
    if (!mud.length) return toast('Nada para salvar.');
    try { await api.salvarAlunosEmLote(mud); S.alunosCache = {}; toast(`${mud.length} aluno(s) atualizado(s).`); await cadAlunos(); } catch (e) { toast(api.msgErro(e), 'erro'); }
  };
  $('#ca-az').onclick = async () => {
    const ord = [...alunos].sort((x, y) => (x.nome || '').localeCompare(y.nome || '', 'pt-BR', { sensitivity: 'base' }));
    try { await api.salvarAlunosEmLote(ord.map((a, i) => ({ id: a.id, ordem: i + 1 }))); toast('Ordem alfabética aplicada.'); await cadAlunos(); } catch (e) { toast(api.msgErro(e), 'erro'); }
  };
  $$('#sub [data-excluir]').forEach(b => b.onclick = async () => {
    const tr = b.closest('tr'); const nome = $('.a-nome', tr).value;
    if (!confirm(`Excluir ${nome} da lista? (As notas já lançadas ficam guardadas no backup, mas o aluno sai das telas e dos boletins.)`)) return;
    try { await api.excluirAluno(tr.dataset.id); toast('Aluno excluído.'); await cadAlunos(); } catch (e) { toast(api.msgErro(e), 'erro'); }
  });
}

async function cadProfessores() {
  const el = $('#sub');
  const users = (await api.listarUsuarios()).sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
  const nomeT = id => (S.turmas.find(t => t.id === id) || {}).nome || '?';
  const checks = (sel, pref) => S.turmas.map(t => `<label><input type="checkbox" class="${pref}" value="${t.id}" ${sel.includes(t.id) ? 'checked' : ''}> ${esc(t.nome)}</label>`).join('');
  const optsPerfil = r => Object.entries(PERFIS).map(([k, n]) => `<option value="${k}" ${k === r ? 'selected' : ''}>${n}</option>`).join('');
  el.innerHTML = `<h3>Novo acesso</h3>
    <div class="grade">
      <label class="campo">Nome<input id="np-nome" placeholder="Nome da professora"></label>
      <label class="campo">E-mail<input id="np-email" type="email" placeholder="email@exemplo.com"></label>
      <label class="campo">Perfil<select id="np-perfil">${optsPerfil('titular')}</select></label>
      <label class="campo">Senha provisória<input id="np-senha" value="${senhaAleatoria()}"></label>
    </div>
    <div id="np-turmas-box" style="margin-top:10px"><div class="campo">Turmas desta titular</div><div class="checks">${checks([], 'np-t')}</div></div>
    <p class="suave">Titular: lança todas as disciplinas das turmas marcadas, menos Inglês. Inglês: lança só Inglês, em todas as turmas. Coordenação/Direção: acesso total.</p>
    <div class="acoes"><button class="primario" id="np-criar">Criar acesso</button></div><div id="np-res"></div>
    <h3>Acessos cadastrados</h3>
    <div class="tabela-wrap"><table class="cad"><thead><tr><th class="esq">Nome</th><th class="esq">E-mail</th><th class="esq">Perfil</th><th class="esq">Turmas</th><th>Situação</th><th></th></tr></thead>
    <tbody>${users.map(u => `<tr data-uid="${u.uid}"><td class="esq"><b>${esc(u.nome)}</b>${u.uid === S.perfil.uid ? ' <span class="selo">você</span>' : ''}</td><td class="esq">${esc(u.email)}</td>
      <td class="esq">${PERFIS[u.role] || u.role}</td><td class="esq">${u.role === 'titular' ? (u.turmas || []).map(nomeT).join(', ') || '<span class="suave">nenhuma</span>' : '<span class="suave">todas</span>'}</td>
      <td>${u.ativo ? '<span class="selo">ativo</span>' : '<span class="selo admin">inativo</span>'}</td><td><button class="mini" data-editar>Editar</button></td></tr>
      <tr class="edicao" data-ed="${u.uid}" hidden><td colspan="6"><div class="grade">
        <label class="campo">Nome<input class="ed-nome" value="${esc(u.nome)}"></label>
        <label class="campo">Perfil<select class="ed-perfil" ${u.uid === S.perfil.uid ? 'disabled' : ''}>${optsPerfil(u.role)}</select></label>
        <label class="campo">Situação<select class="ed-ativo" ${u.uid === S.perfil.uid ? 'disabled' : ''}><option value="1" ${u.ativo ? 'selected' : ''}>Ativo</option><option value="0" ${!u.ativo ? 'selected' : ''}>Inativo (bloqueado)</option></select></label></div>
        <div class="ed-turmas-box" style="margin-top:8px"><div class="campo">Turmas</div><div class="checks">${checks(u.turmas || [], 'ed-t')}</div></div>
        <div class="acoes"><button class="mini primario" data-salvar>Salvar</button><button class="mini" data-reset>Enviar e-mail para redefinir senha</button></div></td></tr>`).join('')}
    </tbody></table></div>`;
  const toggleTurmas = () => { $('#np-turmas-box').hidden = $('#np-perfil').value !== 'titular'; };
  $('#np-perfil').onchange = toggleTurmas; toggleTurmas();
  $('#np-criar').onclick = async () => {
    const nome = $('#np-nome').value.trim(), email = $('#np-email').value.trim(), role = $('#np-perfil').value, senha = $('#np-senha').value.trim();
    const turmas = role === 'titular' ? $$('.np-t:checked').map(x => x.value) : [];
    if (!nome || !email) return toast('Preencha nome e e-mail.', 'erro');
    if (role === 'titular' && !turmas.length) return toast('Marque pelo menos uma turma para a titular.', 'erro');
    const b = $('#np-criar'); b.disabled = true; b.textContent = 'Criando…';
    try {
      await api.criarUsuario({ nome, email, senha, role, turmas });
      const link = location.origin + location.pathname;
      $('#np-res').innerHTML = `<div class="ok-box">Acesso criado. Envie para ${esc(nome)}:</div><div class="credenciais" id="np-cred">Olá, ${esc(nome)}! Seu acesso ao sistema de notas:
Endereço: ${esc(link)}
E-mail: ${esc(email)}
Senha provisória: ${esc(senha)}
Para criar sua própria senha, clique em "Esqueci minha senha" na tela de entrada.</div><div class="acoes"><button class="mini" id="np-copiar">Copiar mensagem</button></div>`;
      $('#np-copiar').onclick = () => navigator.clipboard.writeText($('#np-cred').textContent).then(() => toast('Mensagem copiada.'));
      const res = $('#np-res').innerHTML; await cadProfessores(); $('#np-res').innerHTML = res;
      const cp = $('#np-copiar'); if (cp) cp.onclick = () => navigator.clipboard.writeText($('#np-cred').textContent).then(() => toast('Mensagem copiada.'));
    } catch (e) { toast(api.msgErro(e), 'erro'); b.disabled = false; b.textContent = 'Criar acesso'; }
  };
  $$('[data-editar]').forEach(b => b.onclick = () => {
    const uid = b.closest('tr').dataset.uid, ed = $(`tr[data-ed="${uid}"]`); ed.hidden = !ed.hidden;
    const sync = () => { $('.ed-turmas-box', ed).hidden = $('.ed-perfil', ed).value !== 'titular'; };
    $('.ed-perfil', ed).onchange = sync; sync();
  });
  $$('tr.edicao [data-salvar]').forEach(b => b.onclick = async () => {
    const ed = b.closest('tr'), uid = ed.dataset.ed, role = $('.ed-perfil', ed).value;
    const dados = { nome: $('.ed-nome', ed).value.trim(), role, turmas: role === 'titular' ? $$('.ed-t:checked', ed).map(x => x.value) : [], ativo: $('.ed-ativo', ed).value === '1' };
    if (uid === S.perfil.uid) { delete dados.role; delete dados.ativo; delete dados.turmas; }
    try { await api.atualizarUsuario(uid, dados); toast('Acesso atualizado.'); await cadProfessores(); } catch (e) { toast(api.msgErro(e), 'erro'); }
  });
  $$('tr.edicao [data-reset]').forEach(b => b.onclick = async () => {
    const uid = b.closest('tr').dataset.ed, u = users.find(x => x.uid === uid);
    try { await api.resetSenha(u.email); toast(`E-mail de redefinição enviado para ${u.email}.`); } catch (e) { toast(api.msgErro(e), 'erro'); }
  });
}

// ================= ESCOLA =================
async function viewEscola() {
  const c = $('#conteudo'); const e = S.escola, tr = e.travas || {};
  c.innerHTML = `<div class="card"><h2>Dados da escola</h2><div class="grade">
      <label class="campo">Nome da escola<input id="e-nome" value="${esc(e.nome || '')}"></label>
      <label class="campo">Ano letivo<input id="e-ano" value="${esc(e.ano || '')}"></label>
      <label class="campo">Coordenadora pedagógica (boletim)<input id="e-coord" value="${esc(e.coordenadora || '')}"></label>
      <label class="campo">Média de aprovação<input id="e-corte" inputmode="decimal" value="${fmtIn(e.corte ?? 6)}"></label>
      <label class="campo">Bimestre atual<select id="e-bim">${BIMESTRES.map(b => `<option value="${b}" ${Number(e.bimestreAtual) === b ? 'selected' : ''}>${b}º bimestre</option>`).join('')}</select></label></div>
    <h3>Fechamento de bimestres</h3><p class="suave">Bimestre fechado: professores só consultam; a coordenação continua podendo corrigir.</p>
    <div class="checks">${BIMESTRES.map(b => `<label><input type="checkbox" class="e-trava" value="${b}" ${tr[String(b)] ? 'checked' : ''}> ${b}º bimestre fechado</label>`).join('')}</div>
    <div class="acoes"><button class="primario" id="e-salvar">Salvar</button></div></div>
  <div class="card"><h2>Exportar e backup</h2>
    <div class="acoes"><button id="x-excel">⤓ Planilha geral (Excel)</button><button id="x-backup">⤓ Backup completo (.json)</button>
      <button id="x-import">⤒ Importar dados (.json)</button><input type="file" id="x-file" accept="application/json,.json" hidden></div>
    <p class="suave">Faça um backup ao fim de cada bimestre e guarde no seu Google Drive. A importação serve para restaurar um backup ou carregar os dados iniciais.</p>
    ${api.modo === 'demo' ? '<div class="acoes"><button class="perigo" id="x-demo">Recomeçar demonstração</button></div>' : ''}</div>`;
  $('#e-salvar').onclick = async () => {
    const travas = {}; BIMESTRES.forEach(b => { travas[String(b)] = !!$(`.e-trava[value="${b}"]`).checked; });
    const d = { nome: $('#e-nome').value.trim(), ano: $('#e-ano').value.trim(), coordenadora: $('#e-coord').value.trim(),
      corte: parseNum($('#e-corte').value) ?? 6, bimestreAtual: Number($('#e-bim').value), travas };
    try { await api.salvarEscola(d); S.escola = { ...S.escola, ...d }; toast('Dados salvos.'); render(); } catch (err) { toast(api.msgErro(err), 'erro'); }
  };
  $('#x-backup').onclick = async () => {
    try { const d = await api.exportarTudo(); baixar(`backup_notas_${new Date().toISOString().slice(0, 10)}.json`, new Blob([JSON.stringify(d, null, 1)], { type: 'application/json' })); toast('Backup baixado.'); }
    catch (err) { toast(api.msgErro(err), 'erro'); }
  };
  $('#x-import').onclick = () => $('#x-file').click();
  $('#x-file').onchange = async ev => {
    const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
    let d; try { d = JSON.parse(await f.text()); } catch (err) { return toast('Arquivo inválido.', 'erro'); }
    if (d.formato !== 'sistema-notas-adc') return toast('Este arquivo não é um backup do sistema.', 'erro');
    if (!confirm(`Importar ${(d.turmas || []).length} turma(s), ${(d.alunos || []).length} aluno(s) e ${(d.planilhas || []).length} planilha(s) de notas?\nRegistros com o mesmo código serão substituídos.`)) return;
    try { const r = await api.importarTudo(d); await carregarBase(); toast(`Importado: ${r.turmas} turmas, ${r.alunos} alunos, ${r.planilhas} planilhas.`); render(); }
    catch (err) { toast(api.msgErro(err), 'erro'); }
  };
  $('#x-excel').onclick = async () => {
    const b = $('#x-excel'); b.disabled = true; b.textContent = 'Gerando…';
    try {
      await carregarXLSX();
      const linhas = [['Turma', 'Aluno', 'Disciplina', '1º BIM', 'Faltas 1º', '2º BIM', 'Faltas 2º', '3º BIM', 'Faltas 3º', '4º BIM', 'Faltas 4º', 'Total de faltas', 'Observações']];
      for (const t of S.turmas) {
        const [al, pls] = await Promise.all([alunosDe(t.id), api.getPlanilhasTurma(t.id)]); const mapa = indexarPlanilhas(pls);
        al.forEach(a => linhasBoletim(a.id, mapa).forEach(l => {
          const r = [t.nome, a.nome, l.nome]; l.notas.forEach((n, i) => r.push(n ?? '', l.faltas[i] ?? ''));
          r.push(l.total ?? '', l.obs.map(o => `${o.bim}º: ${o.texto}`).join(' | ')); linhas.push(r);
        }));
      }
      const ws = XLSX.utils.aoa_to_sheet(linhas); ws['!cols'] = [{ wch: 10 }, { wch: 34 }, { wch: 12 }, ...Array(9).fill({ wch: 9 }), { wch: 40 }];
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Notas');
      XLSX.writeFile(wb, `Notas_${slug(S.escola.nome)}_${slug(S.escola.ano)}.xlsx`); toast('Planilha gerada.');
    } catch (err) { toast(api.msgErro(err), 'erro'); }
    b.disabled = false; b.textContent = '⤓ Planilha geral (Excel)';
  };
  const dr = $('#x-demo'); if (dr) dr.onclick = () => { if (confirm('Apagar as alterações e recomeçar a demonstração?')) { api.resetarDemo(); } };
}
