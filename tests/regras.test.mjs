import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import fs from 'fs';
const env = await initializeTestEnvironment({ projectId: 'demo-notas',
  firestore: { rules: fs.readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8085 } });
let ok = 0, falhas = [];
async function t(nome, p) { try { await p; ok++; console.log('  ✓', nome); } catch (e) { falhas.push(nome); console.log('  ✗', nome, '-', e.message.split('\n')[0]); } }
const db = uid => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore();
const P = (t, d, b) => `${t}__${d}__${b}`;

console.log('— Primeiro acesso (bootstrap)');
await t('anônimo lê config/setup', assertSucceeds(db().doc('config/setup').get()));
await t('anônimo NÃO lê turmas', assertFails(db().collection('turmas').get()));
await t('A cria-se admin + setup (lote)', assertSucceeds((() => { const d = db('A'); const b = d.batch();
  b.set(d.doc('users/A'), { nome: 'Coord', role: 'admin', turmas: [], ativo: true }); b.set(d.doc('config/setup'), { por: 'A' }); return b.commit(); })()));
await t('B NÃO consegue virar admin depois', assertFails(db('B').doc('users/B').set({ nome: 'X', role: 'admin', turmas: [], ativo: true })));
await t('B NÃO recria setup', assertFails((() => { const d = db('B'); const b = d.batch();
  b.set(d.doc('users/B'), { role: 'admin', ativo: true, turmas: [] }); b.set(d.doc('config/setup'), { por: 'B' }); return b.commit(); })()));

console.log('— Admin monta a escola');
const A = db('A');
await t('admin cria config/escola', assertSucceeds(A.doc('config/escola').set({ nome: 'E', travas: { '1': false, '2': false, '3': false, '4': false } })));
await t('admin cria turmas', assertSucceeds(Promise.all([A.doc('turmas/t1').set({ nome: '1º' }), A.doc('turmas/t2').set({ nome: '2º' })])));
await t('admin cria alunos', assertSucceeds(Promise.all([A.doc('alunos/a1').set({ nome: 'Ana', turmaId: 't1' }), A.doc('alunos/a2').set({ nome: 'Bia', turmaId: 't2' })])));
await t('admin cria titular e inglês', assertSucceeds(Promise.all([
  A.doc('users/T').set({ nome: 'Tit', role: 'titular', turmas: ['t1'], ativo: true }),
  A.doc('users/I').set({ nome: 'Ing', role: 'ingles', turmas: [], ativo: true })])));
await t('admin lista usuários', assertSucceeds(A.collection('users').get()));

console.log('— Titular (turma t1)');
const T = db('T');
await t('lê planilha vazia da sua turma', assertSucceeds(T.doc('planilhas/' + P('t1', 'portugues', 3)).get()));
await t('lança Português na sua turma', assertSucceeds(T.doc('planilhas/' + P('t1', 'portugues', 3)).set({ turmaId: 't1', disc: 'portugues', bim: 3, alunos: { a1: { prova: 6, atv: 3 } } }, { merge: true })));
await t('NÃO lança Inglês', assertFails(T.doc('planilhas/' + P('t1', 'ingles', 3)).set({ turmaId: 't1', disc: 'ingles', bim: 3, alunos: {} })));
await t('NÃO lança em outra turma', assertFails(T.doc('planilhas/' + P('t2', 'portugues', 3)).set({ turmaId: 't2', disc: 'portugues', bim: 3, alunos: {} })));
await t('NÃO lê planilha de outra turma', assertFails(T.doc('planilhas/' + P('t2', 'portugues', 3)).get()));
await t('NÃO falsifica turma no conteúdo', assertFails(T.doc('planilhas/' + P('t1', 'matematica', 3)).set({ turmaId: 't2', disc: 'matematica', bim: 3, alunos: {} })));
await t('NÃO usa disciplina inventada', assertFails(T.doc('planilhas/' + P('t1', 'xadrez', 3)).set({ turmaId: 't1', disc: 'xadrez', bim: 3, alunos: {} })));
await t('lista planilhas da sua turma', assertSucceeds(T.collection('planilhas').where('turmaId', '==', 't1').get()));
await t('NÃO lista planilhas de outra turma', assertFails(T.collection('planilhas').where('turmaId', '==', 't2').get()));
await t('lista alunos da sua turma', assertSucceeds(T.collection('alunos').where('turmaId', '==', 't1').get()));
await t('NÃO lista alunos de outra turma', assertFails(T.collection('alunos').where('turmaId', '==', 't2').get()));
await t('NÃO lista usuários', assertFails(T.collection('users').get()));
await t('NÃO se promove a admin', assertFails(T.doc('users/T').update({ role: 'admin' })));
await t('NÃO cadastra aluno', assertFails(T.doc('alunos/x').set({ nome: 'Z', turmaId: 't1' })));
await t('NÃO altera dados da escola', assertFails(T.doc('config/escola').update({ nome: 'hack' })));

