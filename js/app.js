// Sistema de Notas e Boletins — interface
import { firebaseConfig } from './firebase-config.js';
import {
  DISCIPLINAS, NOME_DISC, BIMESTRES, PERFIS, PROVA_MAX, ATV_MAX, podeEditar, turmasDoPerfil,
  disciplinasDoPerfil, veBoletins, isAdmin, parseNum, parseInt0, clamp, fmt, notaFinal, esc,
  emailParaLogin, ehUsuarioInterno, loginParaEmail, STATUS_PLAN, MAX_ARQUIVO, tamanhoLegivel, fatiarArquivo, b64ParaBytes, dataBR,
} from './comum.js';
import { gerarBoletinsPDF, linhasBoletim, indexarPlanilhas } from './boletim.js';

const params = new URLSearchParams(location.search);
const configurado = !!(firebaseConfig && firebaseConfig.apiKey && !String(firebaseConfig.apiKey).includes('COLE_AQUI'));
const api = (configurado && !params.has('demo'))
  ? (await import('./dados-firebase.js')).criarApiFirebase(firebaseConfig)
  : (await import('./dados-demo.js')).criarApiDemo();

const S = {
  perfil: null, escola: {}, turmas: [], setupFeito: true,
  view: 'inicio', sub: 'turmas', seq: 0,
  plan: { status: 'novos', prof: '' },
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
  if ((perfil && perfil.uid) !== (S.perfil && S.perfil.uid)) {   // outra pessoa entrou: começa do Início
    S.view = 'inicio'; S.sub = 'turmas'; S.lanc = { turmaId: null, disc: null, bim: null }; S.bol = { turmaId: null, alunoId: null, obs: false };
  }
  S.perfil = perfil;
  if (perfil && perfil.ativo && !perfil.semPerfil && !perfil.erro) {
    try { await carregarBase(); } catch (e) { toast(api.msgErro(e), 'erro'); }
  }
  render();
});

