/* ===================================================
   CONFIGURAÇÃO DO FIREBASE
   =================================================== */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCa0WmUo1PIrlaYW6Ei8ZZK3XLZ4i0gIfo",
  authDomain: "golf-oscar-romeo.firebaseapp.com",
  projectId: "golf-oscar-romeo",
  storageBucket: "golf-oscar-romeo.firebasestorage.app",
  databaseURL: "https://golf-oscar-romeo-default-rtdb.firebaseio.com",
  messagingSenderId: "71631208569",
  appId: "1:71631208569:web:e7a1cc7ad20903ce5ad4a8",
  measurementId: "G-9TKPXNPL54"
};

/* ===================================================
   SÍMBOLOS DAS PEÇAS
   =================================================== */
const SYMBOLS = {
  wK:'♔', wQ:'♕', wR:'♖', wB:'♗', wN:'♘', wP:'♙',
  bK:'♚', bQ:'♛', bR:'♜', bB:'♝', bN:'♞', bP:'♟'
};

/* ===================================================
   ESTADO GLOBAL
   =================================================== */
let db, roomRef;
let engine     = new ChessEngine();
let myColor    = null;
let myId       = null;
let roomCode   = null;
let selectedSq = null;
let legalMovesCache  = [];
let pendingPromotion = null;
let gameActive = false;

/* ===================================================
   BOOT
   =================================================== */
window.addEventListener('DOMContentLoaded', () => {
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.database();
  } catch (e) {
    alert('Erro Firebase: verifique a configuração em js/app.js\n' + e.message);
    return;
  }

  myId = Math.random().toString(36).slice(2, 10);

  /* botões lobby */
  document.getElementById('btn-create').addEventListener('click', createGame);
  document.getElementById('btn-join').addEventListener('click', joinGame);
  document.getElementById('input-room').addEventListener('keydown', e => {
    if (e.key === 'Enter') joinGame();
  });

  /* botões sala de espera */
  document.getElementById('btn-copy').addEventListener('click', copyRoomCode);
  document.getElementById('btn-cancel').addEventListener('click', cancelGame);

  /* botões jogo */
  document.getElementById('btn-resign').addEventListener('click', resign);
  document.getElementById('btn-new-game').addEventListener('click', () => goLobby());

  /* modal game over */
  document.getElementById('btn-gameover-new').addEventListener('click', () => {
    hideModal('modal-gameover');
    goLobby();
  });
  document.getElementById('btn-gameover-lobby').addEventListener('click', () => {
    hideModal('modal-gameover');
    goLobby();
  });
});

/* ===================================================
   NAVEGAÇÃO
   =================================================== */
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
}

function showModal(id)  { document.getElementById(id).classList.remove('hidden'); }
function hideModal(id)  { document.getElementById(id).classList.add('hidden'); }

function goLobby() {
  gameActive = false;
  if (roomRef) { roomRef.off(); roomRef = null; }
  engine.reset();
  selectedSq = null;
  legalMovesCache = [];
  document.getElementById('input-room').value = '';
  clearLobbyError();
  showScreen('lobby');
}

function showLobbyError(msg) {
  document.getElementById('lobby-error').textContent = msg;
}

function clearLobbyError() {
  document.getElementById('lobby-error').textContent = '';
}

/* ===================================================
   GERAR CÓDIGO DE SALA
   =================================================== */
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/* ===================================================
   CRIAR PARTIDA
   =================================================== */
