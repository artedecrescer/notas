// Testes de tela contra o EMULADOR do Firebase (Auth + Firestore), com as regras de segurança reais.
// Roda no GitHub Actions a cada mudança: `npm run test:tela`. Só usa dados fictícios.
// Cada etapa usa a tela como a coordenação e as professoras usam, e depois confere o resultado
// direto no banco (o que a camada de demonstração não consegue provar).
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const RAIZ = path.resolve('.');
const PORTA = 8765;
const BASE = `http://127.0.0.1:${PORTA}/index.html?emulador`;
const SENHA = 'senha123';
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };

// ---------- servidor estático do próprio site ----------
const servidor = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const arq = path.join(RAIZ, url === '/' ? 'index.html' : url);
  if (!arq.startsWith(RAIZ) || !fs.existsSync(arq) || fs.statSync(arq).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arq)] || 'application/octet-stream' });
  fs.createReadStream(arq).pipe(res);
});
await new Promise(r => servidor.listen(PORTA, '127.0.0.1', r));

// ---------- banco de teste (leitura/gravação sem regras, só para preparar e conferir) ----------
const env = await initializeTestEnvironment({ projectId: 'demo-notas',
  firestore: { rules: fs.readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8085 } });
await env.clearFirestore();
await fetch('http://127.0.0.1:9099/emulator/v1/projects/demo-notas/accounts', { method: 'DELETE' });
// withSecurityRulesDisabled não devolve o resultado do callback: guardamos numa variável.
const semRegras = async fn => { let r; await env.withSecurityRulesDisabled(async ctx => { r = await fn(ctx.firestore()); }); return r; };
const ler = p => semRegras(async db => { const s = await db.doc(p).get(); return s.exists ? s.data() : null; });
const gravar = (p, d, merge = false) => semRegras(db => db.doc(p).set(d, { merge }));
const listar = c => semRegras(async db => (await db.collection(c).get()).docs.map(d => ({ id: d.id, ...d.data() })));

// ---------- relatório ----------
let ok = 0; const falhas = [];
function confere(nome, cond, detalhe = '') { if (cond) { ok++; console.log('  ✓', nome); } else { falhas.push(nome); console.log('  ✗', nome, detalhe); if (process.env.CI) console.log(`::error::${nome} ${String(detalhe).slice(0, 300)}`); } }
async function etapa(nome, fn) {
  console.log('— ' + nome);
  try { await fn(); } catch (e) { falhas.push(nome + ' (erro)'); console.log('  ✗ ERRO:', e.message.split('\n')[0]); if (process.env.CI) console.log(`::error::${nome}: ${e.message.split('\n')[0].slice(0, 300)}`); await page.screenshot({ path: `falha-${falhas.length}.png` }).catch(() => {}); }
}
async function esperar(fn, ms = 10000) { const fim = Date.now() + ms; let v; while (Date.now() < fim) { v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 250)); } return v; }

// ---------- navegador ----------
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 1500 } });
const page = await ctx.newPage();
const errosPagina = [];
page.on('pageerror', e => errosPagina.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errosPagina.push(m.text()); });
page.on('dialog', d => d.accept());
const w = ms => page.waitForTimeout(ms);
const texto = async s => ((await page.textContent(s).catch(() => '')) || '').replace(/\s+/g, ' ').trim();

async function sair() { if (await page.$('#sair')) { await page.click('#sair'); await page.waitForSelector('#f-login'); } }
async function entrar(usuario, senha = SENHA) {
  await page.goto(BASE); await page.waitForSelector('#f-login, #conteudo');
  await sair();
  await page.fill('#l-email', usuario); await page.fill('#l-senha', senha); await page.click('#f-login button[type=submit]');
  return page.waitForSelector('#conteudo', { timeout: 8000 }).then(() => true).catch(() => false);
}
async function aba(v) { await page.click(`[data-view="${v}"]`); await w(700); }
async function sub(s) { await page.click(`[data-sub="${s}"]`); await w(800); }
async function linhaAluno(nome) { return page.locator('#sub tbody tr[data-id]').filter({ has: page.locator(`.a-nome[value="${nome}"]`) }); }

