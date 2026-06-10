/* =====================================================
   CONFIGURAÇÃO FIREBASE
===================================================== */
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyCa0WmUo1PIrlaYW6Ei8ZZK3XLZ4i0gIfo",
  authDomain:        "golf-oscar-romeo.firebaseapp.com",
  projectId:         "golf-oscar-romeo",
  storageBucket:     "golf-oscar-romeo.firebasestorage.app",
  databaseURL:       "https://golf-oscar-romeo-default-rtdb.firebaseio.com",
  messagingSenderId: "71631208569",
  appId:             "1:71631208569:web:e7a1cc7ad20903ce5ad4a8"
};

const SYMBOLS = {
  wK:'♔', wQ:'♕', wR:'♖', wB:'♗', wN:'♘', wP:'♙',
  bK:'♚', bQ:'♛', bR:'♜', bB:'♝', bN:'♞', bP:'♟'
};

/* =====================================================
   ESTADO GLOBAL
===================================================== */
let db, fbAuth, currentUser = null;
let engine             = new ChessEngine();
let ai                 = new ChessAI();
let myColor            = null;
let myId               = 'guest_' + Math.random().toString(36).slice(2, 8);
let roomCode           = null;
let roomRef            = null;
let specRef            = null;
let selectedSq         = null;
let legalMovesCache    = [];
let pendingPromotion   = null;
let gameActive         = false;
let gameMode           = 'multiplayer';
let aiColor            = 'b';
let aiThinking         = false;
let selectedDiff       = 'intermediario';
let selectedPlayerColor = 'w';
let isSpectator        = false;
let opponentNameGlobal = 'Oponente';

/* replay */
let replayMoves    = [];
let replayIndex    = 0;
let replayEngine   = null;
let replayInterval = null;
let replayGameData = null;

/* =====================================================
   HELPER — addEventListener seguro contra null
===================================================== */
function el(id, event, handler) {
  const element = document.getElementById(id);
  if (element) {
    element.addEventListener(event, handler);
  } else {
    console.warn(`#${id} não encontrado para evento '${event}'`);
  }
}

/* =====================================================
   BOOT
===================================================== */
window.addEventListener('DOMContentLoaded', () => {
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    db     = firebase.database();
    fbAuth = firebase.auth();
  } catch (e) {
    console.error('Firebase init error:', e);
    return;
  }

  initAuthUI();
  initLobbyUI();
  initGameUI();
  initHistoryUI();
  initReplayUI();

  fbAuth.onAuthStateChanged(user => {
    currentUser = user;
    if (user) {
      myId = user.uid;
      const name = user.displayName || user.email?.split('@')[0] || 'Jogador';

      /* Nome no header */
      const headerName = document.getElementById('header-username');
      if (headerName) headerName.textContent = name;

      /* Avatar no header — foto se tiver, iniciais se não tiver */
      const headerAvatar = document.getElementById('header-avatar');
      if (headerAvatar) {
        const photo = user.photoURL;
        if (photo) {
          headerAvatar.innerHTML = `<img src="${photo}" alt="${name}" class="header-photo" />`;
        } else {
          const initials = name.split(' ').slice(0,2).map(w => w[0]).join('').toUpperCase();
          headerAvatar.textContent = initials;
          headerAvatar.classList.add('header-avatar-initials');
        }
      }

      db.ref('users/' + user.uid).update({
        displayName: name,
        email:       user.email || '',
        photoURL:    user.photoURL || '',
        lastSeen:    Date.now()
      });

      showScreen('lobby');
    } else {
      showScreen('auth');
    }
  });
});

/* =====================================================
   AUTH — funções de login
===================================================== */
async function loginWithEmail() {
  const email = document.getElementById('login-email').value.trim();
  const pass  = document.getElementById('login-password').value;
  if (!email || !pass) { showAuthError('Preencha e-mail e senha.'); return; }
  try {
    await fbAuth.signInWithEmailAndPassword(email, pass);
  } catch (e) { showAuthError(authErrorMsg(e.code)); }
}

async function loginWithGoogle() {
  try {
    await fbAuth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
  } catch (e) {
    if (e.code !== 'auth/popup-closed-by-user') showAuthError(authErrorMsg(e.code));
  }
}

async function registerWithEmail() {
  const name  = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const pass  = document.getElementById('reg-password').value;
  if (!name)           { showAuthError('Informe seu nome.'); return; }
  if (!email)          { showAuthError('Informe seu e-mail.'); return; }
  if (pass.length < 6) { showAuthError('Senha mínima de 6 caracteres.'); return; }
  try {
    const cred = await fbAuth.createUserWithEmailAndPassword(email, pass);
    await cred.user.updateProfile({ displayName: name });
    await cred.user.reload();
  } catch (e) { showAuthError(authErrorMsg(e.code)); }
}

async function loginAsGuest() {
  try {
    const cred = await fbAuth.signInAnonymously();
    await cred.user.updateProfile({ displayName: 'Visitante' });
  } catch (e) { showAuthError('Erro ao entrar como visitante.'); }
}

