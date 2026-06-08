# Xadrez Online Multiplayer

Servidor WebSocket puro em Node.js para partidas online de xadrez com:

- matchmaking automatico por rating
- multiplas salas de jogo
- validacao de movimentos no servidor com `chess.js`
- encerramento por xeque-mate, empate, desistancia e desconexao
- calculo simples de rating Elo iniciando em 1000

## Como executar

```bash
cd server
npm install
npm start
```

Por padrao, o servidor escuta na porta `3000`. Para alterar:

```bash
PORT=8080 npm start
```

## Eventos principais

Entrar no matchmaking:

```json
{ "type": "join_matchmaking", "rating": 1000 }
```

Enviar movimento:

```json
{ "type": "move", "from": "e2", "to": "e4" }
```

Desistir da partida:

```json
{ "type": "resign" }
```

O servidor envia `game_over` com o resultado e a variacao de rating quando a partida termina.

## Observacoes de seguranca

Este projeto e uma base inicial. Para producao, adicione autenticacao, persistencia de usuarios/rating, rate limiting, logs de auditoria e validacao de permissao por usuario.