console.log('— Professor de Inglês');
const I = db('I');
await t('lança Inglês na t1', assertSucceeds(I.doc('planilhas/' + P('t1', 'ingles', 3)).set({ turmaId: 't1', disc: 'ingles', bim: 3, alunos: { a1: { prova: 7, atv: 3 } } })));
await t('lança Inglês na t2', assertSucceeds(I.doc('planilhas/' + P('t2', 'ingles', 3)).set({ turmaId: 't2', disc: 'ingles', bim: 3, alunos: {} })));
await t('NÃO lança Português', assertFails(I.doc('planilhas/' + P('t1', 'portugues', 3)).set({ turmaId: 't1', disc: 'portugues', bim: 3, alunos: {} })));
await t('NÃO lê Português', assertFails(I.doc('planilhas/' + P('t1', 'portugues', 3)).get()));
await t('lista alunos de qualquer turma', assertSucceeds(I.collection('alunos').where('turmaId', '==', 't2').get()));

console.log('— Boletim: titular lê todas as disciplinas da sua turma (inclusive Inglês)');
await t('titular lê Inglês da sua turma', assertSucceeds(T.doc('planilhas/' + P('t1', 'ingles', 3)).get()));

console.log('— Fechamento de bimestre');
await t('admin fecha o 3º bimestre', assertSucceeds(A.doc('config/escola').set({ travas: { '3': true } }, { merge: true })));
await t('titular NÃO edita bimestre fechado', assertFails(T.doc('planilhas/' + P('t1', 'portugues', 3)).set({ turmaId: 't1', disc: 'portugues', bim: 3, alunos: { a1: { prova: 1 } } }, { merge: true })));
await t('titular ainda LÊ bimestre fechado', assertSucceeds(T.doc('planilhas/' + P('t1', 'portugues', 3)).get()));
await t('titular edita bimestre aberto (4º)', assertSucceeds(T.doc('planilhas/' + P('t1', 'portugues', 4)).set({ turmaId: 't1', disc: 'portugues', bim: 4, alunos: {} })));
await t('admin edita bimestre fechado', assertSucceeds(A.doc('planilhas/' + P('t1', 'portugues', 3)).set({ turmaId: 't1', disc: 'portugues', bim: 3, alunos: { a1: { prova: 7 } } }, { merge: true })));


console.log('— Planejamentos (privados entre professoras)');
await t('admin cria segunda titular', assertSucceeds(A.doc('users/T2').set({ nome: 'Tit2', role: 'titular', turmas: ['t2'], ativo: true })));
const T2 = db('T2');
const meta = (autor, extra = {}) => ({ autorUid: autor, autorNome: 'x', turmas: ['t2'], periodo: 'Quinzena 1', nomeArquivo: 'p.docx', tipo: 'x', tamanho: 10, partes: 1, status: 'enviado', comentario: '', ...extra });
await t('titular envia planejamento (doc + parte, em lote)', assertSucceeds((() => { const b = T2.batch();
  b.set(T2.doc('planejamentos/p1'), meta('T2')); b.set(T2.doc('planejamentos/p1/partes/0'), { d: 'QUJD' }); return b.commit(); })()));
