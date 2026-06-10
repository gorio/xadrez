/* =====================================================
   CONFIGURAÇÃO DO FIREBASE
===================================================== */
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

/* =====================================================
   SÍMBOLOS
===================================================== */
const SYMBOLS = {
  wK:'♔', wQ:'♕', wR:'♖', wB:'♗', wN:'♘', wP:'♙',
  bK:'♚', bQ:'♛', bR:'♜', bB:'♝', bN:'♞', bP:'♟'
};

/* =====================================================
   ESTADO GLOBAL
===================================================== */
let db, roomRef;
let engine          = new ChessEngine();
let ai              = new ChessAI();
let myColor         = null;
let myId            = null;
let roomCode        = null;
let selectedSq      = null;
let legalMovesCache = [];
let pendingPromotion = null;
let gameActive      = false;
let gameMode        = 'multiplayer'; // 'multiplayer' | 'ai'
let aiColor         = 'b';           // cor que a IA joga
let aiThinking      = false;
let selectedDiff    = 'intermediario';
let selectedPlayerColor = 'w';

/* =====================================================
   BOOT
===================================================== */
window.addEventListener('DOMContentLoaded', () => {
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.database();
  } catch (e) {
    console.warn('Firebase não inicializado:', e.message);
  }

  myId = Math.random().toString(36).slice(2, 10);

  initLobbyUI();

  document.getElementById('btn-cancel').addEventListener('click', cancelGame);
  document.getElementById('btn-copy').addEventListener('click', copyRoomCode);
  document.getElementById('btn-resign').addEventListener('click', resign);
  document.getElementById('btn-new-game').addEventListener('click', goLobby);
  document.getElementById('btn-gameover-new').addEventListener('click', () => {
    hideModal('modal-gameover');
    if (gameMode === 'ai') startAIGame();
    else goLobby();
  });
  document.getElementById('btn-gameover-lobby').addEventListener('click', () => {
    hideModal('modal-gameover');
    goLobby();
  });
});

/* =====================================================
   LOBBY UI
===================================================== */
function initLobbyUI() {
  /* Modo de jogo */
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      gameMode = btn.dataset.mode;

      document.getElementById('panel-multiplayer').classList.toggle('hidden', gameMode !== 'multiplayer');
      document.getElementById('panel-ai').classList.toggle('hidden', gameMode !== 'ai');
    });
  });

  /* Botões multiplayer */
  document.getElementById('btn-create').addEventListener('click', createGame);
  document.getElementById('btn-join').addEventListener('click', joinGame);
  document.getElementById('input-room').addEventListener('keydown', e => {
    if (e.key === 'Enter') joinGame();
  });

  /* Cor do jogador (IA) */
  document.querySelectorAll('.color-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedPlayerColor = btn.dataset.color;
    });
  });

  /* Dificuldade */
  document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedDiff = btn.dataset.level;
    });
  });

  /* Iniciar vs IA */
  document.getElementById('btn-start-ai').addEventListener('click', startAIGame);
}

/* =====================================================
   NAVEGAÇÃO
===================================================== */
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
}

function showModal(id)  { document.getElementById(id).classList.remove('hidden'); }
function hideModal(id)  { document.getElementById(id).classList.add('hidden'); }

function goLobby() {
  gameActive  = false;
  aiThinking  = false;
  if (roomRef) { roomRef.off(); roomRef = null; }
  engine.reset();
  selectedSq      = null;
  legalMovesCache = [];
  document.getElementById('input-room').value = '';
  clearLobbyError();
  showScreen('lobby');
}

function showLobbyError(msg) { document.getElementById('lobby-error').textContent = msg; }
function clearLobbyError()   { document.getElementById('lobby-error').textContent = ''; }