async function createGame() {
  const btn = document.getElementById('btn-create');
  btn.disabled = true;
  btn.textContent = 'Criando...';
  clearLobbyError();

  try {
    roomCode = generateRoomCode();
    myColor  = 'w';
    engine.reset();

    roomRef = db.ref('rooms/' + roomCode);

    await roomRef.set({
      white:     myId,
      black:     null,
      state:     engine.serialize(),
      createdAt: Date.now(),
      status:    'waiting'
    });

    /* auto-remove após 10 min sem oponente */
    setTimeout(() => {
      if (!roomRef) return;
      roomRef.once('value', snap => {
        if (snap.val()?.status === 'waiting') {
          roomRef.remove();
          goLobby();
        }
      });
    }, 600000);

    document.getElementById('display-room-code').textContent = roomCode;
    showScreen('waiting');

    /* aguarda oponente */
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
  } finally {
    btn.disabled = false;
    btn.textContent = 'Criar Partida';
  }
}

/* ===================================================
   ENTRAR NA PARTIDA
   =================================================== */
async function joinGame() {
  const input = document.getElementById('input-room');
  const code  = input.value.trim().toUpperCase();
  clearLobbyError();

  if (code.length !== 6) {
    showLobbyError('Código deve ter 6 caracteres.');
    return;
  }

  const btn = document.getElementById('btn-join');
  btn.disabled = true;
  btn.textContent = 'Entrando...';

  try {
    roomRef = db.ref('rooms/' + code);
    const snap = await roomRef.once('value');
    const data = snap.val();

    if (!data) {
      showLobbyError('Sala não encontrada.');
      roomRef = null;
      return;
    }
    if (data.black) {
      showLobbyError('Sala já está cheia.');
      roomRef = null;
      return;
    }
    if (data.status === 'finished' || data.status === 'resigned') {
      showLobbyError('Esta partida já terminou.');
      roomRef = null;
      return;
    }

    roomCode = code;
    myColor  = 'b';
    engine.deserialize(data.state);

    await roomRef.update({ black: myId, status: 'playing' });
    startGame();

  } catch (e) {
    showLobbyError('Erro ao entrar: ' + e.message);
    roomRef = null;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
}

/* ===================================================
   CANCELAR SALA DE ESPERA
   =================================================== */
async function cancelGame() {
  if (roomRef) {
    await roomRef.remove().catch(() => {});
    roomRef.off();
    roomRef = null;
  }
  goLobby();
}

/* ===================================================
   COPIAR CÓDIGO
   =================================================== */
function copyRoomCode() {
  navigator.clipboard.writeText(roomCode).then(() => {
    const fb = document.getElementById('copy-feedback');
    fb.textContent = 'Copiado!';
    setTimeout(() => { fb.textContent = ''; }, 2000);
  });
}

/* ===================================================
   INICIAR JOGO
   =================================================== */
function startGame() {
  gameActive = true;
  selectedSq = null;
  legalMovesCache = [];

  /* labels de jogador */
  if (myColor === 'w') {
    document.getElementById('avatar-bottom').textContent  = '♙';
    document.getElementById('avatar-top').textContent     = '♟';
    document.getElementById('label-bottom').textContent   = 'Você (Brancas)';
    document.getElementById('label-top').textContent      = 'Oponente (Pretas)';
  } else {
    document.getElementById('avatar-bottom').textContent  = '♟';
    document.getElementById('avatar-top').textContent     = '♙';
    document.getElementById('label-bottom').textContent   = 'Você (Pretas)';
    document.getElementById('label-top').textContent      = 'Oponente (Brancas)';
  }

  buildBoard();
  renderGame();
  showScreen('game');

  document.getElementById('btn-resign').classList.remove('hidden');
  document.getElementById('btn-new-game').classList.add('hidden');

  /* escuta Firebase */
  roomRef.on('value', snap => {
    const data = snap.val();
    if (!data) return;

    if (data.status === 'resigned' && data.winner !== myColor) {
      engine.deserialize(data.state);
      renderGame();
      gameActive = false;
      showGameOver('Vitória! 🏆', 'O oponente resignou a partida.');
      return;
    }

    if (data.status === 'abandoned') {
      gameActive = false;
      showGameOver('Vitória! 🏆', 'O oponente abandonou a partida.');
      return;
    }

    /* atualiza apenas quando for a minha vez (oponente jogou) */
    if (data.state && data.state.turn === myColor) {
      engine.deserialize(data.state);
      renderGame();

      if (engine.status === 'checkmate') {
        gameActive = false;
        showGameOver('Xeque-mate!', 'Você perdeu. Melhor sorte na próxima!');
      } else if (engine.status === 'stalemate') {
        gameActive = false;
        showGameOver('Empate!', 'Afogamento — nenhum movimento legal.');
      }
    }
  });
}

/* ===================================================
   CONSTRUIR TABULEIRO HTML
   =================================================== */
function buildBoard() {
  const boardEl = document.getElementById('chessboard');
  boardEl.innerHTML = '';

  const files = myColor === 'w'
    ? ['a','b','c','d','e','f','g','h']
    : ['h','g','f','e','d','c','b','a'];
  const ranks = myColor === 'w'
    ? ['8','7','6','5','4','3','2','1']
    : ['1','2','3','4','5','6','7','8'];

  /* coordenadas de arquivo (topo e base) */
  ['coords-file-top','coords-file-bottom'].forEach(id => {
    const el = boardEl.parentElement.querySelector('#' + id);
    if (!el) return;
    el.innerHTML = '';
    files.forEach(f => {
      const span = document.createElement('span');
      span.className = 'coord-label';
      span.style.width = 'calc(min(56vw, 480px) / 8)';
      span.textContent = f;
      el.appendChild(span);
    });
  });

  /* coordenadas de fileira */
  ['coords-rank-left','coords-rank-right'].forEach(id => {
    const el = boardEl.parentElement.querySelector('#' + id);
    if (!el) return;
    el.innerHTML = '';
    ranks.forEach(r => {
      const span = document.createElement('span');
      span.className = 'coord-label';
      span.style.height = 'calc(min(56vw, 480px) / 8)';
      span.textContent = r;
      el.appendChild(span);
    });
  });

  /* casas */
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const sq = document.createElement('div');
      sq.className = 'square';
      sq.dataset.row = row;
      sq.dataset.col = col;
      sq.addEventListener('click', onSquareClick);
      boardEl.appendChild(sq);
    }
  }
}