// =====================================================================================
await etapa('Primeiro acesso: cria a coordenação', async () => {
  await page.goto(BASE); await page.waitForSelector('#f-setup');
  await page.fill('#s-escola', 'Escola Teste'); await page.fill('#s-ano', '2026'); await page.fill('#s-coord', 'COORD TESTE');
  await page.fill('#s-nome', 'Coordenação'); await page.fill('#s-email', 'coord'); await page.fill('#s-senha', SENHA); await page.fill('#s-senha2', SENHA);
  await page.click('#f-setup button[type=submit]'); await page.waitForSelector('#conteudo', { timeout: 10000 });
  const e = await ler('config/escola');
  confere('escola criada em 2026, já marcada como formato novo', e && e.ano === '2026' && e.versaoDados === 2, JSON.stringify(e));
});

await etapa('Migração do formato antigo (só cópia, conferida)', async () => {
  // Dados fictícios no formato ANTIGO: planilhas turma__disc__bim e alunos sem matrícula.
  await gravar('turmas/t1', { nome: '1º ano', ordem: 1, professora: 'PROF UM' });
  await gravar('turmas/t2', { nome: '2º ano', ordem: 2, professora: 'PROF DOIS' });
  await gravar('turmas/t3', { nome: '3º ano', ordem: 3, professora: 'PROF TRES' });
  const al = { carla: ['CARLA SOUZA', 't1', 1], ana: ['ANA LIMA', 't1', 2], bruno: ['BRUNO REIS', 't1', 3], davi: ['DAVI COSTA', 't2', 1], eva: ['EVA NUNES', 't3', 1] };
  for (const [id, [nome, turmaId, ordem]] of Object.entries(al)) await gravar(`alunos/${id}`, { nome, turmaId, ordem });
  await gravar('planilhas/t1__portugues__1', { turmaId: 't1', disc: 'portugues', bim: 1, alunos: {
    carla: { prova: 6, atv: 2.5, faltas: 1, obs: '' }, ana: { prova: 5.5, atv: 3, faltas: 0, obs: 'ótima' }, bruno: { final: 7.2 } } });
  await gravar('planilhas/t1__matematica__1', { turmaId: 't1', disc: 'matematica', bim: 1, alunos: { carla: { prova: 4, atv: 2, faltas: 2 } } });
  await gravar('planilhas/t2__portugues__1', { turmaId: 't2', disc: 'portugues', bim: 1, alunos: { davi: { prova: 7, atv: 3 } } });
  await gravar('config/escola', { versaoDados: 0 }, true);
  await page.reload(); await page.waitForSelector('#conteudo');
  const migrou = await esperar(async () => ((await ler('config/escola')) || {}).versaoDados === 2, 15000);
  confere('migração terminou e se marcou como concluída', migrou);
  for (const id of ['t1__portugues__1', 't1__matematica__1', 't2__portugues__1']) {
    const [antigo, novo] = await Promise.all([ler('planilhas/' + id), ler('planilhas/2026__' + id)]);
    confere(`cópia de ${id} idêntica e com ano`, novo && novo.ano === '2026' && JSON.stringify(novo.alunos) === JSON.stringify(antigo.alunos));
    confere(`original ${id} continua no banco`, !!antigo);
  }
  const alunos = await listar('alunos');
  confere('todos os alunos com matrícula de 2026', alunos.every(a => a.matriculas && a.matriculas['2026'] === a.turmaId), JSON.stringify(alunos.map(a => a.matriculas)));
  await gravar('config/escola', { travas: { '1': false, '2': false, '3': false, '4': false } }, true);
});

await etapa('Cadastro de acessos pela coordenação', async () => {
  await page.reload(); await page.waitForSelector('#conteudo');
  await aba('cadastros'); await sub('professores');
  const criar = async (nome, usuario, perfil, turma) => {
    await page.fill('#np-nome', nome); await page.fill('#np-email', usuario); await page.selectOption('#np-perfil', perfil);
    if (turma) await page.check(`.np-t[value="${turma}"]`);
    await page.fill('#np-senha', SENHA); await page.click('#np-criar'); await w(2000);
  };
  await criar('Tita Teste', 'tita', 'titular', 't1');
  await criar('Ingrid Teste', 'ingrid', 'ingles');
  const users = await listar('users');
  confere('titular criada com a turma certa', users.some(u => u.nome === 'Tita Teste' && u.role === 'titular' && u.turmas.includes('t1')));
  confere('professora de inglês criada', users.some(u => u.nome === 'Ingrid Teste' && u.role === 'ingles'));
  confere('mapa de usuário gravado', !!(await ler('logins/tita')));
});

