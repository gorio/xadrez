/* ===================================================
   CONFIGURAÇÃO DO FIREBASE
   Substitua pelos dados do seu projeto Firebase!
   =================================================== */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCa0WmUo1PIrlaYW6Ei8ZZK3XLZ4i0gIfo",
  authDomain: "golf-oscar-romeo.firebaseapp.com",
  projectId: "golf-oscar-romeo",
  storageBucket: "golf-oscar-romeo.firebasestorage.app",
  messagingSenderId: "71631208569",
  appId: "1:71631208569:web:e7a1cc7ad20903ce5ad4a8",
  measurementId: "G-9TKPXNPL54"
};
/* ===================================================
   SÍMBOLOS DAS PEÇAS
   =================================================== */
const SYMBOLS = {
  wK: '♔', wQ: '♕', wR: '♖', wB: '♗', wN: '♘', wP: '♙',
  bK: '♚', bQ: '♛', bR: '♜', bB: '♝', bN: '♞', bP: '♟'
};

/* ===================================================
   ESTADO GLOBAL
   =================================================== */
let db, roomRef, gameRef;
let engine = new ChessEngine();
let myColor = null;
let myId = null;
let roomCode = null;
let selectedSq = null;
let legalMovesCache = [];
let pendingPromotion = null;
let gameActive = false;

/* ===================================================
   INICIALIZAÇÃO
   =================================================== */
window.addEventListener('DOMContentLoaded', () => {
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.database();
  } catch (e) {
    alert('Erro ao conectar ao Firebase. Verifique a configuração em js/app.js');
    return;
  }

  myId = Math.random().toString(36).slice(2, 10);

  // Botões do lobby
  document.getElementById('btn-create').addEventListener('click', createGame);
  document.getElementById('btn-join').addEventListener('click', joinGame);
  document.getElementById('input-room').addEventListener('keydown', e => {
    if (e.key === 'Enter') joinGame();
  });

  // Sala de espera
  document.getElementById('btn-copy').addEventListener('click', copyRoomCode);
  document.getElementById('btn-cancel').addEventListener('click', cancelGame);

  // Jogo
  document.getElementById('btn-resign').addEventListener('click', resign);
  document.getElementById('btn-new-game').addEventListener('click', () => showScreen('lobby'));

  // Game over modal
  document.getElementById('btn-gameover-new').addEventListener('click', () => {
    hideModal('modal-gameover');
    showScreen('lobby');
  });
  document.getElementById('btn-gameover-lobby').addEventListener('click', () => {
    hideModal('modal-gameover');
    showScreen('lobby');
  });
});

/* ===================================================
   TELAS
   =================================================== */
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`screen-${name}`).classList.add('active');
}

function showModal(id) {
  document.getElementById(id).classList.remove('hidden');
}

function hideModal(id) {
  document.getElementById(id).classList.add('hidden');
}

/* ===================================================
   CRIAR PARTIDA
   =================================================== */
async function createGame() {
  const btn = document.getElementById('btn-create');
  btn.disabled = true;
  btn.textContent = 'Criando...';

  try {
    roomCode = generateRoomCode();
    myColor = 'w';
    engine.reset();

    roomRef = db.ref(`rooms/${roomCode}`);

    await roomRef.set({
      white: myId,
      black: null,
      state: engine.serialize(),
      createdAt: Date.now(),
      status: 'waiting'
    });

    // Remove sala após 10 min se ninguém entrar
    setTimeout(() => {
      roomRef.once('value', snap => {
        if (snap.val()?.status === 'waiting') {
          roomRef.remove();
          showScreen('lobby');
        }
      });
    }, 600000);

    document.getElementById('display-room-code').textContent = roomCode;
    showScreen('waiting');

    // Aguarda oponente
    roomRef.on('value', snap => {
      const data = snap.val();
      if (!data) return;
      if (data.black && data.status === 'playing') {
        roomRef.off();
        startGame();
      }
    });

  } catch (e) {
    showLobbyError('Erro ao criar sala: ' + e.message);
    btn.disabled = false;
    btn.textContent = 'Criar Partida';
  }
}