/* ===================================================
   MAPEAMENTO VIEW ↔ LÓGICO
   =================================================== */
function viewToLogic(vr, vc) {
  if (myColor === 'w') return [vr, vc];
  return [7 - vr, 7 - vc];
}

function logicToView(lr, lc) {
  if (myColor === 'w') return [lr, lc];
  return [7 - lr, 7 - lc];
}

/* ===================================================
   RENDERIZAR POSIÇÃO
   =================================================== */
function renderGame() {
  document.querySelectorAll('.square').forEach(sq => {
    const vr = parseInt(sq.dataset.row);
    const vc = parseInt(sq.dataset.col);
    const [lr, lc] = viewToLogic(vr, vc);

    const isLight = (vr + vc) % 2 === 0;
    sq.className = 'square ' + (isLight ? 'light' : 'dark');
    sq.innerHTML = '';

    /* último movimento */
    if (engine.lastMove) {
      const [fvr, fvc] = logicToView(...engine.lastMove.from);
      const [tvr, tvc] = logicToView(...engine.lastMove.to);
      if ((vr === fvr && vc === fvc) || (vr === tvr && vc === tvc)) {
        sq.classList.add('last-move');
      }
    }

    /* peça */
    const piece = engine.piece(lr, lc);
    if (piece) {
      const span = document.createElement('span');
      span.className = 'piece';
      span.textContent = SYMBOLS[piece.color + piece.type] || '?';
      sq.appendChild(span);

      /* rei em xeque */
      if (piece.type === 'K' && piece.color === engine.turn && engine.status === 'check') {
        sq.classList.add('in-check');
      }
    }
  });

  /* seleção e dicas */
  if (selectedSq !== null) {
    const [slr, slc] = selectedSq;
    const [svr, svc] = logicToView(slr, slc);
    const selEl = document.querySelector(`[data-row="${svr}"][data-col="${svc}"]`);
    if (selEl) selEl.classList.add('selected');

    legalMovesCache.forEach(m => {
      const [mvr, mvc] = logicToView(m.to[0], m.to[1]);
      const el = document.querySelector(`[data-row="${mvr}"][data-col="${mvc}"]`);
      if (el) {
        const hasPiece = engine.piece(m.to[0], m.to[1]) || m.enPassant;
        el.classList.add(hasPiece ? 'capture-hint' : 'move-hint');
      }
    });
  }

  updateStatusBar();
  updateMoveHistory();
  updateCaptured();
  updateTurnCards();
}