await etapa('Lançamento de notas pela titular', async () => {
  confere('titular entra com usuário e senha', await entrar('tita'));
  await aba('lancar');
  confere('titular não vê Inglês', !(await page.$$eval('#l-disc option', o => o.map(x => x.value))).includes('ingles'));
  await page.selectOption('#l-turma', 't1'); await w(500); await page.selectOption('#l-disc', 'portugues'); await w(500); await page.selectOption('#l-bim', '1'); await w(1200);
  const tr = page.locator('#tabela-lanc tr[data-id="carla"]');
  await tr.locator('input[data-k="prova"]').fill('6,5'); await page.keyboard.press('Tab'); await w(300);
  await tr.locator('input[data-k="atv"]').fill('9'); await page.keyboard.press('Tab');   // acima de 3: ajusta para 3
  const salvo = await esperar(async () => { const p = await ler('planilhas/2026__t1__portugues__1'); return p && p.alunos.carla.prova === 6.5 && p.alunos.carla.atv === 3 && p; });
  confere('nota gravada no banco (e atividade ajustada para 3)', !!salvo, JSON.stringify(salvo && salvo.alunos.carla));
  confere('lançamento não apaga as outras alunas', salvo && salvo.alunos.ana.obs === 'ótima' && salvo.alunos.bruno.final === 7.2);
  confere('planilha antiga não foi tocada', (await ler('planilhas/t1__portugues__1')).alunos.carla.prova === 6);
});

await etapa('Ordenar A–Z e Salvar alterações preservam nome e turma', async () => {
  await entrar('coord'); await aba('cadastros'); await sub('alunos');
  await page.selectOption('#ca-turma', 't1'); await w(900);
  await page.click('#ca-az'); await w(1500);
  const t1 = (await listar('alunos')).filter(a => ['ana', 'bruno', 'carla'].includes(a.id));
  confere('A–Z: nomes e turmas intactos', t1.length === 3 && t1.every(a => a.nome && a.turmaId === 't1' && a.matriculas['2026'] === 't1'), JSON.stringify(t1));
  confere('A–Z: ordem alfabética gravada', t1.find(a => a.id === 'ana').ordem === 1 && t1.find(a => a.id === 'bruno').ordem === 2 && t1.find(a => a.id === 'carla').ordem === 3);
  await (await linhaAluno('BRUNO REIS')).locator('.a-nome').fill('BRUNO REIS SILVA'); await page.click('#ca-salvar'); await w(1500);
  const b = await ler('alunos/bruno');
  confere('Salvar alterações: nome novo, turma/ordem/matrícula mantidas', b.nome === 'BRUNO REIS SILVA' && b.turmaId === 't1' && b.ordem === 2 && b.matriculas['2026'] === 't1', JSON.stringify(b));
});

await etapa('Mudança de turma leva as notas do ano', async () => {
  await (await linhaAluno('CARLA SOUZA')).locator('.a-turma').selectOption('t2'); await page.click('#ca-salvar'); await w(2500);
  const [c, pt2, mt2, pt1] = await Promise.all([ler('alunos/carla'), ler('planilhas/2026__t2__portugues__1'), ler('planilhas/2026__t2__matematica__1'), ler('planilhas/2026__t1__portugues__1')]);
  confere('aluna agora no 2º ano', c.turmaId === 't2' && c.matriculas['2026'] === 't2');
  confere('português foi junto (6,5 / 3)', pt2 && pt2.alunos.carla && pt2.alunos.carla.prova === 6.5 && pt2.alunos.carla.atv === 3, JSON.stringify(pt2 && pt2.alunos));
  confere('matemática foi junto (planilha criada na turma nova)', mt2 && mt2.alunos.carla && mt2.alunos.carla.prova === 4);
  confere('as notas também continuam na turma antiga', pt1.alunos.carla.prova === 6.5);
  confere('o colega do 2º ano não foi alterado', pt2.alunos.davi.prova === 7);
});

await etapa('Aluno com notas não pode ter o cadastro apagado', async () => {
  await page.selectOption('#ca-turma', 't2'); await w(900);
  await (await linhaAluno('CARLA SOUZA')).locator('[data-excluir]').click(); await w(1200);
  confere('tela não oferece apagar', !(await page.$('#sa-apagar')));
  await page.keyboard.press('Escape');
  await page.fill('#ca-novos', 'CADASTRO ENGANO'); await page.click('#ca-add'); await w(1500);
  await (await linhaAluno('CADASTRO ENGANO')).locator('[data-excluir]').click(); await w(1200);
  confere('cadastro sem nota pode ser apagado', !!(await page.$('#sa-apagar')));
  await page.click('#sa-apagar'); await w(1200);
  confere('cadastro feito por engano saiu do banco', !(await listar('alunos')).some(a => a.nome === 'CADASTRO ENGANO'));
});