/* ===================================================
   ENTRAR NA PARTIDA
   =================================================== */
async function joinGame() {
  const input = document.getElementById('input-room');
  const code = input.value.trim().toUpperCase();
  clearLobbyError();

  if (code.length !== 6) {
    showLobbyError('Código deve ter 6 caracteres.');
    return;
  }

  const btn = document.getElementById('btn-join');
  btn.disabled = true;
  btn.textContent = 'Entrando...';

  try {
    roomRef = db.ref(`rooms/${code}`);
    const snap = await roomRef.once('value');
    const data = snap.val();

    if (!data) {
      showLobbyError('Sala não encontrada.');
      btn.disabled = false; btn.textContent = 'Entrar';
      return;
    }
    if (data.black) {
      showLobbyError('Sala já está cheia.');
      btn.disabled = false; btn.textContent = 'Entrar';
      return;
    }
    if (data.status === 'finished') {
      showLobbyError('Esta partida já terminou.');
      btn.disabled = false; btn.textContent = 'Entrar';
      return;
    }

    roomCode = code;
    myColor = 'b';
    engine.deserialize(data.state);

    await roomRef.update({ black: myId, status: 'playing' });

    startGame();

  } catch (e) {
    showLobbyError('Erro ao entrar na sala: ' + e.message);
    btn.disabled = false; btn.textContent = 'Entrar';
  }
}

/* ===================================================
   INICIAR JOGO
   =================================================== */
function startGame() {
  gameActive = true;
  selectedSq = null;
  legalMovesCache = [];

  // Player labels
  if (myColor === 'w') {
    document.getElementById('avatar-bottom').textContent = '♙';
    document.getElementById('avatar-top').textContent = '♟';
    document.getElementById('label-bottom').textContent = 'Você (Brancas)';
    document.getElementById('label-top').textContent = 'Oponente (Pretas)';
  } else {
    document.getElementById('avatar-bottom').textContent = '♟';
    document.getElementById('avatar-top').textContent = '♙';
    document.getElementById('label-bottom').textContent = 'Você (Pretas)';
    document.getElementById('label-top').textContent = 'Oponente (Brancas)';
  }

  buildBoard();
  renderGame();
  showScreen('game');
  document.getElementById('btn-resign').classList.remove('hidden');
  document.getElementById('btn-new-game').classList.add('hidden');

  // Escuta mudanças no Firebase
  gameRef = roomRef.child('state');
  roomRef.on('value', snap => {
    const data = snap.val();
    if (!data) return;

    // Oponente saiu / resignou
    if (data.status === 'resigned' && data.winner !== myColor) {
      engine.deserialize(data.state);
      renderGame();
      showGameOver('Vitória!', 'O oponente resignou a partida.');
      gameActive = false;
      return;
    }

    if (data.status === 'abandoned') {
      showGameOver('Vitória!', 'O oponente abandonou a partida.');
      gameActive = false;
      return;
    }

    // Atualiza estado se for turno do oponente
    if (data.state && data.state.turn === myColor) {
      engine.deserialize(data.state);
      renderGame();

      if (engine.status === 'checkmate') {
        showGameOver('Xeque-mate!', 'Você perdeu. Melhor sorte na próxima!');
        gameActive = false;
      } else if (engine.status === 'stalemate') {
        showGameOver('Afogamento!', 'Empate por afogamento.');
        gameActive = false;
      }
    }
  });
}

/* ===================================================
   CONSTRUIR TABULEIRO HTML
   =================================================== */
