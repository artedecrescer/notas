# Notas e Planejamentos — Colégio Arte de Crescer

Sistema web para lançamento de notas e faltas, emissão de boletins e envio privado de planejamentos à coordenação, com login individual para cada professor.

- **Site:** GitHub Pages (gratuito).
- **Logins e banco de dados:** Firebase, do Google, no plano gratuito *Spark* (sem cartão de crédito).
- **Dados dos alunos:** ficam **somente no Firebase**, protegidos por login. O GitHub guarda apenas o código.

## Perfis de acesso

| Perfil | O que pode fazer |
|---|---|
| **Coordenação / Direção** | Tudo: todas as turmas e disciplinas, cadastros, fechamento de bimestre, boletins, backup. Pode haver mais de uma conta assim. |
| **Professora titular** | Lança notas e faltas de **todas as disciplinas menos Inglês**, só nas turmas dela. Gera os boletins das turmas dela. |
| **Professor(a) de Inglês** | Lança notas e faltas de **Inglês em todas as turmas**. |

Nota de cada bimestre = **prova (0 a 7) + atividades (0 a 3)**. O boletim sai no modelo da escola, com notas e faltas do 1º ao 4º bimestre, dois por folha e sem fundo colorido.

---

## Implantação (uma vez só, cerca de 30 minutos)

> Dica: use a **conta Google da escola**, se houver. Assim o sistema pertence à escola e não depende de uma pessoa só.

### 1. Criar o projeto no Firebase
1. Acesse **console.firebase.google.com** e entre com a conta Google.
2. Clique em **Criar um projeto** e dê o nome `notas-arte-de-crescer`.
3. O Google Analytics não é necessário: desative e clique em **Criar projeto**.

### 2. Ativar o login por e-mail e senha
1. No menu da esquerda: **Criação → Authentication → Vamos começar**.
2. Em **Provedores de login**, escolha **E-mail/senha**, ative a primeira chave e clique em **Salvar**.

### 3. Criar o banco de dados
1. Vá em **Criação → Firestore Database → Criar banco de dados**.
2. Em **Local**, escolha **`southamerica-east1 (São Paulo)`**.
3. Escolha **Iniciar no modo de produção** e clique em **Criar**.

### 4. Colar as regras de segurança
1. No Firestore, abra a aba **Regras**.
2. Apague tudo o que estiver lá, cole o conteúdo do arquivo **`firestore.rules`** e clique em **Publicar**.

### 5. Registrar o site e copiar a configuração
1. Clique na engrenagem e depois em **Configurações do projeto**.
2. Em **Seus apps**, clique no ícone **`</>`** (Web). Dê o apelido `site` e **não** marque o Firebase Hosting. Clique em **Registrar app**.
3. Vão aparecer quatro valores: `apiKey`, `authDomain`, `projectId` e `appId`. Cole cada um no arquivo **`js/firebase-config.js`**, no lugar de `COLE_AQUI`.
   *Esses valores não são senha e podem ficar públicos. Quem protege os dados são as regras do passo 4.*

### 6. Publicar no GitHub Pages
1. Crie no GitHub um repositório **público** chamado `sistema-notas` e envie todos os arquivos desta pasta. Se o repositório estiver conectado ao Claude, ele faz o envio por você.
2. No repositório, abra **Settings → Pages**. Em *Source*, escolha **Deploy from a branch**, depois **main** e **/ (root)**, e clique em **Save**.
3. Em cerca de 1 minuto o site fica no ar em `https://SEU-USUARIO.github.io/sistema-notas/`.

### 7. Autorizar o endereço do site no Firebase
No Firebase, vá em **Authentication → Configurações → Domínios autorizados → Adicionar domínio** e informe `SEU-USUARIO.github.io`.

### 8. Primeiro acesso: criar a conta da coordenação
Abra o endereço do site. Vai aparecer a tela **Configuração inicial**: preencha e clique em criar.
> ⚠️ Faça isso **logo depois de publicar**. A primeira pessoa que concluir essa etapa vira administradora.

### 9. Carregar os dados iniciais
Na aba **Escola**, clique em **Importar dados (.json)** e escolha o arquivo `dados_iniciais_3bim_2026_PRIVADO.json`. Ele traz as 5 turmas, os 38 alunos e as notas e faltas do 1º ao 3º bimestre.
> ⚠️ Esse arquivo contém dados de alunos: **nunca** envie para o GitHub. O `.gitignore` já bloqueia esse nome.