await etapa('Saída e volta de aluno, com as notas guardadas', async () => {
  await (await linhaAluno('CARLA SOUZA')).locator('[data-excluir]').click(); await w(1000);
  await page.fill('#sa-motivo', 'transferência'); await page.click('#sa-ok'); await w(1500);
  const c = await ler('alunos/carla');
  confere('saída registrada sem apagar', c && c.turmaId === '' && c.saida && c.saida.ano === '2026' && c.saida.motivo === 'transferência');
  await page.selectOption('#ca-turma', 't3'); await w(1200);
  await page.locator('#ca-saidas tr', { hasText: 'CARLA SOUZA' }).locator('[data-volta]').click(); await w(2500);
  const [c2, pt3] = await Promise.all([ler('alunos/carla'), ler('planilhas/2026__t3__portugues__1')]);
  confere('voltou para o 3º ano', c2.turmaId === 't3' && c2.matriculas['2026'] === 't3');
  confere('notas foram junto para o 3º ano', pt3 && pt3.alunos.carla && pt3.alunos.carla.prova === 6.5);
});

await etapa('Gerar nova senha e excluir acesso', async () => {
  await aba('cadastros'); await sub('professores');
  const lt = page.locator('tr[data-uid]', { hasText: 'Tita Teste' });
  await lt.locator('[data-editar]').click(); await w(300);
  await page.locator('tr.edicao:not([hidden]) [data-nova]').click(); await w(400);
  await page.fill('#ns-senha', 'nova1234'); await page.click('#ns-ok'); await w(3000);
  confere('mensagem com a nova senha', (await texto('#np-res')).includes('nova1234'));
  const li = page.locator('tr[data-uid]', { hasText: 'Ingrid Teste' });
  await li.locator('[data-editar]').click(); await w(300);
  await page.locator('tr.edicao:not([hidden]) [data-excluir]').click(); await w(400); await page.click('#ex-ok'); await w(1500);
  const users = await listar('users');
  confere('acesso excluído saiu do banco', !users.some(u => u.nome === 'Ingrid Teste'));
  const tita = users.find(u => u.nome === 'Tita Teste');
  confere('nova conta guarda a anterior (planejamentos antigos)', tita && (tita.uidsAnteriores || []).length === 1);
  confere('titular entra com a senha nova', await entrar('tita', 'nova1234'));
  confere('senha antiga não entra mais', !(await entrar('tita', SENHA)));
  confere('acesso excluído não entra no sistema', !(await entrar('ingrid')) || !!(await page.$('#f-login')) || !(await page.$('[data-view="lancar"]')));
});

await etapa('Planejamento: envio, pedido de ajuste e aprovação', async () => {
  await entrar('tita', 'nova1234'); await aba('planejamentos');
  await page.fill('#pl-periodo', 'Quinzena de teste'); await page.check('.pl-t');
  await page.setInputFiles('#pl-arq', { name: 'plano.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 plano de teste '.repeat(2000)) });
  await page.click('#pl-enviar'); await w(3000);
  let pl = (await listar('planejamentos'))[0];
  confere('planejamento gravado como enviado, com o nome da autora', pl && pl.status === 'enviado' && pl.autorNome === 'Tita Teste' && pl.partes >= 1, JSON.stringify(pl && { ...pl, enviadoEm: 0 }));
  await entrar('coord'); await aba('planejamentos'); await w(800);
  await page.click('[data-ajuste]'); await w(300); await page.fill('#aj-txt', 'Faltou a BNCC'); await page.click('#aj-ok'); await w(1500);
  pl = await ler('planejamentos/' + pl.id);
  confere('pedido de ajuste gravado', pl.status === 'ajustar' && pl.comentario === 'Faltou a BNCC');
  await page.selectOption('#pc-st', 'todos'); await w(500); await page.click('[data-aprovar]'); await w(1500);
  confere('aprovado', (await ler('planejamentos/' + (await listar('planejamentos'))[0].id)).status === 'aprovado');
  await entrar('tita', 'nova1234'); await aba('planejamentos'); await w(800);
  confere('professora vê a resposta da coordenação', (await texto('#pl-lista')).includes('Faltou a BNCC'));
});