/* =====================================================
   MODO: VS IA
===================================================== */
function startAIGame() {
  gameMode = 'ai';

  /* Cor do jogador */
  let playerColor = selectedPlayerColor;
  if (playerColor === 'random') {
    playerColor = Math.random() < 0.5 ? 'w' : 'b';
  }

  myColor = playerColor;
  aiColor = playerColor === 'w' ? 'b' : 'w';

  ai.setDifficulty(selectedDiff);
  engine.reset();
  gameActive = true;
  selectedSq = null;
  legalMovesCache = [];

  /* Labels */
  const diffLabels = {
    iniciante: 'Iniciante', intermediario: 'Intermediário',
    avancado: 'Avançado', expert: 'Expert'
  };

  if (myColor === 'w') {
    document.getElementById('avatar-bottom').textContent = '♙';
    document.getElementById('avatar-top').textContent    = '🤖';
    document.getElementById('label-bottom').textContent  = 'Você (Brancas)';
    document.getElementById('label-top').textContent     = `IA — ${diffLabels[selectedDiff]}`;
  } else {
    document.getElementById('avatar-bottom').textContent = '♟';
    document.getElementById('avatar-top').textContent    = '🤖';
    document.getElementById('label-bottom').textContent  = 'Você (Pretas)';
    document.getElementById('label-top').textContent     = `IA — ${diffLabels[selectedDiff]}`;
  }

  buildBoard();
  renderGame();
  showScreen('game');
  document.getElementById('btn-resign').classList.remove('hidden');
  document.getElementById('btn-new-game').classList.add('hidden');

  /* Se IA joga brancas, ela começa */
  if (engine.turn === aiColor) {
    scheduleAIMove();
  }
}

/* Agenda o movimento da IA com pequeno delay (UX) */
function scheduleAIMove() {
  if (!gameActive || engine.turn !== aiColor) return;
  aiThinking = true;
  updateStatusBar();

  const delay = selectedDiff === 'expert' ? 800 : 400;

  setTimeout(() => {
    if (!gameActive) return;
    const move = ai.getBestMove(engine);
    aiThinking = false;

    if (move) {
      engine.makeMove(move.from, move.to, move.promoteTo || 'Q');
      selectedSq      = null;
      legalMovesCache = [];
      renderGame();

      if (engine.status === 'checkmate') {
        gameActive = false;
        showGameOver('Xeque-mate!', 'A IA venceu. Tente novamente!');
      } else if (engine.status === 'stalemate') {
        gameActive = false;
        showGameOver('Empate!', 'Afogamento — nenhum movimento legal.');
      }
    }
  }, delay);
}