function authErrorMsg(code) {
  return ({
    'auth/user-not-found':       'Usuário não encontrado.',
    'auth/wrong-password':       'Senha incorreta.',
    'auth/email-already-in-use': 'E-mail já cadastrado.',
    'auth/invalid-email':        'E-mail inválido.',
    'auth/weak-password':        'Senha muito fraca.',
    'auth/too-many-requests':    'Muitas tentativas. Tente mais tarde.'
  })[code] || 'Erro ao autenticar.';
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  if (el) el.textContent = msg;
}
function clearAuthError() {
  const el = document.getElementById('auth-error');
  if (el) el.textContent = '';
}

/* =====================================================
   INIT — Auth UI
===================================================== */
function initAuthUI() {
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.tab;
      const tl = document.getElementById('tab-login');
      const tr = document.getElementById('tab-register');
      if (tl) tl.classList.toggle('hidden', target !== 'login');
      if (tr) tr.classList.toggle('hidden', target !== 'register');
      clearAuthError();
    });
  });

  el('btn-login-email',     'click',   loginWithEmail);
  el('login-password',      'keydown', e => { if (e.key === 'Enter') loginWithEmail(); });
  el('btn-login-google',    'click',   loginWithGoogle);
  el('btn-register',        'click',   registerWithEmail);
  el('btn-register-google', 'click',   loginWithGoogle);
  el('btn-guest',           'click',   loginAsGuest);
}

/* =====================================================
   INIT — Lobby UI
===================================================== */
function initLobbyUI() {
  el('btn-logout',  'click', () => fbAuth.signOut());
  el('btn-history', 'click', openHistory);
  el('btn-create',  'click', createGame);
  el('btn-join',    'click', joinGame);
  el('input-room',  'keydown', e => { if (e.key === 'Enter') joinGame(); });
  el('btn-spectate',    'click',   spectateGame);
  el('input-spectate',  'keydown', e => { if (e.key === 'Enter') spectateGame(); });
  el('btn-start-ai',    'click',   startAIGame);

  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      gameMode = btn.dataset.mode;
      const mp = document.getElementById('panel-multiplayer');
      const pa = document.getElementById('panel-ai');
      if (mp) mp.classList.toggle('hidden', gameMode !== 'multiplayer');
      if (pa) pa.classList.toggle('hidden', gameMode !== 'ai');
    });
  });

  document.querySelectorAll('.color-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedPlayerColor = btn.dataset.color;
    });
  });

  document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedDiff = btn.dataset.level;
    });
  });
}

/* =====================================================
   INIT — Game UI
===================================================== */
function initGameUI() {
  el('btn-cancel',    'click', cancelGame);
  el('btn-copy',      'click', copyRoomCode);
  el('btn-resign',    'click', resign);
  el('btn-new-game',  'click', goLobby);
  el('btn-back-lobby','click', () => { if (specRef) { specRef.off(); specRef = null; } goLobby(); });

  el('btn-gameover-new', 'click', () => {
    hideModal('modal-gameover');
    if (gameMode === 'ai') startAIGame(); else goLobby();
  });
  el('btn-gameover-history', 'click', () => { hideModal('modal-gameover'); openHistory(); });
  el('btn-gameover-lobby',   'click', () => { hideModal('modal-gameover'); goLobby(); });
}

/* =====================================================
   INIT — History UI
===================================================== */
function initHistoryUI() {
  el('btn-history-back', 'click', goLobby);
}

/* =====================================================
   INIT — Replay UI
===================================================== */
function initReplayUI() {
  el('btn-replay-back', 'click',  openHistory);
  el('replay-first',    'click',  () => replayGoTo(0));
  el('replay-prev',     'click',  () => replayGoTo(replayIndex - 1));
  el('replay-next',     'click',  () => replayGoTo(replayIndex + 1));
  el('replay-last',     'click',  () => replayGoTo(replayMoves.length));
  el('replay-play',     'click',  toggleReplayAuto);
  el('replay-slider',   'input',  e => replayGoTo(parseInt(e.target.value)));
}

/* =====================================================
   NAVEGAÇÃO
===================================================== */
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById('screen-' + name);
  if (target) target.classList.add('active');
}
function showModal(id) { const e = document.getElementById(id); if (e) e.classList.remove('hidden'); }
function hideModal(id) { const e = document.getElementById(id); if (e) e.classList.add('hidden'); }

function goLobby() {
  gameActive  = false;
  aiThinking  = false;
  isSpectator = false;
  if (roomRef) { roomRef.off(); roomRef = null; }
  if (specRef) { specRef.off(); specRef = null; }
  engine.reset();
  selectedSq = null; legalMovesCache = [];
  const ir = document.getElementById('input-room');
  const is = document.getElementById('input-spectate');
  if (ir) ir.value = '';
  if (is) is.value = '';
  clearLobbyError();
  showScreen('lobby');
}

function showLobbyError(msg) { const e = document.getElementById('lobby-error'); if (e) e.textContent = msg; }
function clearLobbyError()   { const e = document.getElementById('lobby-error'); if (e) e.textContent = ''; }