// ---------------- telas de acesso ----------------
const marcaVista = () => { const s = ++S.seq; return () => s === S.seq; };
function render() {
  S.seq++;
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
    <h1>Notas e Planejamentos</h1><p class="sub">Entre com o usuário (ou e-mail) e a senha que a coordenação te passou.</p>
    <form id="f-login">
      <input id="l-email" type="text" placeholder="Usuário ou e-mail" autocomplete="username" autocapitalize="none" spellcheck="false" required>
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
      <input id="s-email" placeholder="Seu usuário (ex.: goncalina) ou e-mail" autocapitalize="none" required>
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
      if (!email) { $('#l-msg').innerHTML = '<div class="aviso">Digite seu usuário ou e-mail no campo acima e clique de novo.</div>'; return; }
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
  const p = S.perfil, l = [['inicio', '🏠 Início'], ['lancar', '✏️ Notas'], ['planejamentos', '📄 Planejamentos']];
  if (veBoletins(p)) l.push(['boletins', '🧾 Boletins']);
  if (isAdmin(p)) l.push(['pendencias', '📊 Acompanhamento'], ['cadastros', '👥 Cadastros'], ['escola', '⚙️ Escola']);
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
    <div class="topo-acoes"><button class="mini" id="ajuda">❓ Ajuda</button><button class="mini" id="senha">🔑 Minha senha</button><button class="mini" id="sair">Sair</button></div>
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
  $$('[data-view]').forEach(b => b.onclick = () => irPara(b.dataset.view));
  $('#ajuda').onclick = abrirAjuda;
  $('#senha').onclick = abrirTrocaSenha;
}
function irPara(view) { S.view = view; $$('[data-view]').forEach(x => x.classList.toggle('ativa', x.dataset.view === view)); renderView(); window.scrollTo(0, 0); }
function renderView() {
  if (!abas().find(a => a[0] === S.view)) S.view = 'inicio';
  S.seq++;
  $$('[data-view]').forEach(x => x.classList.toggle('ativa', x.dataset.view === S.view));
  const v = { inicio: viewInicio, lancar: viewLancar, planejamentos: viewPlanejamentos, boletins: viewBoletins, pendencias: viewPendencias, cadastros: viewCadastros, escola: viewEscola }[S.view];
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
    S.lanc = { turmaId: $('#l-turma').value, disc: $('#l-disc').value, bim: Number($('#l-bim').value) }; S.seq++; viewLancar();
  });
  let alunos, pl; const vivo = marcaVista();
  try { [alunos, pl] = await Promise.all([alunosDe(turmaId), api.getPlanilha(turmaId, disc, bim)]); }
  catch (e) { if (vivo()) $('#tabela-lanc').innerHTML = `<div class="erro">${esc(api.msgErro(e))}</div>`; return; }
  if (!vivo()) return;
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
    const m = abrirModal(`<h2>Observação</h2><p class="suave">${esc(tr.querySelector('.nome').textContent)} · ${NOME_DISC[disc]} · ${bim}º bimestre</p>
      <textarea id="obs-txt" placeholder="Ex.: faltou à prova; fez a recuperação; precisa de reforço em leitura…">${esc(e.obs || '')}</textarea>
      <p class="suave">Aparece no boletim só se a opção "incluir observações" for marcada na hora de gerar o PDF.</p>
      <div class="acoes"><button class="primario" id="obs-ok">Salvar</button><button id="obs-x">Cancelar</button>${e.obs ? '<button class="perigo" id="obs-del">Apagar</button>' : ''}</div>`);
    $('#obs-txt', m).focus();
    const fim = v => { e.obs = v; b.classList.toggle('tem', !!e.obs); b.title = e.obs || 'Adicionar observação'; salvar(id); fecharModal(); };
    $('#obs-ok', m).onclick = () => fim($('#obs-txt', m).value.trim());
    $('#obs-x', m).onclick = fecharModal;
    const del = $('#obs-del', m); if (del) del.onclick = () => fim('');
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
  const vivo = marcaVista();
  const [alunos, planilhas] = await Promise.all([alunosDe(turma.id), api.getPlanilhasTurma(turma.id)]);
  if (!vivo()) return;
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
  const vivo = marcaVista();
  const [planilhas, listas] = await Promise.all([api.getPlanilhasBimestre(bim), Promise.all(S.turmas.map(t => alunosDe(t.id)))]);
  if (!vivo()) return;
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
  const vivo = marcaVista();
  const alunos = await alunosDe(turma.id, true);
  if (!vivo()) return;
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
  const vivo = marcaVista();
  const users = (await api.listarUsuarios()).sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
  if (!vivo()) return;
  const nomeT = id => (S.turmas.find(t => t.id === id) || {}).nome || '?';
  const checks = (sel, pref) => S.turmas.map(t => `<label><input type="checkbox" class="${pref}" value="${t.id}" ${sel.includes(t.id) ? 'checked' : ''}> ${esc(t.nome)}</label>`).join('');
  const optsPerfil = r => Object.entries(PERFIS).map(([k, n]) => `<option value="${k}" ${k === r ? 'selected' : ''}>${n}</option>`).join('');
  el.innerHTML = `<h3>Novo acesso</h3>
    <div class="grade">
      <label class="campo">Nome<input id="np-nome" placeholder="Nome da professora"></label>
      <label class="campo">Usuário ou e-mail<input id="np-email" placeholder="ex.: laiza (ou email@exemplo.com)" autocapitalize="none"></label>
      <label class="campo">Perfil<select id="np-perfil">${optsPerfil('titular')}</select></label>
      <label class="campo">Senha provisória<input id="np-senha" value="${senhaAleatoria()}"></label>
    </div>
    <div id="np-turmas-box" style="margin-top:10px"><div class="campo">Turmas desta titular</div><div class="checks">${checks([], 'np-t')}</div></div>
    <p class="suave">Titular: lança todas as disciplinas das turmas marcadas, menos Inglês. Inglês: lança só Inglês, em todas as turmas. Coordenação/Direção: acesso total.<br>
    Com <b>e-mail</b>, a pessoa consegue recuperar a senha sozinha. Com <b>nome de usuário</b> (sem @), o acesso é mais simples, mas se esquecer a senha é preciso criar um acesso novo.</p>
    <div class="acoes"><button class="primario" id="np-criar">Criar acesso</button></div><div id="np-res"></div>
    <h3>Acessos cadastrados</h3>
    <div class="tabela-wrap"><table class="cad"><thead><tr><th class="esq">Nome</th><th class="esq">Usuário / e-mail</th><th class="esq">Perfil</th><th class="esq">Turmas</th><th>Situação</th><th></th></tr></thead>
    <tbody>${users.map(u => `<tr data-uid="${u.uid}"><td class="esq"><b>${esc(u.nome)}</b>${u.uid === S.perfil.uid ? ' <span class="selo">você</span>' : ''}</td><td class="esq">${esc(emailParaLogin(u.email))}</td>
      <td class="esq">${PERFIS[u.role] || u.role}</td><td class="esq">${u.role === 'titular' ? (u.turmas || []).map(nomeT).join(', ') || '<span class="suave">nenhuma</span>' : '<span class="suave">todas</span>'}</td>
      <td>${u.ativo ? '<span class="selo">ativo</span>' : '<span class="selo admin">inativo</span>'}</td><td><button class="mini" data-editar>Editar</button></td></tr>
      <tr class="edicao" data-ed="${u.uid}" hidden><td colspan="6"><div class="grade">
        <label class="campo">Nome<input class="ed-nome" value="${esc(u.nome)}"></label>
        <label class="campo">Perfil<select class="ed-perfil" ${u.uid === S.perfil.uid ? 'disabled' : ''}>${optsPerfil(u.role)}</select></label>
        <label class="campo">Situação<select class="ed-ativo" ${u.uid === S.perfil.uid ? 'disabled' : ''}><option value="1" ${u.ativo ? 'selected' : ''}>Ativo</option><option value="0" ${!u.ativo ? 'selected' : ''}>Inativo (bloqueado)</option></select></label></div>
        <div class="ed-turmas-box" style="margin-top:8px"><div class="campo">Turmas</div><div class="checks">${checks(u.turmas || [], 'ed-t')}</div></div>
        <div class="acoes"><button class="mini primario" data-salvar>Salvar</button>${ehUsuarioInterno(u.email) ? '<span class="suave">Entra com usuário: se esquecer a senha, desative e crie um acesso novo.</span>' : '<button class="mini" data-reset>Enviar e-mail para redefinir senha</button>'}</div></td></tr>`).join('')}
    </tbody></table></div>`;
  const toggleTurmas = () => { $('#np-turmas-box').hidden = $('#np-perfil').value !== 'titular'; };
  $('#np-perfil').onchange = toggleTurmas; toggleTurmas();
  $('#np-criar').onclick = async () => {
    const nome = $('#np-nome').value.trim(), email = $('#np-email').value.trim(), role = $('#np-perfil').value, senha = $('#np-senha').value.trim();
    const turmas = role === 'titular' ? $$('.np-t:checked').map(x => x.value) : [];
    if (!nome || !email) return toast('Preencha o nome e o usuário (ou e-mail).', 'erro');
    if (role === 'titular' && !turmas.length) return toast('Marque pelo menos uma turma para a titular.', 'erro');
    const b = $('#np-criar'); b.disabled = true; b.textContent = 'Criando…';
    try {
      await api.criarUsuario({ nome, email, senha, role, turmas });
      const link = location.origin + location.pathname;
      $('#np-res').innerHTML = `<div class="ok-box">Acesso criado. Envie para ${esc(nome)}:</div><div class="credenciais" id="np-cred">Olá, ${esc(nome)}! Seu acesso ao sistema de notas:
Endereço: ${esc(link)}
${email.includes('@') ? 'E-mail' : 'Usuário'}: ${esc(email.includes('@') ? email : emailParaLogin(loginParaEmail(email)))}
Senha provisória: ${esc(senha)}
Depois de entrar, clique em "Minha senha" (no alto da tela) para criar a sua.</div><div class="acoes"><button class="mini" id="np-copiar">Copiar mensagem</button></div>`;
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

// ================= JANELA (modal) =================
function abrirModal(html, largo) {
  fecharModal();
  const fundo = document.createElement('div'); fundo.className = 'modal-fundo'; fundo.id = 'modal';
  fundo.innerHTML = `<div class="modal ${largo ? 'largo' : ''}" role="dialog" aria-modal="true"><button class="modal-x" aria-label="Fechar">✕</button>${html}</div>`;
  document.body.appendChild(fundo);
  fundo.addEventListener('click', e => { if (e.target === fundo) fecharModal(); });
  $('.modal-x', fundo).onclick = fecharModal;
  return $('.modal', fundo);
}
function fecharModal() { const m = $('#modal'); if (m) m.remove(); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharModal(); });

// ================= AJUDA =================
function abrirAjuda() {
  const p = S.perfil;
  const passo = (t, l) => `<div class="ajuda-item"><h3>${t}</h3><ol>${l.map(x => `<li>${x}</li>`).join('')}</ol></div>`;
  const notas = passo('✏️ Lançar notas', [
    'Clique em <b>Notas</b>.', 'Escolha a turma, a disciplina e o bimestre nos três campos do alto.',
    'Digite a <b>prova</b> (0 a 7) e as <b>atividades</b> (0 a 3). A nota final aparece sozinha.',
    'Digite as <b>faltas</b> do bimestre. Aperte <b>Enter</b> para descer para o próximo aluno.',
    'Não existe botão de salvar: tudo salva sozinho. Confira o aviso <b>✓ Tudo salvo</b> no canto.']);
  const plan = passo('📄 Enviar planejamento', [
    'Clique em <b>Planejamentos</b>.', 'Escreva o período (ex.: Quinzena de 26/10 a 06/11) e marque a turma.',
    'Clique na área tracejada e escolha o arquivo (Word ou PDF, até 6 MB).', 'Clique em <b>Enviar para a coordenação</b>.',
    'Só você e a coordenação veem o arquivo. A resposta da coordenação aparece na mesma tela: <b>Visto</b>, <b>Aprovado</b> ou <b>Ajustar</b> (com o comentário).']);
  const bol = passo('🧾 Boletins', ['Clique em <b>Boletins</b> e escolha a turma.', 'Clique num aluno para ver o boletim na tela.', 'Use <b>Boletins da turma (PDF)</b> para imprimir todos, dois por folha.']);
  const coord = passo('📊 Coordenação', [
    '<b>Início</b> mostra o que falta lançar e quantos planejamentos chegaram.',
    '<b>Planejamentos</b>: baixe o arquivo (ele passa a "Visto") e clique em <b>Aprovar</b> ou <b>Pedir ajuste</b>.',
    '<b>Acompanhamento</b>: quadro de notas lançadas por turma e disciplina.',
    '<b>Cadastros → Professores e acessos</b>: crie acessos e marque as turmas de cada titular.',
    '<b>Escola</b>: feche o bimestre (os professores passam a só consultar) e faça o backup.']);
  abrirModal(`<h2>Como usar</h2>${notas}${plan}${p.role !== 'ingles' ? bol : ''}${isAdmin(p) ? coord : ''}
    <div class="ajuda-item"><h3>🔑 Senha</h3><p>Para trocar sua senha, clique em <b>Minha senha</b>, no alto da tela.</p></div>`, true);
}

function abrirTrocaSenha() {
  const m = abrirModal(`<h2>Minha senha</h2><form id="f-senha" class="pilha">
    <label class="campo">Senha atual<input type="password" id="ts-atual" autocomplete="current-password" required></label>
    <label class="campo">Nova senha (mínimo 6 caracteres)<input type="password" id="ts-nova" autocomplete="new-password" required></label>
    <label class="campo">Repita a nova senha<input type="password" id="ts-nova2" autocomplete="new-password" required></label>
    <div class="acoes"><button class="primario" type="submit">Trocar senha</button></div><div id="ts-msg"></div></form>`);
  $('#f-senha', m).onsubmit = async ev => {
    ev.preventDefault(); const msg = $('#ts-msg', m);
    const nova = $('#ts-nova', m).value;
    if (nova.length < 6) { msg.innerHTML = '<div class="erro">A nova senha precisa ter pelo menos 6 caracteres.</div>'; return; }
    if (nova !== $('#ts-nova2', m).value) { msg.innerHTML = '<div class="erro">As duas senhas novas não conferem.</div>'; return; }
    try { await api.trocarSenha($('#ts-atual', m).value, nova); fecharModal(); toast('Senha trocada. Use a nova no próximo acesso.'); }
    catch (e) { msg.innerHTML = `<div class="erro">${esc(e.code === 'auth/invalid-credential' || e.code === 'auth/wrong-password' ? 'Senha atual incorreta.' : api.msgErro(e))}</div>`; }
  };
}

// ================= INÍCIO =================
async function progressoNotas(bim) {
  // Retorna [{turma, disc, x, y}] do que o usuário pode lançar.
  const ts = turmasDoPerfil(S.perfil, S.turmas), ds = disciplinasDoPerfil(S.perfil);
  const out = [];
  await Promise.all(ts.map(async t => {
    const al = await alunosDe(t.id);
    let pls;
    if (S.perfil.role === 'ingles') pls = [await api.getPlanilha(t.id, 'ingles', bim)].filter(Boolean);
    else pls = (await api.getPlanilhasTurma(t.id)).filter(p => Number(p.bim) === bim);
    ds.forEach(d => {
      const pl = pls.find(p => p.disc === d.id);
      out.push({ turma: t, disc: d, y: al.length, x: al.filter(a => notaFinal(pl && pl.alunos && pl.alunos[a.id]) !== null).length });
    });
  }));
  return out;
}
function chipStatus(st) { const s = STATUS_PLAN[st] || STATUS_PLAN.enviado; return `<span class="st ${s.cls}" title="${s.dica}">${s.nome}</span>`; }

async function viewInicio() {
  const c = $('#conteudo'), p = S.perfil, vivo = marcaVista();
  const bim = Number(S.escola.bimestreAtual) || 1, fechado = !!(S.escola.travas || {})[String(bim)];
  const primeiro = (p.nome || '').split(' ')[0];
  c.innerHTML = `<div class="saudacao"><h1>Olá, ${esc(primeiro)}!</h1><p class="suave">Estamos no <b>${bim}º bimestre</b>${fechado ? ' (fechado para lançamentos)' : ''}.</p></div>
    <div class="atalhos">
      <button class="atalho" data-ir="lancar"><span>✏️</span><b>Lançar notas</b><small>prova, atividades e faltas</small></button>
      <button class="atalho" data-ir="planejamentos"><span>📄</span><b>${isAdmin(p) ? 'Ver planejamentos' : 'Enviar planejamento'}</b><small>${isAdmin(p) ? 'o que as professoras enviaram' : 'direto para a coordenação'}</small></button>
      ${veBoletins(p) ? '<button class="atalho" data-ir="boletins"><span>🧾</span><b>Boletins</b><small>ver e imprimir</small></button>' : ''}
    </div>
    <div class="duas-colunas inicio"><div class="card" id="i-notas"><h2>Notas do ${bim}º bimestre</h2><div class="carregando-bloco">Carregando…</div></div>
    <div class="card" id="i-plan"><h2>Planejamentos</h2><div class="carregando-bloco">Carregando…</div></div></div>`;
  $$('[data-ir]', c).forEach(b => b.onclick = () => irPara(b.dataset.ir));
  // notas
  try {
    if (isAdmin(p)) {
      const [pls, listas] = await Promise.all([api.getPlanilhasBimestre(bim), Promise.all(S.turmas.map(t => alunosDe(t.id)))]);
      if (!vivo()) return;
      const DS = disciplinasDoPerfil(p);
      const linhas = S.turmas.map((t, i) => {
        const al = listas[i]; let x = 0;
        DS.forEach(d => { const pl = pls.find(q => q.turmaId === t.id && q.disc === d.id); x += al.filter(a => notaFinal(pl && pl.alunos && pl.alunos[a.id]) !== null).length; });
        const y = al.length * DS.length; const pc = y ? Math.round(100 * x / y) : 0;
        return `<div class="barra-linha"><span>${esc(t.nome)}</span><div class="barra"><i style="width:${pc}%"></i></div><b>${pc}%</b></div>`;
      }).join('');
      $('#i-notas').innerHTML = `<h2>Notas do ${bim}º bimestre</h2>${linhas || '<div class="vazio">Nenhuma turma cadastrada.</div>'}
        <div class="acoes"><button data-ir="pendencias">Ver quadro completo</button></div>`;
    } else {
      const prog = await progressoNotas(bim);
      if (!vivo()) return;
      const ts = turmasDoPerfil(p, S.turmas), ds = disciplinasDoPerfil(p);
      const cel = (t, d) => { const r = prog.find(q => q.turma.id === t.id && q.disc.id === d.id); if (!r || !r.y) return '<td class="p-vazio">—</td>';
        const cls = r.x === r.y ? 'p-ok' : r.x ? 'p-parc' : 'p-vazio';
        return `<td class="${cls}"><button class="cel" data-t="${t.id}" data-d="${d.id}" title="Abrir ${d.nome} · ${esc(t.nome)}">${r.x === r.y ? '✓' : `${r.x}/${r.y}`}</button></td>`; };
      const falta = prog.reduce((s, r) => s + (r.y - r.x), 0);
      $('#i-notas').innerHTML = `<h2>Notas do ${bim}º bimestre</h2>
        <p class="${falta ? 'aviso' : 'ok-box'}">${falta ? `Faltam <b>${falta}</b> notas. Clique num quadradinho para abrir direto a turma e a disciplina.` : 'Todas as suas notas deste bimestre estão lançadas. 👏'}</p>
        <div class="tabela-wrap"><table class="pend mini-pend"><thead><tr><th class="esq">Turma</th>${ds.map(d => `<th>${d.nome}</th>`).join('')}</tr></thead>
        <tbody>${ts.map(t => `<tr><td class="esq"><b>${esc(t.nome)}</b></td>${ds.map(d => cel(t, d)).join('')}</tr>`).join('')}</tbody></table></div>
        <div class="legenda"><span class="l1">completo</span><span class="l2">em andamento</span><span class="l3">nada lançado</span></div>`;
      $$('.cel', c).forEach(b => b.onclick = () => { S.lanc = { turmaId: b.dataset.t, disc: b.dataset.d, bim }; irPara('lancar'); });
    }
  } catch (e) { if (vivo()) $('#i-notas').innerHTML = `<h2>Notas</h2><div class="erro">${esc(api.msgErro(e))}</div>`; }
  $$('[data-ir]', c).forEach(b => b.onclick = () => irPara(b.dataset.ir));
  // planejamentos
  try {
    const lista = await api.listarPlanejamentos(isAdmin(p));
    if (!vivo()) return;
    const el = $('#i-plan');
    if (isAdmin(p)) {
      const novos = lista.filter(x => x.status === 'enviado').length;
      el.innerHTML = `<h2>Planejamentos</h2>
        <p class="${novos ? 'aviso' : 'ok-box'}">${novos ? `<b>${novos}</b> planejamento(s) aguardando sua leitura.` : 'Nenhum planejamento novo.'}</p>
        ${lista.slice(0, 5).map(x => `<div class="mini-plan">${chipStatus(x.status)} <b>${esc(x.autorNome)}</b> · ${esc(x.periodo)} <span class="suave">${dataBR(x.enviadoEm)}</span></div>`).join('')}
        <div class="acoes"><button class="primario" data-ir="planejamentos">Abrir planejamentos</button></div>`;
    } else {
      const ajustar = lista.filter(x => x.status === 'ajustar');
      el.innerHTML = `<h2>Meus planejamentos</h2>
        ${ajustar.length ? `<div class="aviso">A coordenação pediu ajuste em <b>${ajustar.length}</b> planejamento(s). Veja o comentário em Planejamentos.</div>` : ''}
        ${lista.length ? lista.slice(0, 4).map(x => `<div class="mini-plan">${chipStatus(x.status)} ${esc(x.periodo)} <span class="suave">${dataBR(x.enviadoEm)}</span></div>`).join('') : '<p class="suave">Você ainda não enviou nenhum planejamento por aqui.</p>'}
        <div class="acoes"><button class="primario" data-ir="planejamentos">📄 Enviar planejamento</button></div>`;
    }
    $$('[data-ir]', el).forEach(b => b.onclick = () => irPara(b.dataset.ir));
  } catch (e) { if (vivo()) $('#i-plan').innerHTML = `<h2>Planejamentos</h2><div class="erro">${esc(api.msgErro(e))}</div>`; }
}

// ================= PLANEJAMENTOS =================
async function baixarPlanejamento(x) {
  toast('Baixando…');
  const partes = await api.baixarPartes(x.id, x.partes);
  const bytes = partes.map(b64ParaBytes);
  baixar(x.nomeArquivo, new Blob(bytes, { type: x.tipo || 'application/octet-stream' }));
  if (isAdmin(S.perfil) && x.status === 'enviado') { try { await api.avaliarPlanejamento(x.id, { status: 'visto', avaliadoPorNome: S.perfil.nome || '' }); x.status = 'visto'; } catch (e) {} return true; }
}
const nomesTurmas = ids => (ids || []).map(id => (S.turmas.find(t => t.id === id) || {}).nome || '').filter(Boolean).join(', ');

async function viewPlanejamentos() { return isAdmin(S.perfil) ? planCoordenacao() : planProfessora(); }

async function planProfessora(pre) {
  const c = $('#conteudo'), vivo = marcaVista();
  const ts = turmasDoPerfil(S.perfil, S.turmas);
  const sel = pre ? pre.turmas : (ts.length === 1 ? [ts[0].id] : []);
  c.innerHTML = `<div class="card"><h2>📄 Enviar planejamento</h2>
    <p class="suave">O arquivo vai só para a coordenação. As colegas não veem.</p>
    <div class="passos">
      <div class="passo"><span class="num">1</span><label class="campo">Período<input id="pl-periodo" placeholder="Ex.: Quinzena de 26/10 a 06/11" value="${esc(pre ? pre.periodo : '')}"></label></div>
      <div class="passo"><span class="num">2</span><div class="campo">Turma(s)<div class="checks">${ts.map(t => `<label><input type="checkbox" class="pl-t" value="${t.id}" ${sel.includes(t.id) ? 'checked' : ''}> ${esc(t.nome)}</label>`).join('')}</div></div></div>
      <div class="passo"><span class="num">3</span><div class="campo">Arquivo
        <label class="soltar" id="pl-soltar"><input type="file" id="pl-arq" accept=".doc,.docx,.pdf,.odt,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png" hidden>
        <span id="pl-arq-txt">📎 Clique aqui ou arraste o arquivo (Word ou PDF, até ${tamanhoLegivel(MAX_ARQUIVO)})</span></label></div></div>
      <div class="passo"><span class="num">4</span><label class="campo">Recado para a coordenação (opcional)<input id="pl-nota" placeholder="Ex.: versão corrigida, com a BNCC" value="${esc(pre ? pre.nota : '')}"></label></div>
    </div>
    <div class="acoes"><button class="primario grande" id="pl-enviar">Enviar para a coordenação</button><span id="pl-prog" class="suave"></span></div></div>
    <div class="card"><h2>Meus envios</h2><div id="pl-lista" class="carregando-bloco">Carregando…</div></div>`;
  let arquivo = null;
  const escolher = f => {
    if (!f) return;
    if (f.size > MAX_ARQUIVO) { arquivo = null; $('#pl-arq-txt').textContent = `⚠ ${f.name} tem ${tamanhoLegivel(f.size)}. O limite é ${tamanhoLegivel(MAX_ARQUIVO)}: salve como PDF ou diminua as imagens.`; $('#pl-soltar').classList.add('erro-borda'); return; }
    arquivo = f; $('#pl-soltar').classList.remove('erro-borda'); $('#pl-soltar').classList.add('ok-borda');
    $('#pl-arq-txt').textContent = `✓ ${f.name} (${tamanhoLegivel(f.size)}) — clique para trocar`;
  };
  $('#pl-arq').onchange = e => escolher(e.target.files[0]);
  const z = $('#pl-soltar');
  z.addEventListener('dragover', e => { e.preventDefault(); z.classList.add('arrastando'); });
  z.addEventListener('dragleave', () => z.classList.remove('arrastando'));
  z.addEventListener('drop', e => { e.preventDefault(); z.classList.remove('arrastando'); escolher(e.dataTransfer.files[0]); });
  $('#pl-enviar').onclick = async () => {
    const periodo = $('#pl-periodo').value.trim(), turmas = $$('.pl-t:checked').map(x => x.value);
    if (!periodo) { toast('Escreva o período (passo 1).', 'erro'); $('#pl-periodo').focus(); return; }
    if (!turmas.length) { toast('Marque pelo menos uma turma (passo 2).', 'erro'); return; }
    if (!arquivo) { toast('Escolha o arquivo (passo 3).', 'erro'); return; }
    const b = $('#pl-enviar'); b.disabled = true; b.textContent = 'Enviando…';
    try {
      const partes = await fatiarArquivo(arquivo);
      await api.enviarPlanejamento({ autorNome: S.perfil.nome || '', periodo, turmas, turmasNomes: nomesTurmas(turmas), nota: $('#pl-nota').value.trim(),
        nomeArquivo: arquivo.name, tipo: arquivo.type || '', tamanho: arquivo.size, bimestre: Number(S.escola.bimestreAtual) || null }, partes);
      toast('Planejamento enviado para a coordenação. ✓'); planProfessora();
    } catch (e) { toast('Não foi possível enviar: ' + api.msgErro(e), 'erro'); b.disabled = false; b.textContent = 'Enviar para a coordenação'; }
  };
  let lista;
  try { lista = await api.listarPlanejamentos(false); } catch (e) { if (vivo()) $('#pl-lista').innerHTML = `<div class="erro">${esc(api.msgErro(e))}</div>`; return; }
  if (!vivo()) return;
  const el = $('#pl-lista'); el.className = '';
  if (!lista.length) { el.innerHTML = '<div class="vazio">Nenhum envio ainda.</div>'; return; }
  el.innerHTML = lista.map(x => `<div class="plan ${x.status}" data-id="${x.id}">
      <div class="plan-cab">${chipStatus(x.status)}<b>${esc(x.periodo)}</b><span class="suave">${esc(x.turmasNomes || nomesTurmas(x.turmas))} · enviado em ${dataBR(x.enviadoEm)}</span></div>
      <div class="plan-arq">📎 ${esc(x.nomeArquivo)} <span class="suave">(${tamanhoLegivel(x.tamanho || 0)})</span></div>
      ${x.nota ? `<div class="suave">Seu recado: ${esc(x.nota)}</div>` : ''}
      ${x.comentario ? `<div class="comentario"><b>Coordenação:</b> ${esc(x.comentario)}</div>` : ''}
      <div class="acoes"><button class="mini" data-baixar>⤓ Baixar</button>
        ${x.status === 'ajustar' ? '<button class="mini primario" data-reenviar>Enviar versão corrigida</button>' : ''}
        ${x.status === 'enviado' ? '<button class="mini perigo" data-excluir>Cancelar envio</button>' : ''}</div></div>`).join('');
  const achar = b => lista.find(x => x.id === b.closest('.plan').dataset.id);
  $$('[data-baixar]', el).forEach(b => b.onclick = () => baixarPlanejamento(achar(b)).catch(e => toast(api.msgErro(e), 'erro')));
  $$('[data-reenviar]', el).forEach(b => b.onclick = () => { const x = achar(b); planProfessora({ periodo: x.periodo, turmas: x.turmas, nota: 'Versão corrigida' }); window.scrollTo(0, 0); });
  $$('[data-excluir]', el).forEach(b => b.onclick = async () => {
    const x = achar(b); if (!confirm(`Cancelar o envio de "${x.periodo}"?`)) return;
    try { await api.excluirPlanejamento(x.id, x.partes); toast('Envio cancelado.'); planProfessora(); } catch (e) { toast(api.msgErro(e), 'erro'); }
  });
}

async function planCoordenacao() {
  const c = $('#conteudo'), vivo = marcaVista(), f = S.plan;
  c.innerHTML = `<div class="card"><h2>📄 Planejamentos recebidos</h2><div id="pc-res"></div>
    <div class="filtros">
      <label>Mostrar<select id="pc-st"><option value="novos">Novos (ainda não lidos)</option><option value="ajustar">Pedidos de ajuste</option><option value="aprovado">Aprovados</option><option value="todos">Todos</option></select></label>
      <label>Professora<select id="pc-prof"><option value="">Todas</option></select></label>
      <button id="pc-atual">↻ Atualizar</button></div>
    <div id="pc-lista" class="carregando-bloco">Carregando…</div></div>
    <div class="card"><h2>Último envio de cada professora</h2><div id="pc-ult" class="suave">Carregando…</div></div>`;
  $('#pc-st').value = f.status;
  let lista;
  try { lista = await api.listarPlanejamentos(true); } catch (e) { if (vivo()) $('#pc-lista').innerHTML = `<div class="erro">${esc(api.msgErro(e))}</div>`; return; }
  if (!vivo()) return;
  const profs = [...new Map(lista.map(x => [x.autorUid, x.autorNome])).entries()].sort((a, b) => (a[1] || '').localeCompare(b[1] || '', 'pt-BR'));
  $('#pc-prof').innerHTML += profs.map(([u, n]) => `<option value="${u}" ${u === f.prof ? 'selected' : ''}>${esc(n)}</option>`).join('');
  $('#pc-st').onchange = () => { f.status = $('#pc-st').value; desenhar(); };
  $('#pc-prof').onchange = () => { f.prof = $('#pc-prof').value; desenhar(); };
  $('#pc-atual').onclick = () => planCoordenacao();
  function desenhar() {
    const novos = lista.filter(x => x.status === 'enviado').length;
    $('#pc-res').innerHTML = `<div class="${novos ? 'aviso' : 'ok-box'}">${novos ? `<b>${novos}</b> novo(s) aguardando leitura. Ao baixar, o envio passa para "Visto" e a professora fica sabendo.` : 'Nenhum envio novo.'}</div>`;
    $('#pc-ult').innerHTML = profs.length ? `<div class="tabela-wrap"><table><thead><tr><th class="esq">Professora</th><th class="esq">Último período enviado</th><th>Data</th><th>Situação</th></tr></thead><tbody>${
      profs.map(([u, n]) => { const x = lista.find(y => y.autorUid === u); return `<tr><td class="esq">${esc(n)}</td><td class="esq">${esc(x.periodo)}</td><td>${dataBR(x.enviadoEm)}</td><td>${chipStatus(x.status)}</td></tr>`; }).join('')}</tbody></table></div>`
      : 'Ninguém enviou ainda.';
    const el = $('#pc-lista'); el.className = '';
    const filtro = x => (f.status === 'todos' || (f.status === 'novos' ? x.status === 'enviado' : x.status === f.status)) && (!f.prof || x.autorUid === f.prof);
    const l = lista.filter(filtro);
    if (!l.length) { el.innerHTML = `<div class="vazio">Nada aqui. ${f.status === 'novos' ? 'Para ver os já lidos, escolha "Todos" em Mostrar.' : ''}</div>`; return; }
    el.innerHTML = l.map(x => `<div class="plan ${x.status}" data-id="${x.id}">
      <div class="plan-cab">${chipStatus(x.status)}<b>${esc(x.autorNome)}</b> · ${esc(x.periodo)}<span class="suave">${esc(x.turmasNomes || nomesTurmas(x.turmas))} · ${dataBR(x.enviadoEm)}</span></div>
      <div class="plan-arq">📎 ${esc(x.nomeArquivo)} <span class="suave">(${tamanhoLegivel(x.tamanho || 0)})</span></div>
      ${x.nota ? `<div class="suave">Recado da professora: ${esc(x.nota)}</div>` : ''}
      ${x.comentario ? `<div class="comentario"><b>Seu comentário:</b> ${esc(x.comentario)}</div>` : ''}
      <div class="acoes"><button class="mini primario" data-baixar>⤓ Baixar e ler</button>
        <button class="mini ok" data-aprovar>✓ Aprovar</button><button class="mini" data-ajuste>✎ Pedir ajuste</button>
        <button class="mini perigo" data-excluir title="Apagar este envio">🗑</button></div></div>`).join('');
    const achar = b => lista.find(x => x.id === b.closest('.plan').dataset.id);
    $$('[data-baixar]', el).forEach(b => b.onclick = async () => { try { if (await baixarPlanejamento(achar(b))) desenhar(); } catch (e) { toast(api.msgErro(e), 'erro'); } });
    $$('[data-aprovar]', el).forEach(b => b.onclick = async () => { const x = achar(b);
      try { await api.avaliarPlanejamento(x.id, { status: 'aprovado', comentario: x.comentario || '', avaliadoPorNome: S.perfil.nome || '' }); x.status = 'aprovado'; toast('Aprovado.'); desenhar(); } catch (e) { toast(api.msgErro(e), 'erro'); } });
    $$('[data-ajuste]', el).forEach(b => b.onclick = () => { const x = achar(b);
      const m = abrirModal(`<h2>Pedir ajuste</h2><p class="suave">${esc(x.autorNome)} · ${esc(x.periodo)}</p>
        <textarea id="aj-txt" placeholder="O que precisa mudar? A professora vê este comentário.">${esc(x.comentario || '')}</textarea>
        <div class="acoes"><button class="primario" id="aj-ok">Enviar pedido de ajuste</button><button id="aj-x">Cancelar</button></div>`);
      $('#aj-txt', m).focus(); $('#aj-x', m).onclick = fecharModal;
      $('#aj-ok', m).onclick = async () => { const t = $('#aj-txt', m).value.trim(); if (!t) { toast('Escreva o que precisa ajustar.', 'erro'); return; }
        try { await api.avaliarPlanejamento(x.id, { status: 'ajustar', comentario: t, avaliadoPorNome: S.perfil.nome || '' }); x.status = 'ajustar'; x.comentario = t; fecharModal(); toast('Pedido de ajuste enviado.'); desenhar(); } catch (e) { toast(api.msgErro(e), 'erro'); } };
    });
    $$('[data-excluir]', el).forEach(b => b.onclick = async () => { const x = achar(b);
      if (!confirm(`Apagar o envio de ${x.autorNome} (${x.periodo})? O arquivo some para as duas.`)) return;
      try { await api.excluirPlanejamento(x.id, x.partes); lista = lista.filter(y => y.id !== x.id); toast('Envio apagado.'); desenhar(); } catch (e) { toast(api.msgErro(e), 'erro'); } });
  }
  desenhar();
}
