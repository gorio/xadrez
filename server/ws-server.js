const { randomUUID } = require('crypto');
const { Chess } = require('chess.js');
const { WebSocket, WebSocketServer } = require('ws');

const MAX_PLAYERS_PER_ROOM = 2;
const DEFAULT_RATING = 1000;
const MAX_RATING_DIFFERENCE = 300;
const ELO_K_FACTOR = 32;

// Estado em memoria para manter o exemplo simples.
// Em producao, use Redis/banco de dados, autentique usuarios, aplique rate limit,
// registre auditoria e persista partidas/rating de forma transacional.
const state = {
  waitingPlayers: [],
  playersBySocket: new Map(),
  rooms: new Map(),
};

function sendJson(socket, payload) {
  // Evita enviar mensagens para conexoes ja fechadas.
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function parseJson(rawMessage) {
  try {
    return JSON.parse(rawMessage.toString());
  } catch {
    return null;
  }
}

function normalizeRating(rating) {
  const parsedRating = Number(rating);

  // Todo jogador novo comeca em 1000 se o cliente nao informar rating valido.
  // Em producao, nunca confie no rating enviado pelo frontend; busque no banco.
  if (!Number.isFinite(parsedRating) || parsedRating <= 0) {
    return DEFAULT_RATING;
  }

  return Math.round(parsedRating);
}

function createPlayer(socket) {
  const player = {
    id: randomUUID(),
    socket,
    rating: DEFAULT_RATING,
    roomId: null,
    color: null,
  };

  state.playersBySocket.set(socket, player);
  return player;
}

function removeFromWaitingQueue(playerId) {
  state.waitingPlayers = state.waitingPlayers.filter((player) => player.id !== playerId);
}

function findBestOpponent(player) {
  let bestOpponent = null;
  let bestRatingDifference = Infinity;

  for (const waitingPlayer of state.waitingPlayers) {
    const ratingDifference = Math.abs(waitingPlayer.rating - player.rating);

    // Matchmaking simples: escolhe o adversario com rating mais proximo.
    if (ratingDifference <= MAX_RATING_DIFFERENCE && ratingDifference < bestRatingDifference) {
      bestOpponent = waitingPlayer;
      bestRatingDifference = ratingDifference;
    }
  }

  return bestOpponent;
}

function createRoom(playerOne, playerTwo) {
  const roomId = randomUUID();
  const room = {
    id: roomId,
    players: [playerOne, playerTwo],
    chess: new Chess(),
    status: 'playing',
    createdAt: new Date(),
  };

  playerOne.roomId = roomId;
  playerOne.color = 'white';
  playerTwo.roomId = roomId;
  playerTwo.color = 'black';

  state.rooms.set(roomId, room);
  return room;
}

function getRoomByPlayer(player) {
  if (!player.roomId) {
    return null;
  }

  return state.rooms.get(player.roomId) || null;
}

function getOpponent(player) {
  const room = getRoomByPlayer(player);

  if (!room) {
    return null;
  }

  return room.players.find((roomPlayer) => roomPlayer.id !== player.id) || null;
}

function getPlayerByColor(room, color) {
  return room.players.find((player) => player.color === color) || null;
}

function calculateExpectedScore(playerRating, opponentRating) {
  return 1 / (1 + 10 ** ((opponentRating - playerRating) / 400));
}

function calculateNewRating(playerRating, opponentRating, score) {
  const expectedScore = calculateExpectedScore(playerRating, opponentRating);
  return Math.round(playerRating + ELO_K_FACTOR * (score - expectedScore));
}

function updateEloRatings(room, winnerId) {
  const [playerOne, playerTwo] = room.players;
  const oldRatings = {
    [playerOne.id]: playerOne.rating,
    [playerTwo.id]: playerTwo.rating,
  };

  const playerOneScore = winnerId === null ? 0.5 : Number(winnerId === playerOne.id);
  const playerTwoScore = winnerId === null ? 0.5 : Number(winnerId === playerTwo.id);

  playerOne.rating = calculateNewRating(
    oldRatings[playerOne.id],
    oldRatings[playerTwo.id],
    playerOneScore,
  );
  playerTwo.rating = calculateNewRating(
    oldRatings[playerTwo.id],
    oldRatings[playerOne.id],
    playerTwoScore,
  );

  return {
    [playerOne.id]: {
      oldRating: oldRatings[playerOne.id],
      newRating: playerOne.rating,
      delta: playerOne.rating - oldRatings[playerOne.id],
    },
    [playerTwo.id]: {
      oldRating: oldRatings[playerTwo.id],
      newRating: playerTwo.rating,
      delta: playerTwo.rating - oldRatings[playerTwo.id],
    },
  };
}

function buildGameOverPayload(room, reason, winner, loser) {
  const ratingChanges = updateEloRatings(room, winner ? winner.id : null);
  const result = winner ? `${winner.color}_win` : 'draw';

  return {
    type: 'game_over',
    roomId: room.id,
    reason,
    result,
    winnerId: winner ? winner.id : null,
    loserId: loser ? loser.id : null,
    ratings: ratingChanges,
  };
}

function clearRoomPlayers(room) {
  room.players.forEach((player) => {
    player.roomId = null;
    player.color = null;
  });
}

function finishGame(room, reason, winner, loser) {
  if (!room || room.status === 'finished') {
    return;
  }

  room.status = 'finished';

  const payload = buildGameOverPayload(room, reason, winner, loser);

  // Envia o resultado para ambos quando possivel. Em abandono por desconexao,
  // o jogador desconectado provavelmente nao recebera, mas o rating em memoria e atualizado.
  room.players.forEach((player) => {
    sendJson(player.socket, payload);
  });

  clearRoomPlayers(room);
  state.rooms.delete(room.id);
}

function joinMatchmaking(player, rating) {
  if (player.roomId) {
    sendJson(player.socket, {
      type: 'error',
      message: 'Voce ja esta em uma partida.',
    });
    return;
  }

  player.rating = normalizeRating(rating || player.rating);

  // Evita que a mesma conexao entre varias vezes na fila.
  removeFromWaitingQueue(player.id);

  const opponent = findBestOpponent(player);

  if (!opponent) {
    state.waitingPlayers.push(player);
    sendJson(player.socket, {
      type: 'waiting_for_match',
      playerId: player.id,
      rating: player.rating,
      maxRatingDifference: MAX_RATING_DIFFERENCE,
    });
    return;
  }

  removeFromWaitingQueue(opponent.id);
  const room = createRoom(opponent, player);

  room.players.forEach((roomPlayer) => {
    const currentOpponent = getOpponent(roomPlayer);

    sendJson(roomPlayer.socket, {
      type: 'match_found',
      roomId: room.id,
      playerId: roomPlayer.id,
      color: roomPlayer.color,
      playersConnected: room.players.length,
      roomFull: room.players.length === MAX_PLAYERS_PER_ROOM,
      initialFen: room.chess.fen(),
      opponent: {
        id: currentOpponent.id,
        rating: currentOpponent.rating,
      },
    });
  });
}

function finishGameIfNeeded(room) {
  if (room.chess.isCheckmate()) {
    // Apos o movimento, chess.turn() indica a cor que nao tem lance legal.
    const loserColor = room.chess.turn() === 'w' ? 'white' : 'black';
    const loser = getPlayerByColor(room, loserColor);
    const winner = getOpponent(loser);
    finishGame(room, 'checkmate', winner, loser);
    return true;
  }

  if (room.chess.isDraw()) {
    finishGame(room, 'draw', null, null);
    return true;
  }

  return false;
}

function handleMoveMessage(player, message) {
  // Exemplo esperado:
  // { "type": "move", "from": "e2", "to": "e4" }
  const room = getRoomByPlayer(player);

  if (!room) {
    sendJson(player.socket, {
      type: 'error',
      message: 'Voce ainda nao esta em uma sala.',
    });
    return;
  }

  if (!message.from || !message.to) {
    sendJson(player.socket, {
      type: 'error',
      message: 'Movimento invalido. Informe "from" e "to".',
    });
    return;
  }

  const expectedColor = room.chess.turn() === 'w' ? 'white' : 'black';

  if (player.color !== expectedColor) {
    sendJson(player.socket, {
      type: 'error',
      message: 'Nao e seu turno.',
    });
    return;
  }

  let move;

  try {
    // chess.js valida turno, origem, destino, captura, roque, promocao e legalidade.
    move = room.chess.move({
      from: message.from,
      to: message.to,
      promotion: message.promotion || 'q',
    });
  } catch {
    move = null;
  }

  if (!move) {
    sendJson(player.socket, {
      type: 'error',
      message: 'Movimento ilegal.',
    });
    return;
  }

  const movePayload = {
    type: 'move',
    roomId: room.id,
    from: move.from,
    to: move.to,
    san: move.san,
    fen: room.chess.fen(),
    by: player.id,
  };

  // Envia o movimento validado para os dois jogadores para manter os clientes sincronizados.
  room.players.forEach((roomPlayer) => {
    sendJson(roomPlayer.socket, movePayload);
  });

  finishGameIfNeeded(room);
}

function handleResignMessage(player) {
  const room = getRoomByPlayer(player);

  if (!room) {
    sendJson(player.socket, {
      type: 'error',
      message: 'Voce nao esta em uma partida para desistir.',
    });
    return;
  }

  const winner = getOpponent(player);
  finishGame(room, 'resignation', winner, player);
}

function cleanupPlayer(socket) {
  const player = state.playersBySocket.get(socket);

  if (!player) {
    return;
  }

  removeFromWaitingQueue(player.id);

  const room = getRoomByPlayer(player);

  if (room) {
    const winner = getOpponent(player);
    finishGame(room, 'disconnect', winner, player);
  }

  state.playersBySocket.delete(socket);
}

function handleMessage(socket, rawMessage) {
  const player = state.playersBySocket.get(socket);
  const message = parseJson(rawMessage);

  if (!player) {
    return;
  }

  if (!message) {
    sendJson(socket, {
      type: 'error',
      message: 'Mensagem invalida. Envie JSON.',
    });
    return;
  }

  switch (message.type) {
    case 'join_matchmaking':
      joinMatchmaking(player, message.rating);
      break;

    case 'move':
      handleMoveMessage(player, message);
      break;

    case 'resign':
      // Evento chamado pelo botao "desistir" no frontend.
      handleResignMessage(player);
      break;

    default:
      sendJson(socket, {
        type: 'error',
        message: `Tipo de mensagem nao suportado: ${message.type}`,
      });
  }
}

function createChessWebSocketServer(port) {
  const wss = new WebSocketServer({ port });

  wss.on('connection', (socket) => {
    // O jogador e criado ao conectar; o emparelhamento ocorre via join_matchmaking.
    const player = createPlayer(socket);

    sendJson(socket, {
      type: 'connected',
      playerId: player.id,
      rating: player.rating,
      message: 'Conectado. Envie join_matchmaking com seu rating para buscar partida.',
    });

    socket.on('message', (rawMessage) => {
      handleMessage(socket, rawMessage);
    });

    socket.on('close', () => {
      cleanupPlayer(socket);
    });

    socket.on('error', (error) => {
      console.error('Erro na conexao WebSocket:', error.message);
      cleanupPlayer(socket);
    });
  });

  console.log(`Servidor WebSocket de xadrez escutando na porta ${port}`);
  return wss;
}

module.exports = {
  createChessWebSocketServer,
};