/* =====================================================
   SALVAR JOGO NO HISTÓRICO
===================================================== */
async function saveGame(result) {
  if (!currentUser || currentUser.isAnonymous) return null;

  const record = {
    uid:          currentUser.uid,
    playerName:   currentUser.displayName || 'Jogador',
    opponentName: opponentNameGlobal,
    myColor,
    mode:         gameMode,
    difficulty:   gameMode === 'ai' ? selectedDiff : null,
    result,
    moves:        engine.history.join('|'),
    totalMoves:   engine.history.length,
    roomCode:     roomCode || null,
    playedAt:     Date.now()
  };

  try {
    const ref = await db.ref('games').push(record);
    await db.ref(`users/${currentUser.uid}/games/${ref.key}`).set({
      result,
      mode:         gameMode,
      playedAt:     record.playedAt,
      totalMoves:   record.totalMoves,
      opponentName: opponentNameGlobal,
      difficulty:   record.difficulty
    });
    return ref.key;
  } catch (e) {
    console.warn('Erro ao salvar jogo:', e);
    return null;
  }
}

/* =====================================================
   HISTÓRICO
===================================================== */
async function openHistory() {
  showScreen('history');
  const listEl  = document.getElementById('history-list');
  const statsEl = document.getElementById('history-stats');
  if (listEl)  listEl.innerHTML  = '<div class="history-loading">Carregando...</div>';
  if (statsEl) statsEl.innerHTML = '';

  if (!currentUser || currentUser.isAnonymous) {
    if (listEl) listEl.innerHTML = '<div class="history-empty">Faça login para ver seu histórico.</div>';
    return;
  }

  try {
    const snap = await db.ref(`users/${currentUser.uid}/games`)
      .orderByChild('playedAt').limitToLast(50).once('value');

    const raw = snap.val();
    if (!raw) {
      if (listEl) listEl.innerHTML = '<div class="history-empty">Nenhuma partida ainda.<br>Jogue sua primeira partida!</div>';
      return;
    }

    const games = Object.entries(raw)
      .map(([id, g]) => ({ id, ...g }))
      .sort((a, b) => b.playedAt - a.playedAt);

    const wins   = games.filter(g => g.result === 'win').length;
    const losses = games.filter(g => ['loss','resigned'].includes(g.result)).length;
    const draws  = games.filter(g => g.result === 'draw').length;
    if (statsEl) statsEl.innerHTML = `
      <span class="stat stat-win">✓ ${wins}</span>
      <span class="stat stat-draw">= ${draws}</span>
      <span class="stat stat-loss">✗ ${losses}</span>
    `;

    if (listEl) listEl.innerHTML = '';
    games.forEach(game => {
      const card = document.createElement('div');
      card.className = 'history-card';

      const resClass = { win:'result-win', loss:'result-loss', draw:'result-draw', resigned:'result-loss' }[game.result] || '';
      const resText  = { win:'Vitória ✓', loss:'Derrota ✗', draw:'Empate =', resigned:'Resignou' }[game.result] || game.result;
      const modeText = game.mode === 'ai' ? `🤖 IA (${game.difficulty || ''})` : '👥 Multiplayer';
      const date = new Date(game.playedAt).toLocaleDateString('pt-BR', {
        day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit'
      });

      card.innerHTML = `
        <div class="history-card-left">
          <span class="history-result ${resClass}">${resText}</span>
          <span class="history-opponent">vs ${game.opponentName || 'Oponente'}</span>
        </div>
        <div class="history-card-center">
          <span class="history-mode">${modeText}</span>
          <span class="history-moves">${game.totalMoves || 0} lances</span>
        </div>
        <div class="history-card-right">
          <span class="history-date">${date}</span>
          <button class="btn btn-small btn-secondary">▶ Replay</button>
        </div>
      `;

      card.querySelector('button').addEventListener('click', () => loadReplay(game.id));
      if (listEl) listEl.appendChild(card);
    });

  } catch (e) {
    if (listEl) listEl.innerHTML = '<div class="history-empty">Erro ao carregar histórico.</div>';
    console.error(e);
  }
}

/* =====================================================
   REPLAY
===================================================== */
async function loadReplay(gameId) {
  showScreen('replay');
  try {
    const snap = await db.ref('games/' + gameId).once('value');
    replayGameData = snap.val();
    if (!replayGameData) { alert('Partida não encontrada.'); openHistory(); return; }

    const isWhite = replayGameData.myColor === 'w';
    const lbl = (id, txt) => { const e = document.getElementById(id); if (e) e.textContent = txt; };
    lbl('replay-label-bottom', isWhite ? `${replayGameData.playerName} (Brancas)` : `${replayGameData.playerName} (Pretas)`);
    lbl('replay-label-top',    isWhite ? `${replayGameData.opponentName} (Pretas)` : `${replayGameData.opponentName} (Brancas)`);
    lbl('replay-avatar-bottom', isWhite ? '♙' : '♟');
    lbl('replay-avatar-top',    isWhite ? '♟' : '♙');

    replayMoves  = replayGameData.moves ? replayGameData.moves.split('|').filter(Boolean) : [];
    replayIndex  = 0;
    replayEngine = new ChessEngine();

    const slider = document.getElementById('replay-slider');
    if (slider) { slider.max = replayMoves.length; slider.value = 0; }

    buildReplayBoard();
    replayRenderBoard();
    renderReplayHistory();
    updateReplayCounter();

    const resultMap = { win:'Vitória', loss:'Derrota', draw:'Empate', resigned:'Resignou' };
    lbl('replay-status', `Replay — ${resultMap[replayGameData.result] || ''} — ${replayMoves.length} lances`);

  } catch (e) {
    console.error(e);
    alert('Erro ao carregar replay.');
    openHistory();
  }
}