await t('NÃO envia em nome de outra pessoa', assertFails(T2.doc('planejamentos/p2').set(meta('I'))));
await t('NÃO envia já aprovado', assertFails(T2.doc('planejamentos/p3').set(meta('T2', { status: 'aprovado' }))));
await t('autora lê o próprio', assertSucceeds(T2.doc('planejamentos/p1').get()));
await t('autora baixa o arquivo', assertSucceeds(T2.doc('planejamentos/p1/partes/0').get()));
await t('autora lista os próprios', assertSucceeds(T2.collection('planejamentos').where('autorUid', '==', 'T2').get()));
await t('autora NÃO lista todos', assertFails(T2.collection('planejamentos').get()));
await t('autora NÃO se autoaprova', assertFails(T2.doc('planejamentos/p1').update({ status: 'aprovado' })));
await t('colega NÃO lê o planejamento da outra', assertFails(I.doc('planejamentos/p1').get()));
await t('colega NÃO baixa o arquivo da outra', assertFails(I.doc('planejamentos/p1/partes/0').get()));
await t('colega NÃO lista os da outra', assertFails(I.collection('planejamentos').where('autorUid', '==', 'T2').get()));
await t('colega NÃO injeta parte no da outra', assertFails(I.doc('planejamentos/p1/partes/1').set({ d: 'x' })));
await t('coordenação lista todos', assertSucceeds(A.collection('planejamentos').get()));
await t('coordenação baixa o arquivo', assertSucceeds(A.doc('planejamentos/p1/partes/0').get()));
await t('coordenação pede ajuste com comentário', assertSucceeds(A.doc('planejamentos/p1').update({ status: 'ajustar', comentario: 'Faltou BNCC' })));
await t('coordenação NÃO troca a autora', assertFails(A.doc('planejamentos/p1').update({ autorUid: 'I' })));
await t('autora NÃO apaga depois de avaliado', assertFails(T2.doc('planejamentos/p1').delete()));
await t('coordenação apaga', assertSucceeds((() => { const b = A.batch(); b.delete(A.doc('planejamentos/p1/partes/0')); b.delete(A.doc('planejamentos/p1')); return b.commit(); })()));

console.log('— Conta desativada e conta sem perfil');
await t('admin desativa a titular', assertSucceeds(A.doc('users/T').update({ ativo: false })));
await t('titular desativada NÃO lê turmas', assertFails(T.collection('turmas').get()));
await t('titular desativada NÃO lança', assertFails(T.doc('planilhas/' + P('t1', 'portugues', 4)).set({ turmaId: 't1', disc: 'portugues', bim: 4, alunos: {} })));
await t('conta sem perfil NÃO lê turmas', assertFails(db('X').collection('turmas').get()));
await t('desativada NÃO envia planejamento', assertFails(T.doc('planejamentos/p9').set(meta('T'))));
await t('conta sem perfil NÃO lê alunos', assertFails(db('X').collection('alunos').where('turmaId', '==', 't1').get()));
await t('admin NÃO apaga a si mesmo', assertFails(A.doc('users/A').delete()));

console.log('— Gerar nova senha / excluir acesso');
await t('visitante lê o mapa de usuário (antes do login)', assertSucceeds(db(null).doc('logins/joao').get()));
await t('visitante NÃO lista os usuários', assertFails(db(null).collection('logins').get()));
await t('visitante NÃO grava o mapa', assertFails(db(null).doc('logins/joao').set({ email: 'x' })));
await t('professora NÃO grava o mapa', assertFails(I.doc('logins/joao').set({ email: 'x' })));
await t('admin cria planejamento antigo de I (via I)', assertSucceeds((() => { const b = I.batch();
  b.set(I.doc('planejamentos/q1'), meta('I')); b.set(I.doc('planejamentos/q1/partes/0'), { d: 'QQ' }); return b.commit(); })()));
await t('admin troca a conta de I por I2 (lote)', assertSucceeds((() => { const b = A.batch();
  b.set(A.doc('users/I2'), { nome: 'Ing', role: 'ingles', turmas: [], ativo: true, email: 'i+x', uidsAnteriores: ['I'] });
  b.delete(A.doc('users/I')); b.set(A.doc('logins/ing'), { email: 'i+x', uid: 'I2' }); return b.commit(); })()));
const I2 = db('I2');
await t('conta antiga NÃO lê mais nada', assertFails(I.doc('planejamentos/q1').get()));
await t('conta nova lê o planejamento antigo', assertSucceeds(I2.doc('planejamentos/q1').get()));
await t('conta nova lista os antigos', assertSucceeds(I2.collection('planejamentos').where('autorUid', '==', 'I').get()));
await t('conta nova baixa o arquivo antigo', assertSucceeds(I2.doc('planejamentos/q1/partes/0').get()));
await t('conta nova cancela o antigo ainda enviado', assertSucceeds((() => { const b = I2.batch();
  b.delete(I2.doc('planejamentos/q1/partes/0')); b.delete(I2.doc('planejamentos/q1')); return b.commit(); })()));
await t('professora NÃO apaga acesso de outra', assertFails(I2.doc('users/T2').delete()));
await t('admin exclui acesso + mapa', assertSucceeds((() => { const b = A.batch(); b.delete(A.doc('users/I2')); b.delete(A.doc('logins/ing')); return b.commit(); })()));

console.log(`\nRESULTADO: ${ok} passaram, ${falhas.length} falharam`);
if (falhas.length) console.log('FALHAS:', falhas);
await env.cleanup();
process.exit(falhas.length ? 1 : 0);