function buildBoard() {
  const board = document.getElementById('chessboard');
  board.innerHTML = '';

  // Coordenadas
  const files = myColor === 'w'
    ? ['a','b','c','d','e','f','g','h']
    : ['h','g','f','e','d','c','b','a'];
  const ranks = myColor === 'w'
    ? ['8','7','6','5','4','3','2','1']
    : ['1','2','3','4','5','6','7','8'];

  // File coords (top e bottom)
  ['coords-file-top','coords-file-bottom'].forEach(id => {
    const el = document.getElementById(id);
    el.innerHTML = '';
    files.forEach(f => {
      const span = document.createElement('span');
      span.className = 'coord-label';
      span.style.width = `calc(min(56vw, 480px) / 8)`;
      span.textContent = f;
      el.appendChild(span);
    });
  });

  // Rank coords
  ['coords-rank-left','coords-rank-right'].forEach(id => {
    const el = document.getElementById(id);
    el.innerHTML = '';
    ranks.forEach(r => {
      const span = document.createElement('span');
      span.className = 'coord-label';
      span.style.height = `calc(min(56vw, 480px) / 8)`;
      span.textContent = r;
      el.appendChild(span);
    });
  });

  // Casas
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const sq = document.createElement('div');
      sq.className = 'square';
      sq.dataset.row = row;
      sq.dataset.col = col;
      sq.addEventListener('click', onSquareClick);
      board.appendChild(sq);
    }
  }
}

/* ===================================================
   RENDERIZAR POSIÇÃO
   =================================================== */
function renderGame() {
  const squares = document.querySelectorAll('.square');

  squares.forEach(sq => {
    const row = parseInt(sq.dataset.row);
    const col = parseInt(sq.dataset.col);

    // Mapeia visual → lógico
    const [lr, lc] = viewToLogic(row, col);

    // Cor da casa
    const isLight = (row + col) % 2 === 0;
    sq.className = 'square ' + (isLight ? 'light' : 'dark');
    sq.innerHTML = '';

    // Último movimento
    if (engine.lastMove) {
      const [fr, fc] = logicToView(...engine.lastMove.from);
      const [tr, tc] = logicToView(...engine.lastMove.to);
      if ((row === fr && col === fc) || (row === tr && col === tc)) {
        sq.classList.add('last-move');
      }
    }

    // Peça
    const piece = engine.piece(lr, lc);
    if (piece) {
      const span = document.createElement('span');
      span.className = 'piece';
      span.textContent = SYMBOLS[piece.color + piece.type] || '?';
      sq.appendChild(span);

      // Rei em xeque
      if (piece.type === 'K' && piece.color === engine.turn && engine.status === 'check') {
        sq.classList.add('in-check');
      }
    }
  });

  // Casa selecionada e dicas de movimento
  if (selectedSq !== null) {
    const [sr, sc] = selectedSq;
    const [vr, vc] = logicToView(sr, sc);
    const selEl = document.querySelector(`[data-row="${vr}"][data-col="${vc}"]`);
    if (selEl) selEl.classList.add('selected');

    legalMovesCache.forEach(m => {
      const [mr, mc] = logicToView(m.to[0], m.to[1]);
      const el = document.querySelector(`[data-row="${mr}"][data-col="${mc}"]`);
      if (el) {
        const hasPiece = engine.piece(m.to[0], m.to[1]) || m.enPassant;
        el.classList.add(hasPiece ? 'capture-hint' : 'move-hint');
      }
    });
  }

  updateStatus();
  updateMoveHistory();
  updateCaptured();
  updateTurnIndicator();
}

/* ===================================================
   CLIQUE NA CASA
   =================================================== */