function buildReplayBoard() {
  const boardEl = document.getElementById('replay-chessboard');
  if (!boardEl) return;
  boardEl.innerHTML = '';
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const sq = document.createElement('div');
      sq.className = 'square';
      sq.dataset.row = row; sq.dataset.col = col;
      boardEl.appendChild(sq);
    }
  }
  ['replay-coords-file-top','replay-coords-file-bottom'].forEach(id => {
    const el = document.getElementById(id); if (!el) return;
    el.innerHTML = '';
    'abcdefgh'.split('').forEach(f => {
      const s = document.createElement('span');
      s.className = 'coord-label';
      s.style.width = 'calc(var(--board-size) / 8)';
      s.textContent = f; el.appendChild(s);
    });
  });
  ['replay-coords-rank-left','replay-coords-rank-right'].forEach(id => {
    const el = document.getElementById(id); if (!el) return;
    el.innerHTML = '';
    '87654321'.split('').forEach(r => {
      const s = document.createElement('span');
      s.className = 'coord-label';
      s.style.height = 'calc(var(--board-size) / 8)';
      s.textContent = r; el.appendChild(s);
    });
  });
}

function replayGoTo(targetIndex) {
  stopReplayAuto();
  targetIndex = Math.max(0, Math.min(replayMoves.length, targetIndex));
  replayEngine = new ChessEngine();
  let applied  = 0;
  for (let i = 0; i < targetIndex; i++) {
    if (applyMoveBySAN(replayEngine, replayMoves[i])) applied++;
  }
  replayIndex = applied;
  const slider = document.getElementById('replay-slider');
  if (slider) slider.value = replayIndex;
  updateReplayCounter();
  replayRenderBoard();
  renderReplayHistory();
}