/* ===================================================
   CLIQUE NA CASA
   =================================================== */
function onSquareClick(e) {
  const sq  = e.currentTarget;
  const vr  = parseInt(sq.dataset.row);
  const vc  = parseInt(sq.dataset.col);
  const [lr, lc] = viewToLogic(vr, vc);

  if (!gameActive) return;
  if (engine.turn !== myColor) return;
  if (['checkmate','stalemate'].includes(engine.status)) return;

  const piece = engine.piece(lr, lc);

  if (selectedSq !== null) {
    const [slr, slc] = selectedSq;
    const move = legalMovesCache.find(m => m.to[0] === lr && m.to[1] === lc);

    if (move) {
      /* promoção */
      if (engine.board[slr][slc]?.type === 'P' && (lr === 0 || lr === 7)) {
        pendingPromotion = { from: [slr, slc], to: [lr, lc] };
        showPromotion();
        return;
      }
      doMove([slr, slc], [lr, lc]);
      return;
    }

    /* troca de peça selecionada */
    if (piece && piece.color === myColor) {
      selectedSq      = [lr, lc];
      legalMovesCache = engine.legalMoves(lr, lc);
      renderGame();
      return;
    }

    /* deseleciona */
    selectedSq      = null;
    legalMovesCache = [];
    renderGame();
    return;
  }

  /* seleciona */
  if (piece && piece.color === myColor) {
    selectedSq      = [lr, lc];
    legalMovesCache = engine.legalMoves(lr, lc);
    renderGame();
  }
}

/* ===================================================
   EXECUTAR MOVIMENTO
   =================================================== */
async function doMove(from, to, promoteTo = 'Q') {
  const ok = engine.makeMove(from, to, promoteTo);
  if (!ok) return;

  selectedSq      = null;
  legalMovesCache = [];
  renderGame();

  try {
    await roomRef.update({ state: engine.serialize() });
  } catch (e) {
    console.error('Erro ao salvar movimento:', e);
  }

  if (engine.status === 'checkmate') {
    await roomRef.update({ status: 'finished', winner: myColor }).catch(() => {});
    gameActive = false;
    showGameOver('Xeque-mate! 🏆', 'Você venceu! Parabéns!');
  } else if (engine.status === 'stalemate') {
    await roomRef.update({ status: 'finished', winner: null }).catch(() => {});
    gameActive = false;
    showGameOver('Empate!', 'Afogamento — nenhum movimento legal.');
  }
}

/* ===================================================
   PROMOÇÃO
   =================================================== */
function showPromotion() {
  const choices = document.getElementById('promotion-choices');
  choices.innerHTML = '';
  const pieces = ['Q','R','B','N'];

  pieces.forEach(type => {
    const btn = document.createElement('button');
    btn.className = 'promotion-choice';
    btn.textContent = SYMBOLS[myColor + type];
    btn.addEventListener('click', () => {
      hideModal('modal-promotion');
      const { from, to } = pendingPromotion;
      pendingPromotion   = null;
      selectedSq         = null;
      legalMovesCache    = [];
      doMove(from, to, type);
    });
    choices.appendChild(btn);
  });

  showModal('modal-promotion');
}

