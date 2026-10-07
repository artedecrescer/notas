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

console.log('— Conta desativada e conta sem perfil');
await t('admin desativa a titular', assertSucceeds(A.doc('users/T').update({ ativo: false })));
await t('titular desativada NÃO lê turmas', assertFails(T.collection('turmas').get()));
await t('titular desativada NÃO lança', assertFails(T.doc('planilhas/' + P('t1', 'portugues', 4)).set({ turmaId: 't1', disc: 'portugues', bim: 4, alunos: {} })));
await t('conta sem perfil NÃO lê turmas', assertFails(db('X').collection('turmas').get()));
await t('conta sem perfil NÃO lê alunos', assertFails(db('X').collection('alunos').where('turmaId', '==', 't1').get()));
await t('admin NÃO apaga a si mesmo', assertFails(A.doc('users/A').delete()));

console.log(`\nRESULTADO: ${ok} passaram, ${falhas.length} falharam`);
if (falhas.length) console.log('FALHAS:', falhas);
await env.cleanup();
process.exit(falhas.length ? 1 : 0);