function applyMoveBySAN(eng, san) {
  if (!san) return false;
  const color    = eng.turn;
  const sanClean = san.replace(/[+#!?]/g, '');
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (eng.board[r]?.[c]?.color !== color) continue;
      const legal = eng.legalMoves(r, c);
      for (const mv of legal) {
        for (const promo of ['Q','R','B','N']) {
          const clone = cloneEngine(eng);
          if (!clone.makeMove([r,c], mv.to, promo)) continue;
          const genSan = (clone.history[clone.history.length - 1] || '').replace(/[+#!?]/g, '');
          if (genSan === sanClean) { eng.makeMove([r,c], mv.to, promo); return true; }
        }
      }
    }
  }
  return false;
}

function cloneEngine(src) {
  const dst = new ChessEngine();
  dst.board     = src.board.map(row => row.map(p => p ? {...p} : null));
  dst.turn      = src.turn;
  dst.castling  = { ...src.castling };
  dst.enPassant = src.enPassant ? [...src.enPassant] : null;
  dst.history   = [...src.history];
  dst.captured  = { w: [...src.captured.w], b: [...src.captured.b] };
  dst.status    = src.status;
  dst.lastMove  = src.lastMove ? { from:[...src.lastMove.from], to:[...src.lastMove.to] } : null;
  return dst;
}

function replayRenderBoard() {
  const boardEl = document.getElementById('replay-chessboard');
  if (!boardEl) return;
  boardEl.querySelectorAll('.square').forEach(sq => {
    const vr = parseInt(sq.dataset.row);
    const vc = parseInt(sq.dataset.col);
    sq.className = 'square ' + ((vr + vc) % 2 === 0 ? 'light' : 'dark');
    sq.innerHTML = '';
    if (replayEngine.lastMove) {
      const [fr, fc] = replayEngine.lastMove.from;
      const [tr, tc] = replayEngine.lastMove.to;
      if ((vr===fr && vc===fc) || (vr===tr && vc===tc)) sq.classList.add('last-move');
    }
    const piece = replayEngine.piece(vr, vc);
    if (piece) {
      const span = document.createElement('span');
      span.className = 'piece ' + (piece.color === 'w' ? 'piece-white' : 'piece-black');
      span.textContent = SYMBOLS[piece.color + piece.type] || '?';
      sq.appendChild(span);
    }
  });
}

function renderReplayHistory() {
  const box = document.getElementById('replay-move-history');
  if (!box) return;
  box.innerHTML = '';
  for (let i = 0; i < replayMoves.length; i += 2) {
    const row = document.createElement('div');
    row.className = 'move-row';
    const num = document.createElement('span');
    num.className = 'move-num'; num.textContent = (Math.floor(i/2)+1) + '.';
    const w = document.createElement('span');
    w.className = 'move-san' + (replayIndex === i+1 ? ' move-active' : '');
    w.textContent = replayMoves[i] || ''; w.style.cursor = 'pointer';
    w.addEventListener('click', () => replayGoTo(i+1));
    const b = document.createElement('span');
    b.className = 'move-san' + (replayIndex === i+2 ? ' move-active' : '');
    b.textContent = replayMoves[i+1] || '';
    if (replayMoves[i+1]) { b.style.cursor = 'pointer'; b.addEventListener('click', () => replayGoTo(i+2)); }
    row.appendChild(num); row.appendChild(w); row.appendChild(b);
    box.appendChild(row);
  }
  const active = box.querySelector('.move-active');
  if (active) active.scrollIntoView({ block:'nearest', behavior:'smooth' });
}

function updateReplayCounter() {
  const el = document.getElementById('replay-move-counter');
  if (el) el.textContent = `Lance ${replayIndex} de ${replayMoves.length}`;
}

function toggleReplayAuto() {
  if (replayInterval) {
    stopReplayAuto();
  } else {
    const btn = document.getElementById('replay-play');
    if (btn) btn.textContent = '⏸ Pausar';
    replayInterval = setInterval(() => {
      if (replayIndex >= replayMoves.length) { stopReplayAuto(); return; }
      replayGoTo(replayIndex + 1);
    }, 900);
  }
}

function stopReplayAuto() {
  if (replayInterval) { clearInterval(replayInterval); replayInterval = null; }
  const btn = document.getElementById('replay-play');
  if (btn) btn.textContent = '▶ Play';
}

/* =====================================================
   ESPECTADOR
===================================================== */
async function spectateGame() {
  const input = document.getElementById('input-spectate');
  const code  = input ? input.value.trim().toUpperCase() : '';
  clearLobbyError();
  if (code.length !== 6) { showLobbyError('Código deve ter 6 caracteres.'); return; }

  try {
    const snap = await db.ref('rooms/' + code).once('value');
    const data = snap.val();
    if (!data)                    { showLobbyError('Sala não encontrada.'); return; }
    if (data.status === 'waiting') { showLobbyError('Partida ainda não começou.'); return; }
    if (['finished','resigned'].includes(data.status)) { showLobbyError('Partida já encerrou.'); return; }

    isSpectator = true; roomCode = code; myColor = 'w';
    engine.deserialize(data.state);

    const lbl = (id, txt) => { const e = document.getElementById(id); if (e) e.textContent = txt; };
    lbl('label-top',     data.blackName || 'Pretas');
    lbl('label-bottom',  data.whiteName || 'Brancas');
    lbl('avatar-top',    '♟');
    lbl('avatar-bottom', '♙');

    buildBoard(); renderGame(); showScreen('game');

    const hide = id => { const e = document.getElementById(id); if (e) e.classList.add('hidden'); };
    const show = id => { const e = document.getElementById(id); if (e) e.classList.remove('hidden'); };
    hide('btn-resign'); hide('btn-new-game');
    show('btn-back-lobby'); show('spectator-bar');
    lbl('status-bar', `👁 Assistindo — sala ${code}`);

    specRef = db.ref('rooms/' + code);
    specRef.on('value', snap => {
      const d = snap.val(); if (!d) return;
      engine.deserialize(d.state); renderGame();
      const turn = d.state?.turn === 'w' ? 'Brancas' : 'Pretas';
      lbl('status-bar', `👁 ${turn} jogam — sala ${code}`);
      if (['finished','resigned','abandoned'].includes(d.status)) {
        lbl('status-bar', '👁 Partida encerrada'); specRef.off();
      }
    });
  } catch (e) { showLobbyError('Erro ao conectar: ' + e.message); }
}

/* =====================================================
   CRIAR PARTIDA
===================================================== */
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function createGame() {
  const btn = document.getElementById('btn-create');
  if (btn) { btn.disabled = true; btn.textContent = 'Criando...'; }
  clearLobbyError();
  try {
    roomCode = generateRoomCode(); myColor = 'w'; engine.reset();
    roomRef  = db.ref('rooms/' + roomCode);
    const myName = currentUser?.displayName || currentUser?.email?.split('@')[0] || 'Jogador';

    await roomRef.set({
      white: myId, whiteName: myName, black: null, blackName: null,
      state: engine.serialize(), createdAt: Date.now(), status: 'waiting'
    });

    setTimeout(() => {
      if (!roomRef) return;
      roomRef.once('value', snap => { if (snap.val()?.status === 'waiting') { roomRef.remove(); goLobby(); } });
    }, 600000);

    const drc = document.getElementById('display-room-code');
    if (drc) drc.textContent = roomCode;
    showScreen('waiting');

    roomRef.on('value', snap => {
      const data = snap.val(); if (!data) return;
      if (data.black && data.status === 'playing') {
        roomRef.off();
        opponentNameGlobal = data.blackName || 'Oponente';
        startMultiplayerGame(myName, opponentNameGlobal);
      }
    });
  } catch (e) { showLobbyError('Erro ao criar sala: ' + e.message); }
  finally { if (btn) { btn.disabled = false; btn.textContent = 'Criar Partida'; } }
}

/* =====================================================
   ENTRAR NA PARTIDA
===================================================== */
async function joinGame() {
  const input = document.getElementById('input-room');
  const code  = input ? input.value.trim().toUpperCase() : '';
  clearLobbyError();
  if (code.length !== 6) { showLobbyError('Código deve ter 6 caracteres.'); return; }

  const btn = document.getElementById('btn-join');
  if (btn) { btn.disabled = true; btn.textContent = 'Entrando...'; }

  try {
    roomRef = db.ref('rooms/' + code);
    const snap = await roomRef.once('value');
    const data = snap.val();
    if (!data)                                          { showLobbyError('Sala não encontrada.');  roomRef=null; return; }
    if (data.black)                                     { showLobbyError('Sala já está cheia.');   roomRef=null; return; }
    if (['finished','resigned'].includes(data.status)) { showLobbyError('Partida já encerrada.'); roomRef=null; return; }

    roomCode = code; myColor = 'b'; engine.deserialize(data.state);
    const myName = currentUser?.displayName || currentUser?.email?.split('@')[0] || 'Jogador';
    await roomRef.update({ black: myId, blackName: myName, status: 'playing' });

    opponentNameGlobal = data.whiteName || 'Oponente';
    startMultiplayerGame(myName, opponentNameGlobal);
  } catch (e) { showLobbyError('Erro ao entrar: ' + e.message); roomRef = null; }
  finally { if (btn) { btn.disabled = false; btn.textContent = 'Entrar'; } }
}

async function cancelGame() {
  if (roomRef) { await roomRef.remove().catch(()=>{}); roomRef.off(); roomRef = null; }
  goLobby();
}

function copyRoomCode() {
  navigator.clipboard.writeText(roomCode).then(() => {
    const fb = document.getElementById('copy-feedback');
    if (fb) { fb.textContent = 'Copiado!'; setTimeout(() => { fb.textContent = ''; }, 2000); }
  });
}

/* =====================================================
   INICIAR MULTIPLAYER
===================================================== */
function startMultiplayerGame(myName, oppName) {
  gameMode = 'multiplayer'; gameActive = true; isSpectator = false;
  selectedSq = null; legalMovesCache = [];

  const lbl = (id, txt) => { const e = document.getElementById(id); if (e) e.textContent = txt; };
  lbl('avatar-bottom', myColor === 'w' ? '♙' : '♟');
  lbl('avatar-top',    myColor === 'w' ? '♟' : '♙');
  lbl('label-bottom',  `${myName} (${myColor === 'w' ? 'Brancas' : 'Pretas'})`);
  lbl('label-top',     `${oppName} (${myColor === 'w' ? 'Pretas' : 'Brancas'})`);

  buildBoard(); renderGame(); showScreen('game');

  const show = id => { const e = document.getElementById(id); if (e) e.classList.remove('hidden'); };
  const hide = id => { const e = document.getElementById(id); if (e) e.classList.add('hidden'); };
  show('btn-resign'); hide('btn-new-game'); hide('btn-back-lobby'); hide('spectator-bar');

  roomRef.on('value', snap => {
    const data = snap.val(); if (!data) return;

    if (data.status === 'resigned' && data.winner !== myColor) {
      engine.deserialize(data.state); renderGame(); gameActive = false;
      saveGame('win'); showGameOver('Vitória! 🏆', 'O oponente resignou.'); return;
    }
    if (data.status === 'abandoned') {
      gameActive = false; saveGame('win'); showGameOver('Vitória! 🏆', 'O oponente abandonou.'); return;
    }
    if (data.state && data.state.turn === myColor) {
      engine.deserialize(data.state); renderGame();
      if (engine.status === 'checkmate') {
        gameActive = false; saveGame('loss');
        showGameOver('Xeque-mate!', 'Você perdeu. Tente novamente!');
      } else if (engine.status === 'stalemate') {
        gameActive = false; saveGame('draw');
        showGameOver('Empate!', 'Afogamento.');
      }
    }
  });
}

/* =====================================================
   MODO VS IA
===================================================== */
function startAIGame() {
  gameMode = 'ai';
  let playerColor = selectedPlayerColor;
  if (playerColor === 'random') playerColor = Math.random() < 0.5 ? 'w' : 'b';
  myColor = playerColor; aiColor = playerColor === 'w' ? 'b' : 'w';

  ai.setDifficulty(selectedDiff);
  engine.reset();
  gameActive = true; isSpectator = false;
  selectedSq = null; legalMovesCache = [];
  opponentNameGlobal = `IA (${selectedDiff})`;

  const diffLabels = { iniciante:'Iniciante', intermediario:'Intermediário', avancado:'Avançado', expert:'Expert' };
  const lbl = (id, txt) => { const e = document.getElementById(id); if (e) e.textContent = txt; };
  lbl('avatar-bottom', myColor === 'w' ? '♙' : '♟');
  lbl('avatar-top',    '🤖');
  lbl('label-bottom',  `Você (${myColor === 'w' ? 'Brancas' : 'Pretas'})`);
  lbl('label-top',     `IA — ${diffLabels[selectedDiff]}`);

  buildBoard(); renderGame(); showScreen('game');

  const show = id => { const e = document.getElementById(id); if (e) e.classList.remove('hidden'); };
  const hide = id => { const e = document.getElementById(id); if (e) e.classList.add('hidden'); };
  show('btn-resign'); hide('btn-new-game'); hide('btn-back-lobby'); hide('spectator-bar');

  if (engine.turn === aiColor) scheduleAIMove();
}

function scheduleAIMove() {
  if (!gameActive || engine.turn !== aiColor) return;
  aiThinking = true; updateStatusBar();
  const delay = selectedDiff === 'expert' ? 900 : 450;
  setTimeout(() => {
    if (!gameActive) return;
    const move = ai.getBestMove(engine);
    aiThinking = false;
    if (move) {
      engine.makeMove(move.from, move.to, move.promoteTo || 'Q');
      selectedSq = null; legalMovesCache = []; renderGame();
      if (engine.status === 'checkmate') {
        gameActive = false; saveGame('loss'); showGameOver('Xeque-mate!', 'A IA venceu. Tente novamente!');
      } else if (engine.status === 'stalemate') {
        gameActive = false; saveGame('draw'); showGameOver('Empate!', 'Afogamento.');
      }
    }
  }, delay);
}

/* =====================================================
   TABULEIRO
===================================================== */
function buildBoard() {
  const boardEl = document.getElementById('chessboard');
  if (!boardEl) return;
  boardEl.innerHTML = '';

  const files = myColor === 'w' ? ['a','b','c','d','e','f','g','h'] : ['h','g','f','e','d','c','b','a'];
  const ranks = myColor === 'w' ? ['8','7','6','5','4','3','2','1'] : ['1','2','3','4','5','6','7','8'];

  ['coords-file-top','coords-file-bottom'].forEach(id => {
    const el = document.getElementById(id); if (!el) return;
    el.innerHTML = '';
    files.forEach(f => {
      const s = document.createElement('span');
      s.className = 'coord-label'; s.style.width = 'calc(var(--board-size) / 8)';
      s.textContent = f; el.appendChild(s);
    });
  });

  ['coords-rank-left','coords-rank-right'].forEach(id => {
    const el = document.getElementById(id); if (!el) return;
    el.innerHTML = '';
    ranks.forEach(r => {
      const s = document.createElement('span');
      s.className = 'coord-label'; s.style.height = 'calc(var(--board-size) / 8)';
      s.textContent = r; el.appendChild(s);
    });
  });

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const sq = document.createElement('div');
      sq.className = 'square'; sq.dataset.row = row; sq.dataset.col = col;
      if (!isSpectator) sq.addEventListener('click', onSquareClick);
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
  document.querySelectorAll('#chessboard .square').forEach(sq => {
    const vr = parseInt(sq.dataset.row);
    const vc = parseInt(sq.dataset.col);
    const [lr, lc] = viewToLogic(vr, vc);
    sq.className = 'square ' + ((vr + vc) % 2 === 0 ? 'light' : 'dark');
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
    const sel = document.querySelector(`#chessboard [data-row="${svr}"][data-col="${svc}"]`);
    if (sel) sel.classList.add('selected');
    legalMovesCache.forEach(m => {
      const [mvr, mvc] = logicToView(m.to[0], m.to[1]);
      const el = document.querySelector(`#chessboard [data-row="${mvr}"][data-col="${mvc}"]`);
      if (el) el.classList.add(engine.piece(m.to[0], m.to[1]) || m.enPassant ? 'capture-hint' : 'move-hint');
    });
  }

  updateStatusBar(); updateMoveHistory(); updateCaptured(); updateTurnCards();
}

/* =====================================================
   CLIQUE
===================================================== */
function onSquareClick(e) {
  const sq = e.currentTarget;
  const vr = parseInt(sq.dataset.row);
  const vc = parseInt(sq.dataset.col);
  const [lr, lc] = viewToLogic(vr, vc);

  if (!gameActive || isSpectator || aiThinking) return;
  if (engine.turn !== myColor) return;
  if (['checkmate','stalemate'].includes(engine.status)) return;

  const piece = engine.piece(lr, lc);

  if (selectedSq !== null) {
    const [slr, slc] = selectedSq;
    const move = legalMovesCache.find(m => m.to[0]===lr && m.to[1]===lc);
    if (move) {
      if (engine.board[slr][slc]?.type==='P' && (lr===0 || lr===7)) {
        pendingPromotion = { from:[slr,slc], to:[lr,lc] }; showPromotion(); return;
      }
      doMove([slr,slc], [lr,lc]); return;
    }
    if (piece && piece.color === myColor) {
      selectedSq = [lr,lc]; legalMovesCache = engine.legalMoves(lr,lc); renderGame(); return;
    }
    selectedSq = null; legalMovesCache = []; renderGame(); return;
  }

  if (piece && piece.color === myColor) {
    selectedSq = [lr,lc]; legalMovesCache = engine.legalMoves(lr,lc); renderGame();
  }
}

/* =====================================================
   EXECUTAR MOVIMENTO
===================================================== */
async function doMove(from, to, promoteTo = 'Q') {
  if (!engine.makeMove(from, to, promoteTo)) return;
  selectedSq = null; legalMovesCache = []; renderGame();

  if (gameMode === 'multiplayer' && roomRef) {
    try { await roomRef.update({ state: engine.serialize() }); }
    catch (e) { console.error('Erro ao salvar movimento:', e); }
  }

  if (engine.status === 'checkmate') {
    if (gameMode === 'multiplayer' && roomRef)
      await roomRef.update({ status:'finished', winner:myColor }).catch(()=>{});
    gameActive = false; saveGame('win');
    showGameOver('Xeque-mate! 🏆', 'Você venceu! Parabéns!'); return;
  }
  if (engine.status === 'stalemate') {
    if (gameMode === 'multiplayer' && roomRef)
      await roomRef.update({ status:'finished', winner:null }).catch(()=>{});
    gameActive = false; saveGame('draw');
    showGameOver('Empate!', 'Afogamento — nenhum movimento legal.'); return;
  }

  if (gameMode === 'ai' && engine.turn === aiColor) scheduleAIMove();
}

/* =====================================================
   PROMOÇÃO
===================================================== */
function showPromotion() {
  const choices = document.getElementById('promotion-choices');
  if (!choices) return;
  choices.innerHTML = '';
  ['Q','R','B','N'].forEach(type => {
    const btn = document.createElement('button');
    btn.className = 'promotion-choice';
    btn.textContent = SYMBOLS[myColor + type];
    btn.addEventListener('click', () => {
      hideModal('modal-promotion');
      const { from, to } = pendingPromotion;
      pendingPromotion = null; selectedSq = null; legalMovesCache = [];
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
  if (!bar) return;
  bar.className = 'status-bar';

  if (isSpectator) { bar.textContent = `👁 Assistindo — ${engine.turn === 'w' ? 'Brancas' : 'Pretas'} jogam`; return; }
  if (aiThinking)  { bar.innerHTML = 'IA pensando <span class="thinking-dots"><span></span><span></span><span></span></span>'; return; }

  const isMyTurn = engine.turn === myColor;
  const msgs = {
    playing:   isMyTurn ? 'Sua vez' : (gameMode==='ai' ? 'IA pensando...' : 'Vez do oponente'),
    check:     isMyTurn ? '⚠ Xeque! Defenda seu rei' : 'Oponente está em xeque',
    checkmate: 'Xeque-mate!',
    stalemate: 'Afogamento!'
  };
  bar.textContent = msgs[engine.status] || '';
  if (engine.status==='check'   && isMyTurn) bar.classList.add('check');
  if (engine.status==='playing' && isMyTurn) bar.classList.add('your-turn');
}

/* =====================================================
   HISTÓRICO DE MOVIMENTOS (em jogo)
===================================================== */
function updateMoveHistory() {
  const box = document.getElementById('move-history');
  if (!box) return;
  box.innerHTML = '';
  for (let i = 0; i < engine.history.length; i += 2) {
    const row = document.createElement('div');
    row.className = 'move-row';
    const num = document.createElement('span'); num.className = 'move-num'; num.textContent = (Math.floor(i/2)+1) + '.';
    const w = document.createElement('span'); w.className = 'move-san'; w.textContent = engine.history[i] || '';
    const b = document.createElement('span'); b.className = 'move-san'; b.textContent = engine.history[i+1] || '';
    row.appendChild(num); row.appendChild(w); row.appendChild(b);
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
    const el = document.getElementById(elId); if (!el) return;
    const pieces = [...engine.captured[capturedColor]].sort((a,b)=>(order[b]||0)-(order[a]||0));
    el.innerHTML = ''; if (!pieces.length) return;
    const myScore  = pieces.reduce((s,t) => s+(order[t]||0), 0);
    const oppScore = engine.captured[capturedColor==='w'?'b':'w'].reduce((s,t)=>s+(order[t]||0),0);
    const adv = myScore - oppScore;
    pieces.forEach(type => {
      const span = document.createElement('span');
      span.className = 'cap-piece ' + (capturedColor==='w' ? 'cap-black' : 'cap-white');
      span.textContent = SYMBOLS[capturedColor + type];
      el.appendChild(span);
    });
    if (adv > 0) {
      const s = document.createElement('span');
      s.className = 'advantage-score'; s.textContent = '+' + adv;
      el.appendChild(s);
    }
  };
  if (myColor === 'w') { render('b','captured-bottom'); render('w','captured-top'); }
  else                  { render('w','captured-bottom'); render('b','captured-top'); }
}

/* =====================================================
   CARDS DE TURNO
===================================================== */
function updateTurnCards() {
  const isMyTurn = engine.turn === myColor;
  const cb = document.getElementById('card-bottom');
  const ct = document.getElementById('card-top');
  if (cb) cb.classList.toggle('active-turn',  isMyTurn);
  if (ct) ct.classList.toggle('active-turn', !isMyTurn);
}

/* =====================================================
   RESIGNAR
===================================================== */
async function resign() {
  if (!gameActive || isSpectator) return;
  if (!confirm('Tem certeza que deseja resignar?')) return;
  gameActive = false;
  if (gameMode === 'multiplayer' && roomRef) {
    const enemy = myColor === 'w' ? 'b' : 'w';
    await roomRef.update({ status:'resigned', winner:enemy, state:engine.serialize() }).catch(()=>{});
  }
  saveGame('resigned');
  showGameOver('Você resignou', gameMode==='ai' ? 'A IA venceu.' : 'O oponente venceu.');
}

/* =====================================================
   GAME OVER
===================================================== */
function showGameOver(title, msg) {
  const t = document.getElementById('gameover-title');
  const m = document.getElementById('gameover-msg');
  const i = document.getElementById('gameover-icon');
  if (t) t.textContent = title;
  if (m) m.textContent = msg;
  if (i) i.textContent = title.includes('🏆') ? '🏆' : title.includes('Empate') ? '🤝' : title.includes('resignou') ? '🏳' : '♟';

  const hide = id => { const e = document.getElementById(id); if (e) e.classList.add('hidden'); };
  const show = id => { const e = document.getElementById(id); if (e) e.classList.remove('hidden'); };
  hide('btn-resign'); show('btn-new-game');
  setTimeout(() => showModal('modal-gameover'), 700);
}