/* ===================================================
   STATUS BAR
   =================================================== */
function updateStatusBar() {
  const bar = document.getElementById('status-bar');
  bar.className = 'status-bar';

  if (!gameActive && engine.status === 'playing') {
    bar.textContent = 'Conectando...';
    return;
  }

  const isMyTurn = engine.turn === myColor;

  const messages = {
    playing:   isMyTurn ? 'Sua vez' : 'Vez do oponente',
    check:     isMyTurn ? '⚠ Xeque! Defenda seu rei' : 'Oponente está em xeque',
    checkmate: 'Xeque-mate!',
    stalemate: 'Afogamento!'
  };

  bar.textContent = messages[engine.status] || '';

  if (engine.status === 'check' && isMyTurn)    bar.classList.add('check');
  if (engine.status === 'playing' && isMyTurn)  bar.classList.add('your-turn');
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

    const num = document.createElement('span');
    num.className = 'move-num';
    num.textContent = (Math.floor(i / 2) + 1) + '.';

    const w = document.createElement('span');
    w.className = 'move-san';
    w.textContent = moves[i] || '';

    const b = document.createElement('span');
    b.className = 'move-san';
    b.textContent = moves[i + 1] || '';

    row.appendChild(num);
    row.appendChild(w);
    row.appendChild(b);
    box.appendChild(row);
  }

  box.scrollTop = box.scrollHeight;
}

/* ===================================================
   PEÇAS CAPTURADAS
   =================================================== */
function updateCaptured() {
  const order = { Q:9, R:5, B:3, N:3, P:1 };

  const render = (color, elId) => {
    const el = document.getElementById(elId);
    const pieces = [...engine.captured[color]]
      .sort((a, b) => (order[b] || 0) - (order[a] || 0))
      .map(t => SYMBOLS[color === 'w' ? 'b' + t : 'w' + t])
      .join('');
    el.textContent = pieces;
  };

  if (myColor === 'w') {
    render('w', 'captured-bottom'); /* brancas capturaram pretas → exibe embaixo */
    render('b', 'captured-top');
  } else {
    render('b', 'captured-bottom');
    render('w', 'captured-top');
  }
}

/* ===================================================
   DESTAQUE DE TURNO NAS CARDS DE JOGADOR
   =================================================== */
function updateTurnCards() {
  const isMyTurn = engine.turn === myColor;
  document.getElementById('card-bottom').classList.toggle('active-turn',  isMyTurn);
  document.getElementById('card-top').classList.toggle('active-turn',    !isMyTurn);
}

/* ===================================================
   RESIGNAR
   =================================================== */
async function resign() {
  if (!gameActive) return;
  const ok = confirm('Tem certeza que deseja resignar?');
  if (!ok) return;

  gameActive = false;
  const enemy = myColor === 'w' ? 'b' : 'w';

  try {
    await roomRef.update({
      status: 'resigned',
      winner: enemy,
      state:  engine.serialize()
    });
  } catch(e) {
    console.error(e);
  }

  showGameOver('Você resignou', 'O oponente venceu a partida.');
}

/* ===================================================
   MODAL GAME OVER
   =================================================== */
function showGameOver(title, msg) {
  document.getElementById('gameover-title').textContent = title;
  document.getElementById('gameover-msg').textContent   = msg;

  const icon = document.getElementById('gameover-icon');
  if (title.includes('Vitória') || title.includes('Venceu') || title.includes('mate! 🏆')) {
    icon.textContent = '🏆';
  } else if (title.includes('Empate')) {
    icon.textContent = '🤝';
  } else {
    icon.textContent = '♟';
  }

  document.getElementById('btn-resign').classList.add('hidden');
  document.getElementById('btn-new-game').classList.remove('hidden');

  setTimeout(() => showModal('modal-gameover'), 800);
}