let backup2026 = null;
await etapa('Virada do ano 2026 → 2027', async () => {
  await entrar('coord'); await aba('escola'); await page.click('#e-virada'); await page.waitForSelector('#v-conf');
  await page.fill('#v-conf', '2027');
  confere('botão bloqueado sem a cópia de segurança', await page.$eval('#v-ok', b => b.disabled));
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#v-backup')]);
  backup2026 = await dl.path(); await w(500);
  confere('botão liberado depois do backup', !(await page.$eval('#v-ok', b => b.disabled)));
  const antes = JSON.stringify((await listar('planilhas')).filter(p => p.ano === '2026').map(p => [p.id, p.alunos]));
  await page.click('#v-ok'); await esperar(async () => ((await ler('config/escola')) || {}).ano === '2027', 10000); await w(1000);
  const [e, a26, al] = await Promise.all([ler('config/escola'), ler('anos/2026'), listar('alunos')]);
  confere('ano letivo agora é 2027, 1º bimestre, sem travas', e.ano === '2027' && e.bimestreAtual === 1 && !Object.values(e.travas).some(Boolean));
  confere('2026 arquivado com turmas e coordenadora', a26 && a26.turmas.t1.professora === 'PROF UM' && a26.escola.coordenadora === 'COORD TESTE');
  const ana = al.find(a => a.id === 'ana'), eva = al.find(a => a.id === 'eva');
  confere('aluno do 1º ano passou para o 2º', ana.turmaId === 't2' && ana.matriculas['2026'] === 't1' && ana.matriculas['2027'] === 't2');
  confere('aluno do último ano concluiu, com histórico', eva.turmaId === '' && eva.matriculas['2026'] === 't3');
  const depois = JSON.stringify((await listar('planilhas')).filter(p => p.ano === '2026').map(p => [p.id, p.alunos]));
  confere('nenhuma nota de 2026 mudou na virada', antes === depois);
  await aba('boletins'); await page.selectOption('#b-ano', '2026'); await w(1000); await page.selectOption('#b-turma', 't1'); await w(1200);
  confere('boletim de 2026 continua disponível', (await page.$$('#b-lista button')).length >= 2);
});

await etapa('2026 encerrado fica só para leitura', async () => {
  confere('titular entra em 2027', await entrar('tita', 'nova1234'));
  await aba('lancar');
  confere('cabeçalho mostra 2027', (await texto('.escola')).includes('2027'));
  const tentativa = await page.evaluate(async () => {
    const fb = await import('/vendor/firebase.js');
    const app = fb.initializeApp({ apiKey: 'demo-chave', authDomain: 'localhost', projectId: 'demo-notas', appId: 'demo' }, 'invasao');
    const auth = fb.getAuth(app); fb.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    const db = fb.getFirestore(app); fb.connectFirestoreEmulator(db, '127.0.0.1', 8085);
    await fb.signInWithEmailAndPassword(auth, (await fb.getDoc(fb.doc(db, 'logins', 'tita'))).data().email, 'nova1234');
    try { await fb.setDoc(fb.doc(db, 'planilhas', '2026__t1__portugues__1'), { ano: '2026', turmaId: 't1', disc: 'portugues', bim: 1, alunos: { ana: { prova: 0 } } }, { merge: true }); return 'gravou'; }
    catch (e) { return e.code; }
  });
  confere('titular NÃO consegue alterar nota de 2026 (nem por fora da tela)', tentativa === 'permission-denied', tentativa);
});

await etapa('Restaurar backup de 2026 não mexe em 2027', async () => {
  await entrar('coord'); await aba('escola');
  await page.setInputFiles('#x-file', backup2026); await w(4000);
  const [e, al] = await Promise.all([ler('config/escola'), listar('alunos')]);
  confere('continua em 2027', e.ano === '2027');
  confere('alunos continuam nas turmas de 2027', al.find(a => a.id === 'ana').turmaId === 't2' && al.find(a => a.id === 'eva').turmaId === '');
  confere('notas de 2026 continuam iguais', (await ler('planilhas/2026__t1__portugues__1')).alunos.carla.prova === 6.5);
});

confere('nenhum erro de JavaScript nas telas', !errosPagina.length, JSON.stringify(errosPagina.slice(0, 5)));

console.log(`\nRESULTADO: ${ok} passaram, ${falhas.length} falharam`);
if (falhas.length) console.log('FALHAS:', falhas);
await browser.close(); await env.cleanup(); servidor.close();
process.exit(falhas.length ? 1 : 0);
