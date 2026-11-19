# 🧽 Velho da Limpeza — Pixel Purge

Arcade cooperativo em pixel-art sobre Seu Osvaldo, um faxineiro veterano que enfrenta uma infestação de sujeira viva. O objetivo é limpar a arena, trabalhar em equipe e bater o recorde de pontos.

## Recursos

- **PC e mobile:** layout responsivo, renderização Canvas pixelada, joystick virtual e botão de limpeza no celular.
- **Controles de PC:** WASD ou setas para mover, mouse para mirar, clique ou Espaço para usar a ferramenta, teclas 1–4 ou Q/E para trocar.
- **Quatro ferramentas:** canhão de espuma, jato de sabão com respingo, aspirador turbo e esfregão de alcance curto.
- **Multiplayer online real:** servidor Node.js autoritativo e WebSocket implementado no próprio projeto, salas públicas com matchmaking simples e salas privadas com código.
- **Cooperação:** até 4 jogadores na mesma arena, com pontuação individual e total da equipe.
- **Efeitos e áudio:** partículas de limpeza, animações em pixel-art e sons sintetizados no navegador (podem ser desligados).
- **Sem banco obrigatório:** a partida é mantida em memória no servidor. Ao reiniciar o servidor, as salas e pontuações temporárias são reiniciadas.

## Requisitos

- Node.js 20 ou superior (sem dependências de runtime externas).
- npm apenas para executar os scripts `start` e `test`.
- Porta TCP 3000 liberada no computador/servidor.

## Instalação no Windows PowerShell 5.1

> Se o PowerShell bloquear `npm.ps1`, use `npm.cmd` nos comandos abaixo. Isso não exige alterar a política de execução do Windows.

1. Extraia a pasta `velho-da-limpeza`.
2. Abra o PowerShell na pasta que contém `package.json`.
3. Crie seu arquivo de ambiente (opcional, o jogo também usa os padrões):

```powershell
Copy-Item .env.example .env
```

4. Instale/prepare o projeto (não há pacotes externos para baixar):

```powershell
npm.cmd install
```

5. Inicie o servidor de jogo e o site:

```powershell
npm.cmd start
```

6. Abra no navegador:

```text
http://localhost:3000
```

O servidor serve a página e o endpoint WebSocket `/ws` na mesma porta.

## Jogar pelo celular na mesma rede Wi-Fi

1. Deixe o computador e o celular conectados à mesma rede Wi-Fi.
2. Descubra o IPv4 do computador com:

```powershell
ipconfig
```

3. Procure o endereço IPv4 do adaptador Wi-Fi (por exemplo, `192.168.1.25`).
4. No celular, acesse `http://IP-DO-PC:3000`.
5. Se o Firewall do Windows perguntar, permita conexões privadas para Node.js. Se não perguntar, crie uma regra de entrada TCP para a porta 3000 apenas em redes privadas.

Para convidar outra pessoa pela internet, o servidor precisa estar publicado em um host acessível externamente. Compartilhar `localhost` não conecta dispositivos remotos.

## Salas

- **Jogar solo:** cria uma sala isolada para um jogador.
- **Partida pública:** entra em uma sala pública disponível ou cria uma nova.
- **Criar sala privada:** cria uma sala e mostra um código de 5 caracteres no HUD.
- **Entrar:** digite o código de uma sala privada criada no mesmo servidor.

Salas e partidas ficam na memória do servidor, e salas vazias são removidas após 60 segundos. Esta versão não possui contas, chat, ranking persistente ou sistema de punição/moderação.

## Controles

| Ação | PC | Mobile |
|---|---|---|
| Mover | WASD / setas | Joystick esquerdo |
| Mirar | Mouse | Mira automática no alvo mais próximo |
| Limpar | Clique / Espaço | Botão LIMPAR |
| Trocar ferramenta | 1–4 / Q e E | Botão TROCAR FERRAMENTA |
| Sair da sala | Esc / botão SAIR | Botão SAIR |

## Configuração

Copie `.env.example` para `.env` e ajuste:

- `PORT`: porta HTTP e WebSocket (padrão `3000`).
- `ROOM_CAPACITY`: limite de jogadores por sala (entre 2 e 4, padrão `4`).
- `ALLOWED_ORIGIN`: opcional, restrinja uma origem específica quando frontend e backend forem separados. Deixe vazio para o deploy servido pelo mesmo domínio.

## Testes

```powershell
npm.cmd test
```

Valida sanitização do nickname, snapshots públicos, movimentação no servidor e criação de projétil no backend.

## Publicar na internet

Hospede a pasta inteira em um serviço que execute Node.js e aceite conexões WebSocket persistentes. Configure o comando de inicialização como `npm start` e a variável `PORT` conforme o provedor. O host deve encaminhar tráfego HTTP e WebSocket para a mesma aplicação.

Para um servidor público:

- Use HTTPS (o navegador passará a usar WSS automaticamente).
- Configure domínio e firewall do provedor.
- Configure `ROOM_CAPACITY` conforme a memória/capacidade do host.
- Mantenha dependências atualizadas e monitore o uso de CPU/memória.
- Para múltiplas instâncias, será necessário um serviço compartilhado para estado das salas (por exemplo Redis) e um adaptador de broadcast; esta versão é de instância única.

## GitHub

Crie um repositório vazio no GitHub e, dentro desta pasta, execute:

```powershell
git init
git add .
git commit -m "feat: first version of Velho da Limpeza"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/velho-da-limpeza.git
git push -u origin main
```

Substitua `SEU-USUARIO` pelo seu usuário do GitHub.

## Estrutura

```text
velho-da-limpeza/
├── public/
│   ├── client.js      # renderização Canvas, controles e WebSocket client
│   ├── index.html     # menu e HUD responsivos
│   └── style.css      # tema pixel arcade e mobile
├── server/
│   ├── game.js        # simulação autoritativa das partidas
│   ├── index.js       # servidor HTTP e gerenciamento de salas
│   └── websocket.js   # WebSocket próprio, sem dependência externa
├── tests/
│   └── game.test.js   # testes do motor de jogo
├── .env.example
├── package.json
└── README.md
```

## Nota de segurança e escopo

A temática usa equipamentos fictícios de limpeza e criaturas de sujeira cartunescas. Não há instruções ou representação de armas reais. O servidor valida movimentação, troca de ferramenta, cadência de uso e pontuação; o navegador só envia entradas, não decide acertos nem pontuação. O servidor não tem autenticação ou banco de dados nesta primeira versão e deve ser operado por um host confiável.