/* =====================================================
   MODO: MULTIPLAYER — CRIAR
===================================================== */
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function createGame() {
  if (!db) { showLobbyError('Firebase não configurado.'); return; }
  const btn = document.getElementById('btn-create');
  btn.disabled = true; btn.textContent = 'Criando...';
  clearLobbyError();

  try {
    roomCode = generateRoomCode();
    myColor  = 'w';
    engine.reset();
    roomRef  = db.ref('rooms/' + roomCode);

    await roomRef.set({
      white: myId, black: null,
      state: engine.serialize(),
      createdAt: Date.now(), status: 'waiting'
    });

    setTimeout(() => {
      if (!roomRef) return;
      roomRef.once('value', snap => {
        if (snap.val()?.status === 'waiting') { roomRef.remove(); goLobby(); }
      });
    }, 600000);

    document.getElementById('display-room-code').textContent = roomCode;
    showScreen('waiting');

    roomRef.on('value', snap => {
      const data = snap.val();
      if (!data) return;
      if (data.black && data.status === 'playing') {
        roomRef.off();
        startMultiplayerGame();
      }
    });

  } catch (e) {
    showLobbyError('Erro ao criar sala: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Criar Partida';
  }
}

/* =====================================================
   MODO: MULTIPLAYER — ENTRAR
===================================================== */
async function joinGame() {
  if (!db) { showLobbyError('Firebase não configurado.'); return; }
  const input = document.getElementById('input-room');
  const code  = input.value.trim().toUpperCase();
  clearLobbyError();

  if (code.length !== 6) { showLobbyError('Código deve ter 6 caracteres.'); return; }

  const btn = document.getElementById('btn-join');
  btn.disabled = true; btn.textContent = 'Entrando...';

  try {
    roomRef = db.ref('rooms/' + code);
    const snap = await roomRef.once('value');
    const data = snap.val();

    if (!data)                                          { showLobbyError('Sala não encontrada.');       roomRef=null; return; }
    if (data.black)                                     { showLobbyError('Sala já está cheia.');        roomRef=null; return; }
    if (['finished','resigned'].includes(data.status)) { showLobbyError('Partida já encerrada.');      roomRef=null; return; }

    roomCode = code;
    myColor  = 'b';
    engine.deserialize(data.state);

    await roomRef.update({ black: myId, status: 'playing' });
    startMultiplayerGame();

  } catch (e) {
    showLobbyError('Erro ao entrar: ' + e.message);
    roomRef = null;
  } finally {
    btn.disabled = false; btn.textContent = 'Entrar';
  }
}

async function cancelGame() {
  if (roomRef) { await roomRef.remove().catch(()=>{}); roomRef.off(); roomRef = null; }
  goLobby();
}

function copyRoomCode() {
  navigator.clipboard.writeText(roomCode).then(() => {
    const fb = document.getElementById('copy-feedback');
    fb.textContent = 'Copiado!';
    setTimeout(() => { fb.textContent = ''; }, 2000);
  });
}

/* =====================================================
   INICIAR JOGO MULTIPLAYER
===================================================== */
function startMultiplayerGame() {
  gameMode   = 'multiplayer';
  gameActive = true;
  selectedSq = null;
  legalMovesCache = [];

  if (myColor === 'w') {
    document.getElementById('avatar-bottom').textContent = '♙';
    document.getElementById('avatar-top').textContent    = '♟';
    document.getElementById('label-bottom').textContent  = 'Você (Brancas)';
    document.getElementById('label-top').textContent     = 'Oponente (Pretas)';
  } else {
    document.getElementById('avatar-bottom').textContent = '♟';
    document.getElementById('avatar-top').textContent    = '♙';
    document.getElementById('label-bottom').textContent  = 'Você (Pretas)';
    document.getElementById('label-top').textContent     = 'Oponente (Brancas)';
  }

  buildBoard();
  renderGame();
  showScreen('game');
  document.getElementById('btn-resign').classList.remove('hidden');
  document.getElementById('btn-new-game').classList.add('hidden');

  /* Escuta Firebase */
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

/* =====================================================
   TABULEIRO
===================================================== */
function buildBoard() {
  const boardEl = document.getElementById('chessboard');
  boardEl.innerHTML = '';

  const files = myColor === 'w'
    ? ['a','b','c','d','e','f','g','h']
    : ['h','g','f','e','d','c','b','a'];
  const ranks = myColor === 'w'
    ? ['8','7','6','5','4','3','2','1']
    : ['1','2','3','4','5','6','7','8'];

  ['coords-file-top','coords-file-bottom'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = '';
    files.forEach(f => {
      const s = document.createElement('span');
      s.className = 'coord-label';
      s.style.width = 'calc(var(--board-size) / 8)';
      s.textContent = f;
      el.appendChild(s);
    });
  });

  ['coords-rank-left','coords-rank-right'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = '';
    ranks.forEach(r => {
      const s = document.createElement('span');
      s.className = 'coord-label';
      s.style.height = 'calc(var(--board-size) / 8)';
      s.textContent = r;
      el.appendChild(s);
    });
  });

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

function viewToLogic(vr, vc) { return myColor === 'w' ? [vr, vc] : [7-vr, 7-vc]; }
function logicToView(lr, lc) { return myColor === 'w' ? [lr, lc] : [7-lr, 7-lc]; }

/* =====================================================
   RENDERIZAÇÃO
===================================================== */
function renderGame() {
  document.querySelectorAll('.square').forEach(sq => {
    const vr = parseInt(sq.dataset.row);
    const vc = parseInt(sq.dataset.col);
    const [lr, lc] = viewToLogic(vr, vc);

    const isLight = (vr + vc) % 2 === 0;
    sq.className = 'square ' + (isLight ? 'light' : 'dark');
    sq.innerHTML = '';

    if (engine.lastMove) {
      const [fvr, fvc] = logicToView(...engine.lastMove.from);
      const [tvr, tvc] = logicToView(...engine.lastMove.to);
      if ((vr===fvr && vc===fvc) || (vr===tvr && vc===tvc)) sq.classList.add('last-move');
    }

    const piece = engine.piece(lr, lc);
    if (piece) {
      const span = document.createElement('span');
      span.className = 'piece ' + (piece.color === 'w' ? 'piece-white' : 'piece-black');
      span.textContent = SYMBOLS[piece.color + piece.type] || '?';
      sq.appendChild(span);
      if (piece.type==='K' && piece.color===engine.turn && engine.status==='check')
        sq.classList.add('in-check');
    }
  });

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

/* =====================================================
   CLIQUE NA CASA
===================================================== */
function onSquareClick(e) {
  const sq = e.currentTarget;
  const vr = parseInt(sq.dataset.row);
  const vc = parseInt(sq.dataset.col);
  const [lr, lc] = viewToLogic(vr, vc);

  if (!gameActive) return;
  if (aiThinking)  return;
  if (engine.turn !== myColor) return;
  if (['checkmate','stalemate'].includes(engine.status)) return;

  const piece = engine.piece(lr, lc);

  if (selectedSq !== null) {
    const [slr, slc] = selectedSq;
    const move = legalMovesCache.find(m => m.to[0]===lr && m.to[1]===lc);

    if (move) {
      if (engine.board[slr][slc]?.type==='P' && (lr===0 || lr===7)) {
        pendingPromotion = { from:[slr,slc], to:[lr,lc] };
        showPromotion();
        return;
      }
      doMove([slr,slc], [lr,lc]);
      return;
    }

    if (piece && piece.color === myColor) {
      selectedSq = [lr, lc];
      legalMovesCache = engine.legalMoves(lr, lc);
      renderGame();
      return;
    }

    selectedSq = null;
    legalMovesCache = [];
    renderGame();
    return;
  }

  if (piece && piece.color === myColor) {
    selectedSq = [lr, lc];
    legalMovesCache = engine.legalMoves(lr, lc);
    renderGame();
  }
}

/* =====================================================
   EXECUTA MOVIMENTO
===================================================== */
async function doMove(from, to, promoteTo = 'Q') {
  const ok = engine.makeMove(from, to, promoteTo);
  if (!ok) return;

  selectedSq = null;
  legalMovesCache = [];
  renderGame();

  /* Multiplayer: salva no Firebase */
  if (gameMode === 'multiplayer' && roomRef) {
    try { await roomRef.update({ state: engine.serialize() }); }
    catch (e) { console.error('Erro ao salvar:', e); }
  }

  /* Verifica fim de jogo */
  if (engine.status === 'checkmate') {
    if (gameMode === 'multiplayer' && roomRef) {
      await roomRef.update({ status:'finished', winner:myColor }).catch(()=>{});
    }
    gameActive = false;
    showGameOver('Xeque-mate! 🏆', 'Você venceu! Parabéns!');
    return;
  }
  if (engine.status === 'stalemate') {
    if (gameMode === 'multiplayer' && roomRef) {
      await roomRef.update({ status:'finished', winner:null }).catch(()=>{});
    }
    gameActive = false;
    showGameOver('Empate!', 'Afogamento — nenhum movimento legal.');
    return;
  }

  /* vs IA: agenda resposta */
  if (gameMode === 'ai' && engine.turn === aiColor) {
    scheduleAIMove();
  }
}

/* =====================================================
   PROMOÇÃO
===================================================== */
function showPromotion() {
  const choices = document.getElementById('promotion-choices');
  choices.innerHTML = '';
  ['Q','R','B','N'].forEach(type => {
    const btn = document.createElement('button');
    btn.className = 'promotion-choice';
    btn.textContent = SYMBOLS[myColor + type];
    btn.addEventListener('click', () => {
      hideModal('modal-promotion');
      const { from, to } = pendingPromotion;
      pendingPromotion = null;
      selectedSq = null;
      legalMovesCache = [];
      doMove(from, to, type);
    });
    choices.appendChild(btn);
  });
  showModal('modal-promotion');
}

/* =====================================================
   STATUS BAR
===================================================== */
function updateStatusBar() {
  const bar = document.getElementById('status-bar');
  bar.className = 'status-bar';
  bar.innerHTML = '';

  if (aiThinking) {
    bar.innerHTML = `IA pensando <span class="thinking-dots"><span></span><span></span><span></span></span>`;
    return;
  }

  const isMyTurn = engine.turn === myColor;
  const msgs = {
    playing:   isMyTurn ? 'Sua vez'                    : (gameMode==='ai' ? 'IA pensando...' : 'Vez do oponente'),
    check:     isMyTurn ? '⚠ Xeque! Defenda seu rei'   : 'Oponente está em xeque',
    checkmate: 'Xeque-mate!',
    stalemate: 'Afogamento!'
  };

  bar.textContent = msgs[engine.status] || '';
  if (engine.status==='check'   && isMyTurn) bar.classList.add('check');
  if (engine.status==='playing' && isMyTurn) bar.classList.add('your-turn');
}

/* =====================================================
   HISTÓRICO
===================================================== */
function updateMoveHistory() {
  const box = document.getElementById('move-history');
  box.innerHTML = '';
  const moves = engine.history;

  for (let i = 0; i < moves.length; i += 2) {
    const row = document.createElement('div');
    row.className = 'move-row';

    const num = document.createElement('span');
    num.className = 'move-num';
    num.textContent = (Math.floor(i/2)+1) + '.';

    const w = document.createElement('span');
    w.className = 'move-san';
    w.textContent = moves[i] || '';

    const b = document.createElement('span');
    b.className = 'move-san';
    b.textContent = moves[i+1] || '';

    row.appendChild(num);
    row.appendChild(w);
    row.appendChild(b);
    box.appendChild(row);
  }
  box.scrollTop = box.scrollHeight;
}

/* =====================================================
   PEÇAS CAPTURADAS
===================================================== */
function updateCaptured() {
  const order = { Q:9, R:5, B:3, N:3, P:1 };

  const render = (capturedColor, elId) => {
    const el = document.getElementById(elId);
    if (!el) return;
    el.innerHTML = '';

    const pieces = [...engine.captured[capturedColor]]
      .sort((a, b) => (order[b]||0) - (order[a]||0));

    if (pieces.length === 0) return;

    const myScore  = pieces.reduce((s,t) => s+(order[t]||0), 0);
    const oppColor = capturedColor === 'w' ? 'b' : 'w';
    const oppScore = engine.captured[oppColor].reduce((s,t) => s+(order[t]||0), 0);
    const adv      = myScore - oppScore;

    pieces.forEach(type => {
      const span = document.createElement('span');
      span.className = 'cap-piece ' + (capturedColor === 'w' ? 'cap-black' : 'cap-white');
      span.textContent = SYMBOLS[capturedColor + type];
      el.appendChild(span);
    });

    if (adv > 0) {
      const s = document.createElement('span');
      s.className = 'advantage-score';
      s.textContent = '+' + adv;
      el.appendChild(s);
    }
  };

  if (myColor === 'w') {
    render('b', 'captured-bottom');
    render('w', 'captured-top');
  } else {
    render('w', 'captured-bottom');
    render('b', 'captured-top');
  }
}

/* =====================================================
   CARDS DE TURNO
===================================================== */
function updateTurnCards() {
  const isMyTurn = engine.turn === myColor;
  document.getElementById('card-bottom').classList.toggle('active-turn',  isMyTurn);
  document.getElementById('card-top').classList.toggle('active-turn',    !isMyTurn);
}

/* =====================================================
   RESIGNAR
===================================================== */
async function resign() {
  if (!gameActive) return;
  if (!confirm('Tem certeza que deseja resignar?')) return;
  gameActive = false;

  if (gameMode === 'multiplayer' && roomRef) {
    const enemy = myColor === 'w' ? 'b' : 'w';
    await roomRef.update({ status:'resigned', winner:enemy, state:engine.serialize() }).catch(()=>{});
  }

  showGameOver('Você resignou', gameMode==='ai' ? 'A IA venceu.' : 'O oponente venceu.');
}

/* =====================================================
   GAME OVER
===================================================== */
function showGameOver(title, msg) {
  document.getElementById('gameover-title').textContent = title;
  document.getElementById('gameover-msg').textContent   = msg;

  const icon = document.getElementById('gameover-icon');
  if (title.includes('🏆') || title.includes('Venceu')) icon.textContent = '🏆';
  else if (title.includes('Empate'))                    icon.textContent = '🤝';
  else if (title.includes('resignou'))                  icon.textContent = '🏳';
  else                                                   icon.textContent = '♟';

  document.getElementById('btn-resign').classList.add('hidden');
  document.getElementById('btn-new-game').classList.remove('hidden');
  setTimeout(() => showModal('modal-gameover'), 700);
}