function onSquareClick(e) {
  const sq = e.currentTarget;
  const row = parseInt(sq.dataset.row);
  const col = parseInt(sq.dataset.col);
  const [lr, lc] = viewToLogic(row, col);

  if (!gameActive || engine.turn !== myColor) return;
  if (['checkmate','stalemate'].includes(engine.status)) return;

  const piece = engine.piece(lr, lc);

  // Se já tem selecionado: tenta mover
  if (selectedSq !== null) {
    const [sr, sc] = selectedSq;
    const move = legalMovesCache.find(m => m.to[0] === lr && m.to[1] === lc);

    if (move) {
      // Promoção?
      if (engine.board[sr][sc]?.type === 'P' && (lr === 0 || lr === 7)) {
        pendingPromotion = { from: [sr, sc], to: [lr, lc] };
        showPromotion();
        return;
      }
      executeMove([sr, sc], [lr, lc]);
      return;
    }

    // Clicou em outra peça própria
    if (piece && piece.color === myColor) {
      selectedSq = [lr, lc];
      legalMovesCache = engine.legalMoves(lr, lc);
      renderGame();
      return;
    }

    // Deseleciona
    selectedSq = null;
    legalMovesCache = [];
    renderGame();
    return;
  }

  // Seleciona peça
  if (piece && piece.color === myColor) {
    selectedSq = [lr, lc];
    legalMovesCache = engine.legalMoves(lr, lc);
    renderGame();
  }
}

/* ===================================================
   EXECUTA MOVIMENTO
   =================================================== */
async function executeMove(from, to, promoteTo = 'Q') {
  const ok = engine.makeMove(from, to, promoteTo);
  if (!ok) return;

  selectedSq = null;
  legalMovesCache = [];
  renderGame();

  // Envia ao Firebase
  try {
    await roomRef.update({ state: engine.serialize() });
  } catch (e) {
    console.error('Erro ao salvar movimento:', e);
  }

  // Verifica fim de jogo
  if (engine.status === 'checkmate') {
    await roomRef.update({ status: 'finished', winner: myColor });
    showGameOver('Xeque-mate!', 'Você venceu! Parabéns!');
    gameActive = false;
  } else if (engine.status === 'stalemate') {
    await roomRef.update({ status: 'finished', winner: null });
    showGameOver('Afogamento!', 'Empate por afogamento.');
    gameActive = false;
  }
}

/* ===================================================
   PROMOÇÃO DE PEÃO
   =================================================== */
function showPromotion() {
  const choices = document.getElementById('promotion-choices');
  choices.innerHTML = '';
  const pieces = ['Q','R','B','N'];
  const labels = { Q: 'Rainha', R: 'Torre', B: 'Bispo', N: 'Cavalo' };

  pieces.forEach(type => {
    const btn = document.createElement('button');
    btn.className = 'promotion-choice';
    btn.title = labels[type];
    btn.textContent = SYMBOLS[myColor + type];
    btn.addEventListener('click', () => {
      hideModal('modal-promotion');
      const { from, to } = pendingPromotion;
      pendingPromotion = null;
      selectedSq = null;
      legalMovesCache = [];
      executeMove(from, to, type);
    });
    choices.appendChild(btn);
  });

  showModal('modal-promotion');
}

/* ===================================================
   STATUS BAR
   =================================================== */
function updateStatus() {
  const bar = document.getElementById('status-bar');
  bar.className = 'status-bar';

  if (!gameActive) return;

  const msgs = {
    playing: engine.turn === myColor ? 'Sua vez' : 'Vez do oponente',
    check: engine.turn === myColor ? '⚠ Xeque! Sua vez' : 'Oponente está em xeque',
    checkmate: '♟ Xeque-mate!',
    stalemate: '🤝 Afogamento!'
  };

  bar.textContent = msgs[engine.status] || '';

  if (engine.status === 'check' && engine.turn === myColor) bar.classList.add('check');
  if (engine.status === 'playing' && engine.turn === myColor) bar.classList.add('your-turn');
}

/* ===================================================
   HISTÓRICO DE MOVIMENTOS
   =================================================== */
function updateMoveHistory() {
  const box = document.getElementById('move-history');
  box.innerHTML = '';

  const moves = engine.history;
  for (let i = 0; i < moves.length; i += 2) {
    const row = document.createElement('div');
    row.className = 'move-row';

    const num = document.createElement