### 10. Criar os acessos
Abra **Cadastros → Professores e acessos** e crie um acesso para cada pessoa:
- Coordenação e direção: perfil **Coordenação / Direção**.
- Cada titular: perfil **Professora titular**, marcando a turma dela.
- Inglês: perfil **Professor(a) de Inglês**.

O sistema gera uma mensagem pronta, com endereço, e-mail e senha provisória, para você copiar e enviar. Cada pessoa pode criar a própria senha pelo botão **Esqueci minha senha**.

---

## Uso no dia a dia

- **Início:** cada pessoa vê o que falta lançar no bimestre e a situação dos seus planejamentos. Clicar num quadradinho abre direto a turma e a disciplina.
- **Planejamentos:** a professora envia o arquivo (Word ou PDF, até 6 MB); só ela e a coordenação veem. A coordenação baixa (o envio vira *Visto*), aprova ou pede ajuste com comentário. O arquivo fica guardado em partes no próprio banco de dados, porque o armazenamento de arquivos do Firebase exige plano pago.
- **Login por usuário:** quem não tem e-mail pode entrar só com um nome de usuário (ex.: `laiza`). Nesse caso, se esquecer a senha, a coordenação desativa o acesso e cria outro.
- **Minha senha** e **Ajuda** ficam no alto da tela.

- **Lançar notas:** escolha a turma, a disciplina e o bimestre. Tudo é **salvo automaticamente**, e a tecla Enter desce para o próximo aluno.
- **Pendências** (coordenação): um quadro de turmas por disciplinas mostra o que já foi lançado em cada bimestre.
- **Fechar bimestre** (aba Escola): depois de fechado, os professores só conseguem consultar. A coordenação continua podendo corrigir.
- **Boletins:** escolha a turma e gere o PDF de todos os alunos ou de um só.
- **Backup:** ao fim de cada bimestre, use **Escola → Backup completo (.json)** e guarde o arquivo no Google Drive.
- **Demonstração:** acrescente `?demo` ao final do endereço para abrir o sistema com dados fictícios, útil para apresentar ou treinar.

## Atualizações

- Para atualizar o sistema, basta trocar os arquivos no GitHub, e o site se atualiza sozinho em cerca de 1 minuto. **As notas não são afetadas**, porque ficam no Firebase.
- Se o arquivo `firestore.rules` mudar, cole a versão nova no Firebase (passo 4) e clique em **Publicar**.
- A aba **Actions** do GitHub roda automaticamente os testes das regras de segurança sempre que elas mudam.

## Segurança e LGPD

- Só quem tem acesso ativo, criado pela coordenação, lê ou grava dados. Cada perfil enxerga apenas o que lhe cabe, e essa trava fica no servidor, não só na tela.
- Os dados ficam no servidor do Google em São Paulo.
- Para remover alguém, use **Desativar**: a pessoa perde o acesso na hora.
- Recomenda-se adicionar a coordenação como proprietária do projeto Firebase, em **Configurações do projeto → Usuários e permissões**.

## Limites do plano gratuito

São 1 GB de banco de dados, 50 mil leituras e 20 mil gravações por dia. O uso de uma escola deste porte fica muito abaixo disso.

## Limitações conhecidas

- O e-mail de um professor não pode ser trocado. Nesse caso, crie um acesso novo e desative o antigo.
- Para apagar uma conta de login de vez, é preciso usar o console do Firebase (Authentication). Desativar no sistema já bloqueia todo o acesso.
- Os campos "5º conceito" e "Resultado final" saem em branco no boletim.

## Arquivos

| Arquivo | Para quê |
|---|---|
| `index.html` | Página do sistema |
| `js/app.js` | Telas e funcionamento |
| `js/dados-firebase.js` | Conexão com o Firebase |
| `js/dados-demo.js` | Modo demonstração (dados fictícios) |
| `js/boletim.js` | Geração do boletim em PDF |
| `js/comum.js` | Disciplinas, perfis e regras de permissão |
| `js/firebase-config.js` | **Configuração do seu projeto** (passo 5) |
| `firestore.rules` | **Regras de segurança** (passo 4) |
| `tests/` e `.github/` | Testes automáticos das regras |
| `vendor/` | Bibliotecas (Firebase, PDF, Excel) |
