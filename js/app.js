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
let engine              = new ChessEngine();
let ai                  = new ChessAI();
let myColor             = null;
let myId                = 'guest_' + Math.random().toString(36).slice(2, 8);
let roomCode            = null;
let roomRef             = null;
let specRef             = null;
let selectedSq          = null;
let legalMovesCache     = [];
let pendingPromotion    = null;
let gameActive          = false;
let gameMode            = 'multiplayer';
let aiColor             = 'b';
let aiThinking          = false;
let selectedDiff        = 'intermediario';
let selectedPlayerColor = 'w';
let isSpectator         = false;
let opponentNameGlobal  = 'Oponente';

/* replay */
let replayMoves    = [];
let replayTarget   = 0;
let replayEngine   = null;
let replayInterval = null;
let replayGameData = null;

/* =====================================================
   HELPER
===================================================== */
function el(id, event, handler) {
  var element = document.getElementById(id);
  if (element) element.addEventListener(event, handler);
  else console.warn('#' + id + ' nao encontrado');
}

/* =====================================================
   BOOT
===================================================== */
window.addEventListener('DOMContentLoaded', function() {
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    db     = firebase.database();
    fbAuth = firebase.auth();
  } catch (e) { console.error('Firebase init error:', e); return; }

  initAuthUI();
  initLobbyUI();
  initGameUI();
  initHistoryUI();
  initReplayUI();

  fbAuth.onAuthStateChanged(function(user) {
    currentUser = user;
    if (user) {
      myId = user.uid;
      var name     = user.displayName || (user.email ? user.email.split('@')[0] : '') || 'Jogador';
      var photoURL = user.photoURL || null;

      var headerName = document.getElementById('header-username');
      if (headerName) headerName.textContent = name;

      var headerPhoto    = document.getElementById('header-photo');
      var headerInitials = document.getElementById('header-initials');
      if (photoURL && headerPhoto && headerInitials) {
        headerPhoto.src = photoURL;
        headerPhoto.classList.remove('hidden');
        headerInitials.style.display = 'none';
      } else if (headerInitials) {
        headerInitials.style.display = 'flex';
        headerInitials.textContent = name.split(' ').slice(0,2)
          .map(function(w) { return w[0] ? w[0].toUpperCase() : ''; }).join('') || '?';
      }

      db.ref('users/' + user.uid).update({
        displayName: name, email: user.email || '',
        photoURL: photoURL || '', lastSeen: Date.now()
      });
      window._myPhotoURL = photoURL;
      showScreen('lobby');
    } else {
      var hp = document.getElementById('header-photo');
      var hi = document.getElementById('header-initials');
      if (hp) { hp.src = ''; hp.classList.add('hidden'); }
      if (hi) { hi.style.display = 'flex'; hi.textContent = '?'; }
      window._myPhotoURL = null;
      showScreen('auth');
    }
  });
});

/* =====================================================
   AUTH
===================================================== */
async function loginWithEmail() {
  var email = document.getElementById('login-email').value.trim();
  var pass  = document.getElementById('login-password').value;
  if (!email || !pass) { showAuthError('Preencha e-mail e senha.'); return; }
  try { await fbAuth.signInWithEmailAndPassword(email, pass); }
  catch (e) { showAuthError(authErrorMsg(e.code)); }
}

async function loginWithGoogle() {
  try { await fbAuth.signInWithPopup(new firebase.auth.GoogleAuthProvider()); }
  catch (e) { if (e.code !== 'auth/popup-closed-by-user') showAuthError(authErrorMsg(e.code)); }
}

async function registerWithEmail() {
  var name  = document.getElementById('reg-name').value.trim();
  var email = document.getElementById('reg-email').value.trim();
  var pass  = document.getElementById('reg-password').value;
  if (!name)           { showAuthError('Informe seu nome.'); return; }
  if (!email)          { showAuthError('Informe seu e-mail.'); return; }
  if (pass.length < 6) { showAuthError('Senha minima de 6 caracteres.'); return; }
  try {
    var cred = await fbAuth.createUserWithEmailAndPassword(email, pass);
    await cred.user.updateProfile({ displayName: name });
    await cred.user.reload();
  } catch (e) { showAuthError(authErrorMsg(e.code)); }
}

async function loginAsGuest() {
  try {
    var cred = await fbAuth.signInAnonymously();
    await cred.user.updateProfile({ displayName: 'Visitante' });
  } catch (e) { showAuthError('Erro ao entrar como visitante.'); }
}

function authErrorMsg(code) {
  var msgs = {
    'auth/user-not-found':       'Usuario nao encontrado.',
    'auth/wrong-password':       'Senha incorreta.',
    'auth/email-already-in-use': 'E-mail ja cadastrado.',
    'auth/invalid-email':        'E-mail invalido.',
    'auth/weak-password':        'Senha muito fraca.',
    'auth/too-many-requests':    'Muitas tentativas. Tente mais tarde.'
  };
  return msgs[code] || 'Erro ao autenticar.';
}

function showAuthError(msg) { var e = document.getElementById('auth-error'); if (e) e.textContent = msg; }
function clearAuthError()   { var e = document.getElementById('auth-error'); if (e) e.textContent = ''; }

/* =====================================================
   INIT — Auth UI
===================================================== */
function initAuthUI() {
  document.querySelectorAll('.auth-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      document.querySelectorAll('.auth-tab').forEach(function(t) { t.classList.remove('active'); });
      tab.classList.add('active');
      var target = tab.dataset.tab;
      var tl = document.getElementById('tab-login');
      var tr = document.getElementById('tab-register');
      if (tl) tl.classList.toggle('hidden', target !== 'login');
      if (tr) tr.classList.toggle('hidden', target !== 'register');
      clearAuthError();
    });
  });
  el('btn-login-email',     'click',   loginWithEmail);
  el('login-password',      'keydown', function(e) { if (e.key === 'Enter') loginWithEmail(); });
  el('btn-login-google',    'click',   loginWithGoogle);
  el('btn-register',        'click',   registerWithEmail);
  el('btn-register-google', 'click',   loginWithGoogle);
  el('btn-guest',           'click',   loginAsGuest);
}

/* =====================================================
   INIT — Lobby UI
===================================================== */
function initLobbyUI() {
  el('btn-logout',     'click', function() { fbAuth.signOut(); });
  el('btn-history',    'click', openHistory);
  el('btn-create',     'click', createGame);
  el('btn-join',       'click', joinGame);
  el('input-room',     'keydown', function(e) { if (e.key === 'Enter') joinGame(); });
  el('btn-spectate',   'click', spectateGame);
  el('input-spectate', 'keydown', function(e) { if (e.key === 'Enter') spectateGame(); });
  el('btn-start-ai',   'click', startAIGame);

  document.querySelectorAll('.mode-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.mode-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      gameMode = btn.dataset.mode;
      var mp = document.getElementById('panel-multiplayer');
      var pa = document.getElementById('panel-ai');
      if (mp) mp.classList.toggle('hidden', gameMode !== 'multiplayer');
      if (pa) pa.classList.toggle('hidden', gameMode !== 'ai');
    });
  });

  document.querySelectorAll('.color-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.color-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      selectedPlayerColor = btn.dataset.color;
    });
  });

  document.querySelectorAll('.diff-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.diff-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      selectedDiff = btn.dataset.level;
    });
  });
}

/* =====================================================
   INIT — Game UI
===================================================== */
function initGameUI() {
  el('btn-cancel',     'click', cancelGame);
  el('btn-copy',       'click', copyRoomCode);
  el('btn-resign',     'click', resign);
  el('btn-new-game',   'click', goLobby);
  el('btn-back-lobby', 'click', function() { if (specRef) { specRef.off(); specRef = null; } goLobby(); });
  el('btn-gameover-new',     'click', function() { hideModal('modal-gameover'); if (gameMode === 'ai') startAIGame(); else goLobby(); });
  el('btn-gameover-history', 'click', function() { hideModal('modal-gameover'); openHistory(); });
  el('btn-gameover-lobby',   'click', function() { hideModal('modal-gameover'); goLobby(); });
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
  el('btn-replay-back', 'click', openHistory);
  el('replay-first',    'click', function() { replayGoTo(0); });
  el('replay-prev',     'click', function() { replayGoTo(replayTarget - 1); });
  el('replay-next',     'click', function() { replayGoTo(replayTarget + 1); });
  el('replay-last',     'click', function() { replayGoTo(replayMoves.length); });
  el('replay-play',     'click', toggleReplayAuto);
  el('replay-slider',   'input', function(e) { replayGoTo(parseInt(e.target.value)); });
}

/* =====================================================
   NAVEGACAO
===================================================== */
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(function(s) { s.classList.remove('active'); });
  var t = document.getElementById('screen-' + name);
  if (t) t.classList.add('active');
}
function showModal(id) { var e = document.getElementById(id); if (e) e.classList.remove('hidden'); }
function hideModal(id) { var e = document.getElementById(id); if (e) e.classList.add('hidden'); }

function goLobby() {
  gameActive = false; aiThinking = false; isSpectator = false;
  if (roomRef) { roomRef.off(); roomRef = null; }
  if (specRef) { specRef.off(); specRef = null; }
  engine.reset();
  selectedSq = null; legalMovesCache = [];
  var ir = document.getElementById('input-room');
  var is = document.getElementById('input-spectate');
  if (ir) ir.value = '';
  if (is) is.value = '';
  clearLobbyError();
  showScreen('lobby');
}

function showLobbyError(msg) { var e = document.getElementById('lobby-error'); if (e) e.textContent = msg; }
function clearLobbyError()   { var e = document.getElementById('lobby-error'); if (e) e.textContent = ''; }

/* =====================================================
   SALVAR JOGO
===================================================== */
async function saveGame(result) {
  if (!currentUser || currentUser.isAnonymous) return null;
  var record = {
    uid:          currentUser.uid,
    playerName:   currentUser.displayName || 'Jogador',
    opponentName: opponentNameGlobal,
    myColor:      myColor,
    mode:         gameMode,
    difficulty:   gameMode === 'ai' ? selectedDiff : null,
    result:       result,
    moves:        engine.history.join('|'),
    totalMoves:   engine.history.length,
    roomCode:     roomCode || null,
    playedAt:     Date.now()
  };
  try {
    var ref = await db.ref('games').push(record);
    await db.ref('users/' + currentUser.uid + '/games/' + ref.key).set({
      result: result, mode: gameMode, playedAt: record.playedAt,
      totalMoves: record.totalMoves, opponentName: opponentNameGlobal,
      difficulty: record.difficulty
    });
    return ref.key;
  } catch (e) { console.warn('Erro ao salvar jogo:', e); return null; }
}

/* =====================================================
   HISTORICO
===================================================== */
async function openHistory() {
  showScreen('history');
  var listEl  = document.getElementById('history-list');
  var statsEl = document.getElementById('history-stats');
  if (listEl)  listEl.innerHTML  = '<div class="history-loading">Carregando...</div>';
  if (statsEl) statsEl.innerHTML = '';

  if (!currentUser || currentUser.isAnonymous) {
    if (listEl) listEl.innerHTML = '<div class="history-empty">Faca login para ver seu historico.</div>';
    return;
  }

  try {
    var snap = await db.ref('users/' + currentUser.uid + '/games')
      .orderByChild('playedAt').limitToLast(50).once('value');
    var raw = snap.val();
    if (!raw) {
      if (listEl) listEl.innerHTML = '<div class="history-empty">Nenhuma partida ainda.<br>Jogue sua primeira partida!</div>';
      return;
    }

    var games = Object.entries(raw)
      .map(function(entry) { return Object.assign({ id: entry[0] }, entry[1]); })
      .sort(function(a, b) { return b.playedAt - a.playedAt; });

    var wins   = games.filter(function(g) { return g.result === 'win'; }).length;
    var losses = games.filter(function(g) { return g.result === 'loss' || g.result === 'resigned'; }).length;
    var draws  = games.filter(function(g) { return g.result === 'draw'; }).length;
    if (statsEl) statsEl.innerHTML =
      '<span class="stat stat-win">✓ ' + wins + '</span>' +
      '<span class="stat stat-draw">= ' + draws + '</span>' +
      '<span class="stat stat-loss">✗ ' + losses + '</span>';

    if (listEl) listEl.innerHTML = '';
    games.forEach(function(game) {
      var card = document.createElement('div');
      card.className = 'history-card';
      var resClassMap = { win:'result-win', loss:'result-loss', draw:'result-draw', resigned:'result-loss' };
      var resTextMap  = { win:'Vitória ✓', loss:'Derrota ✗', draw:'Empate =', resigned:'Resignou' };
      var resClass = resClassMap[game.result] || '';
      var resText  = resTextMap[game.result]  || game.result;
      var modeText = game.mode === 'ai' ? ('🤖 IA (' + (game.difficulty || '') + ')') : '👥 Multiplayer';
      var date = new Date(game.playedAt).toLocaleDateString('pt-BR', {
        day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit'
      });
      card.innerHTML =
        '<div class="history-card-left">' +
          '<span class="history-result ' + resClass + '">' + resText + '</span>' +
          '<span class="history-opponent">vs ' + (game.opponentName || 'Oponente') + '</span>' +
        '</div>' +
        '<div class="history-card-center">' +
          '<span class="history-mode">' + modeText + '</span>' +
          '<span class="history-moves">' + (game.totalMoves || 0) + ' lances</span>' +
        '</div>' +
        '<div class="history-card-right">' +
          '<span class="history-date">' + date + '</span>' +
          '<button class="btn btn-small btn-secondary">▶ Replay</button>' +
        '</div>';
      card.querySelector('button').addEventListener('click', function() { loadReplay(game.id); });
      if (listEl) listEl.appendChild(card);
    });
  } catch (e) {
    if (listEl) listEl.innerHTML = '<div class="history-empty">Erro ao carregar historico.</div>';
    console.error(e);
  }
}

/* =====================================================
   REPLAY — carrega partida
===================================================== */
async function loadReplay(gameId) {
  showScreen('replay');
  try {
    var snap = await db.ref('games/' + gameId).once('value');
    replayGameData = snap.val();
    if (!replayGameData) { alert('Partida nao encontrada.'); openHistory(); return; }

    var isWhite = replayGameData.myColor === 'w';
    var lbl = function(id, txt) { var e = document.getElementById(id); if (e) e.textContent = txt; };
    lbl('replay-label-bottom', isWhite
      ? replayGameData.playerName + ' (Brancas)'
      : replayGameData.playerName + ' (Pretas)');
    lbl('replay-label-top', isWhite
      ? replayGameData.opponentName + ' (Pretas)'
      : replayGameData.opponentName + ' (Brancas)');
    lbl('replay-avatar-bottom', isWhite ? '♙' : '♟');
    lbl('replay-avatar-top',    isWhite ? '♟' : '♙');

    replayMoves  = replayGameData.moves ? replayGameData.moves.split('|').filter(Boolean) : [];
    replayTarget = 0;
    replayEngine = new ChessEngine();

    var slider = document.getElementById('replay-slider');
    if (slider) { slider.max = replayMoves.length; slider.value = 0; }

    buildReplayBoard();
    replayRenderBoard();
    renderReplayHistory();
    updateReplayCounter();

    var resultMap = { win:'Vitória', loss:'Derrota', draw:'Empate', resigned:'Resignou' };
    lbl('replay-status',
      'Replay — ' + (resultMap[replayGameData.result] || '') + ' — ' + replayMoves.length + ' lances');
  } catch (e) {
    console.error(e); alert('Erro ao carregar replay.'); openHistory();
  }
}

/* =====================================================
   REPLAY — parser SAN direto (sem regex destrutivo)
   Decodifica o texto SAN sem gerar contra-SANs
===================================================== */
function applyMoveBySAN(eng, san) {
  if (!san || !san.trim()) return false;
  var color = eng.turn;

  /* Remove apenas anotações, preserva letras de peças e coordenadas */
  var s = san.replace(/[+#!?\s]/g, '');

  /* ── Roque ── */
  if (s === 'O-O-O' || s === '0-0-0') {
    var rowQ = color === 'w' ? 7 : 0;
    return eng.makeMove([rowQ, 4], [rowQ, 2], 'Q');
  }
  if (s === 'O-O' || s === '0-0') {
    var rowK = color === 'w' ? 7 : 0;
    return eng.makeMove([rowK, 4], [rowK, 6], 'Q');
  }

  var FILES = 'abcdefgh';
  var RANKS = '87654321'; /* row 0 = rank 8, row 7 = rank 1 */

  /* ── Promoção ── ex: b8=Q, exd8=R */
  var promoType = 'Q';
  var work = s;
  const promoMatch = work.match(/=([QRBN])$/);
  if (promoMatch) {
    promoType = promoMatch[1];
    work = work.slice(0, -2);
  }

  /* ── Tipo de peça ── */
  var pieceType = 'P';
  if ('KQRBN'.indexOf(work[0]) !== -1) {
    pieceType = work[0];
    work = work.slice(1);
  }

  /* ── Remove 'x' de captura ── */
  work = work.replace('x', '');

  /* ── Destino: últimas 2 chars ── */
  if (work.length < 2) return false;
  var destStr  = work.slice(-2);
  var destFile = FILES.indexOf(destStr[0]);
  var destRank = RANKS.indexOf(destStr[1]);
  if (destFile === -1 || destRank === -1) return false;
  var toRow = destRank;
  var toCol = destFile;
  work = work.slice(0, -2);

  /* ── Desambiguação: o que sobrou é file e/ou rank da origem ── */
  var disambigFile = -1;
  var disambigRank = -1;
  for (var i = 0; i < work.length; i++) {
    var ch = work[i];
    var fi = FILES.indexOf(ch);
    var ri = RANKS.indexOf(ch);
    if (fi !== -1) disambigFile = fi;
    else if (ri !== -1) disambigRank = ri;
  }

  /* ── Busca candidatos ── */
  var candidates = [];
  for (var r = 0; r < 8; r++) {
    for (var c = 0; c < 8; c++) {
      var p = eng.board[r] && eng.board[r][c];
      if (!p || p.color !== color || p.type !== pieceType) continue;
      if (disambigFile !== -1 && c !== disambigFile) continue;
      if (disambigRank !== -1 && r !== disambigRank) continue;
      var legal = eng.legalMoves(r, c);
      if (legal.some(function(m) { return m.to[0] === toRow && m.to[1] === toCol; })) {
        candidates.push([r, c]);
      }
    }
  }

  if (candidates.length === 0) {
    console.warn('applyMoveBySAN: nenhum candidato para "' + san + '" (' + color + ')');
    return false;
  }
  if (candidates.length > 1) {
    console.warn('applyMoveBySAN: ambiguo "' + san + '" — ' + candidates.length + ' candidatos');
  }

  return eng.makeMove([candidates[0][0], candidates[0][1]], [toRow, toCol], promoType);
}

/* =====================================================
   REPLAY — aplica lances ate idx
===================================================== */
function _replayApplyTo(idx) {
  idx          = Math.max(0, Math.min(replayMoves.length, idx));
  replayTarget = idx;
  replayEngine = new ChessEngine();

  for (var i = 0; i < idx; i++) {
    var san = replayMoves[i];
    if (!applyMoveBySAN(replayEngine, san)) {
      console.warn('Lance ' + (i + 1) + ' falhou: "' + san + '"');
    }
  }

  var slider = document.getElementById('replay-slider');
  if (slider) slider.value = replayTarget;
  updateReplayCounter();
  replayRenderBoard();
  renderReplayHistory();
}

/* =====================================================
   REPLAY — navegacao manual
===================================================== */
function replayGoTo(idx) {
  stopReplayAuto();
  _replayApplyTo(idx);
}

/* =====================================================
   REPLAY — Play automatico com contador local
===================================================== */
function toggleReplayAuto() {
  if (replayInterval) { stopReplayAuto(); return; }
  if (replayTarget >= replayMoves.length) { _replayApplyTo(0); }
  var btn = document.getElementById('replay-play');
  if (btn) btn.textContent = '⏸ Pausar';
  var cur = replayTarget + 1;
  replayInterval = setInterval(function() {
    if (cur > replayMoves.length) { stopReplayAuto(); return; }
    _replayApplyTo(cur);
    cur++;
  }, 1000);
}

function stopReplayAuto() {
  if (replayInterval) { clearInterval(replayInterval); replayInterval = null; }
  var btn = document.getElementById('replay-play');
  if (btn) btn.textContent = '▶ Play';
}

/* =====================================================
   REPLAY — contador e historico visual
===================================================== */
function updateReplayCounter() {
  var e = document.getElementById('replay-move-counter');
  if (e) e.textContent = 'Lance ' + replayTarget + ' de ' + replayMoves.length;
}

function renderReplayHistory() {
  var box = document.getElementById('replay-move-history');
  if (!box) return;
  box.innerHTML = '';
  for (var i = 0; i < replayMoves.length; i += 2) {
    var row = document.createElement('div');
    row.className = 'move-row';
    var num = document.createElement('span');
    num.className = 'move-num'; num.textContent = (Math.floor(i / 2) + 1) + '.';
    var w = document.createElement('span');
    w.className = 'move-san' + (replayTarget === i + 1 ? ' move-active' : '');
    w.textContent = replayMoves[i] || ''; w.style.cursor = 'pointer';
    (function(idx) { w.addEventListener('click', function() { replayGoTo(idx); }); })(i + 1);
    var b = document.createElement('span');
    b.className = 'move-san' + (replayTarget === i + 2 ? ' move-active' : '');
    b.textContent = replayMoves[i + 1] || '';
    if (replayMoves[i + 1]) {
      b.style.cursor = 'pointer';
      (function(idx) { b.addEventListener('click', function() { replayGoTo(idx); }); })(i + 2);
    }
    row.appendChild(num); row.appendChild(w); row.appendChild(b);
    box.appendChild(row);
  }
  var active = box.querySelector('.move-active');
  if (active) active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/* =====================================================
   REPLAY — tabuleiro visual
===================================================== */
function buildReplayBoard() {
  var boardEl = document.getElementById('replay-chessboard');
  if (!boardEl) return;
  boardEl.innerHTML = '';
  for (var row = 0; row < 8; row++) {
    for (var col = 0; col < 8; col++) {
      var sq = document.createElement('div');
      sq.className = 'square ' + ((row + col) % 2 === 0 ? 'light' : 'dark');
      sq.dataset.row = row; sq.dataset.col = col;
      boardEl.appendChild(sq);
    }
  }
}

function replayRenderBoard() {
  var boardEl = document.getElementById('replay-chessboard');
  if (!boardEl) return;
  boardEl.querySelectorAll('.square').forEach(function(sq) {
    var vr = parseInt(sq.dataset.row);
    var vc = parseInt(sq.dataset.col);
    sq.className = 'square ' + ((vr + vc) % 2 === 0 ? 'light' : 'dark');
    sq.innerHTML = '';
    if (replayEngine.lastMove) {
      var fr = replayEngine.lastMove.from[0], fc = replayEngine.lastMove.from[1];
      var tr = replayEngine.lastMove.to[0],   tc = replayEngine.lastMove.to[1];
      if ((vr === fr && vc === fc) || (vr === tr && vc === tc)) sq.classList.add('last-move');
    }
    var piece = replayEngine.piece(vr, vc);
    if (piece) {
      var span = document.createElement('span');
      span.className = 'piece ' + (piece.color === 'w' ? 'piece-white' : 'piece-black');
      span.textContent = SYMBOLS[piece.color + piece.type] || '?';
      sq.appendChild(span);
    }
  });
}

/* =====================================================
   ESPECTADOR
===================================================== */
async function spectateGame() {
  var input = document.getElementById('input-spectate');
  var code  = input ? input.value.trim().toUpperCase() : '';
  clearLobbyError();
  if (code.length !== 6) { showLobbyError('Codigo deve ter 6 caracteres.'); return; }
  try {
    var snap = await db.ref('rooms/' + code).once('value');
    var data = snap.val();
    if (!data)                     { showLobbyError('Sala nao encontrada.'); return; }
    if (data.status === 'waiting') { showLobbyError('Partida ainda nao comecou.'); return; }
    if (data.status === 'finished' || data.status === 'resigned') { showLobbyError('Partida ja encerrou.'); return; }

    isSpectator = true; roomCode = code; myColor = 'w';
    engine.deserialize(data.state);
    var lbl = function(id, txt) { var e = document.getElementById(id); if (e) e.textContent = txt; };
    lbl('label-top',    data.blackName || 'Pretas');
    lbl('label-bottom', data.whiteName || 'Brancas');
    lbl('avatar-top',   '♟'); lbl('avatar-bottom', '♙');
    buildBoard(); renderGame(); showScreen('game');
    var hide = function(id) { var e = document.getElementById(id); if (e) e.classList.add('hidden'); };
    var show = function(id) { var e = document.getElementById(id); if (e) e.classList.remove('hidden'); };
    hide('btn-resign'); hide('btn-new-game');
    show('btn-back-lobby'); show('spectator-bar');
    lbl('status-bar', '👁 Assistindo — sala ' + code);
    specRef = db.ref('rooms/' + code);
    specRef.on('value', function(snap) {
      var d = snap.val(); if (!d) return;
      engine.deserialize(d.state); renderGame();
      var turn = (d.state && d.state.turn === 'w') ? 'Brancas' : 'Pretas';
      lbl('status-bar', '👁 ' + turn + ' jogam — sala ' + code);
      if (d.status === 'finished' || d.status === 'resigned' || d.status === 'abandoned') {
        lbl('status-bar', '👁 Partida encerrada'); specRef.off();
      }
    });
  } catch (e) { showLobbyError('Erro ao conectar: ' + e.message); }
}

/* =====================================================
   CRIAR PARTIDA
===================================================== */
function generateRoomCode() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var code = '';
  for (var i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function createGame() {
  var btn = document.getElementById('btn-create');
  if (btn) { btn.disabled = true; btn.textContent = 'Criando...'; }
  clearLobbyError();
  try {
    roomCode = generateRoomCode(); myColor = 'w'; engine.reset();
    roomRef  = db.ref('rooms/' + roomCode);
    var myName = (currentUser && (currentUser.displayName || (currentUser.email ? currentUser.email.split('@')[0] : ''))) || 'Jogador';
    await roomRef.set({
      white: myId, whiteName: myName, black: null, blackName: null,
      state: engine.serialize(), createdAt: Date.now(), status: 'waiting'
    });
    setTimeout(function() {
      if (!roomRef) return;
      roomRef.once('value', function(snap) {
        if (snap.val() && snap.val().status === 'waiting') { roomRef.remove(); goLobby(); }
      });
    }, 600000);
    var drc = document.getElementById('display-room-code');
    if (drc) drc.textContent = roomCode;
    showScreen('waiting');
    roomRef.on('value', function(snap) {
      var data = snap.val(); if (!data) return;
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
  var input = document.getElementById('input-room');
  var code  = input ? input.value.trim().toUpperCase() : '';
  clearLobbyError();
  if (code.length !== 6) { showLobbyError('Codigo deve ter 6 caracteres.'); return; }
  var btn = document.getElementById('btn-join');
  if (btn) { btn.disabled = true; btn.textContent = 'Entrando...'; }
  try {
    roomRef = db.ref('rooms/' + code);
    var snap = await roomRef.once('value');
    var data = snap.val();
    if (!data)      { showLobbyError('Sala nao encontrada.');  roomRef = null; return; }
    if (data.black) { showLobbyError('Sala ja esta cheia.');   roomRef = null; return; }
    if (data.status === 'finished' || data.status === 'resigned') { showLobbyError('Partida ja encerrada.'); roomRef = null; return; }
    roomCode = code; myColor = 'b'; engine.deserialize(data.state);
    var myName = (currentUser && (currentUser.displayName || (currentUser.email ? currentUser.email.split('@')[0] : ''))) || 'Jogador';
    await roomRef.update({ black: myId, blackName: myName, status: 'playing' });
    opponentNameGlobal = data.whiteName || 'Oponente';
    startMultiplayerGame(myName, opponentNameGlobal);
  } catch (e) { showLobbyError('Erro ao entrar: ' + e.message); roomRef = null; }
  finally { if (btn) { btn.disabled = false; btn.textContent = 'Entrar'; } }
}

async function cancelGame() {
  if (roomRef) { await roomRef.remove().catch(function(){}); roomRef.off(); roomRef = null; }
  goLobby();
}

function copyRoomCode() {
  navigator.clipboard.writeText(roomCode).then(function() {
    var fb = document.getElementById('copy-feedback');
    if (fb) { fb.textContent = 'Copiado!'; setTimeout(function() { fb.textContent = ''; }, 2000); }
  });
}

/* =====================================================
   HELPER — card de jogador
===================================================== */
function setPlayerCard(avatarId, labelId, label, photoURL, symbol) {
  var avatarEl = document.getElementById(avatarId);
  var labelEl  = document.getElementById(labelId);
  if (labelEl) labelEl.textContent = label;
  if (!avatarEl) return;
  if (photoURL) {
    avatarEl.innerHTML = '<img src="' + photoURL + '" alt="' + label + '" ' +
      'style="width:100%;height:100%;object-fit:cover;border-radius:6px;" ' +
      'onerror="this.parentElement.textContent=\'' + symbol + '\'" />';
  } else {
    avatarEl.textContent = symbol;
  }
}

/* =====================================================
   MULTIPLAYER
===================================================== */
function startMultiplayerGame(myName, oppName) {
  gameMode = 'multiplayer'; gameActive = true; isSpectator = false;
  selectedSq = null; legalMovesCache = [];
  var myPhoto   = window._myPhotoURL || null;
  var mySymbol  = myColor === 'w' ? '♙' : '♟';
  var oppSymbol = myColor === 'w' ? '♟' : '♙';
  setPlayerCard('avatar-bottom', 'label-bottom',
    myName  + ' (' + (myColor === 'w' ? 'Brancas' : 'Pretas') + ')', myPhoto, mySymbol);
  setPlayerCard('avatar-top', 'label-top',
    oppName + ' (' + (myColor === 'w' ? 'Pretas' : 'Brancas') + ')', null, oppSymbol);
  buildBoard(); renderGame(); showScreen('game');
  var show = function(id) { var e = document.getElementById(id); if (e) e.classList.remove('hidden'); };
  var hide = function(id) { var e = document.getElementById(id); if (e) e.classList.add('hidden'); };
  show('btn-resign'); hide('btn-new-game'); hide('btn-back-lobby'); hide('spectator-bar');
  roomRef.on('value', function(snap) {
    var data = snap.val(); if (!data) return;
    if (data.status === 'resigned' && data.winner !== myColor) {
      engine.deserialize(data.state); renderGame(); gameActive = false;
      saveGame('win'); showGameOver('Vitoria! 🏆', 'O oponente resignou.'); return;
    }
    if (data.status === 'abandoned') {
      gameActive = false; saveGame('win');
      showGameOver('Vitoria! 🏆', 'O oponente abandonou.'); return;
    }
    if (data.state && data.state.turn === myColor) {
      engine.deserialize(data.state); renderGame();
      if (engine.status === 'checkmate') {
        gameActive = false; saveGame('loss'); showGameOver('Xeque-mate!', 'Voce perdeu. Tente novamente!');
      } else if (engine.status === 'stalemate') {
        gameActive = false; saveGame('draw'); showGameOver('Empate!', 'Afogamento.');
      }
    }
  });
}

/* =====================================================
   VS IA
===================================================== */
function startAIGame() {
  gameMode = 'ai';
  var playerColor = selectedPlayerColor;
  if (playerColor === 'random') playerColor = Math.random() < 0.5 ? 'w' : 'b';
  myColor = playerColor; aiColor = playerColor === 'w' ? 'b' : 'w';
  ai.setDifficulty(selectedDiff);
  engine.reset();
  gameActive = true; isSpectator = false; selectedSq = null; legalMovesCache = [];
  opponentNameGlobal = 'IA (' + selectedDiff + ')';
  var diffLabels = { iniciante:'Iniciante', intermediario:'Intermediario', avancado:'Avancado', expert:'Expert' };
  var myPhoto  = window._myPhotoURL || null;
  var mySymbol = myColor === 'w' ? '♙' : '♟';
  setPlayerCard('avatar-bottom', 'label-bottom',
    'Voce (' + (myColor === 'w' ? 'Brancas' : 'Pretas') + ')', myPhoto, mySymbol);
  setPlayerCard('avatar-top', 'label-top',
    'IA — ' + (diffLabels[selectedDiff] || selectedDiff), null, '🤖');
  buildBoard(); renderGame(); showScreen('game');
  var show = function(id) { var e = document.getElementById(id); if (e) e.classList.remove('hidden'); };
  var hide = function(id) { var e = document.getElementById(id); if (e) e.classList.add('hidden'); };
  show('btn-resign'); hide('btn-new-game'); hide('btn-back-lobby'); hide('spectator-bar');
  if (engine.turn === aiColor) scheduleAIMove();
}

function scheduleAIMove() {
  if (!gameActive || engine.turn !== aiColor) return;
  aiThinking = true; updateStatusBar();
  var delay = selectedDiff === 'expert' ? 900 : 450;
  setTimeout(function() {
    if (!gameActive) return;
    var move = ai.getBestMove(engine);
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
  var boardEl = document.getElementById('chessboard');
  if (!boardEl) return;
  boardEl.innerHTML = '';
  var files = myColor === 'w' ? ['a','b','c','d','e','f','g','h'] : ['h','g','f','e','d','c','b','a'];
  var ranks = myColor === 'w' ? ['8','7','6','5','4','3','2','1'] : ['1','2','3','4','5','6','7','8'];
  ['coords-file-top','coords-file-bottom'].forEach(function(id) {
    var el = document.getElementById(id); if (!el) return;
    el.innerHTML = '';
    files.forEach(function(f) {
      var s = document.createElement('span');
      s.className = 'coord-label'; s.style.width = 'calc(var(--board-size)/8)';
      s.textContent = f; el.appendChild(s);
    });
  });
  ['coords-rank-left','coords-rank-right'].forEach(function(id) {
    var el = document.getElementById(id); if (!el) return;
    el.innerHTML = '';
    ranks.forEach(function(r) {
      var s = document.createElement('span');
      s.className = 'coord-label'; s.style.height = 'calc(var(--board-size)/8)';
      s.textContent = r; el.appendChild(s);
    });
  });
  for (var row = 0; row < 8; row++) {
    for (var col = 0; col < 8; col++) {
      var sq = document.createElement('div');
      sq.className = 'square'; sq.dataset.row = row; sq.dataset.col = col;
      if (!isSpectator) sq.addEventListener('click', onSquareClick);
      boardEl.appendChild(sq);
    }
  }
}

function viewToLogic(vr, vc) { return myColor === 'w' ? [vr, vc] : [7-vr, 7-vc]; }
function logicToView(lr, lc) { return myColor === 'w' ? [lr, lc] : [7-lr, 7-lc]; }

/* =====================================================
   RENDERIZACAO
===================================================== */
function renderGame() {
  document.querySelectorAll('#chessboard .square').forEach(function(sq) {
    var vr = parseInt(sq.dataset.row);
    var vc = parseInt(sq.dataset.col);
    var lc = viewToLogic(vr, vc);
    sq.className = 'square ' + ((vr + vc) % 2 === 0 ? 'light' : 'dark');
    sq.innerHTML = '';
    if (engine.lastMove) {
      var fv = logicToView(engine.lastMove.from[0], engine.lastMove.from[1]);
      var tv = logicToView(engine.lastMove.to[0],   engine.lastMove.to[1]);
      if ((vr === fv[0] && vc === fv[1]) || (vr === tv[0] && vc === tv[1])) sq.classList.add('last-move');
    }
    var piece = engine.piece(lc[0], lc[1]);
    if (piece) {
      var span = document.createElement('span');
      span.className = 'piece ' + (piece.color === 'w' ? 'piece-white' : 'piece-black');
      span.textContent = SYMBOLS[piece.color + piece.type] || '?';
      sq.appendChild(span);
      if (piece.type === 'K' && piece.color === engine.turn && engine.status === 'check')
        sq.classList.add('in-check');
    }
  });
  if (selectedSq !== null) {
    var sv = logicToView(selectedSq[0], selectedSq[1]);
    var sel = document.querySelector('#chessboard [data-row="' + sv[0] + '"][data-col="' + sv[1] + '"]');
    if (sel) sel.classList.add('selected');
    legalMovesCache.forEach(function(m) {
      var mv = logicToView(m.to[0], m.to[1]);
      var el = document.querySelector('#chessboard [data-row="' + mv[0] + '"][data-col="' + mv[1] + '"]');
      if (el) el.classList.add(engine.piece(m.to[0], m.to[1]) || m.enPassant ? 'capture-hint' : 'move-hint');
    });
  }
  updateStatusBar(); updateMoveHistory(); updateCaptured(); updateTurnCards();
}

/* =====================================================
   CLIQUE
===================================================== */
function onSquareClick(e) {
  var sq = e.currentTarget;
  var vr = parseInt(sq.dataset.row);
  var vc = parseInt(sq.dataset.col);
  var lc = viewToLogic(vr, vc);
  var lr = lc[0], lcol = lc[1];
  if (!gameActive || isSpectator || aiThinking) return;
  if (engine.turn !== myColor) return;
  if (engine.status === 'checkmate' || engine.status === 'stalemate') return;
  var piece = engine.piece(lr, lcol);
  if (selectedSq !== null) {
    var slr = selectedSq[0], slc = selectedSq[1];
    var move = legalMovesCache.find(function(m) { return m.to[0] === lr && m.to[1] === lcol; });
    if (move) {
      if (engine.board[slr][slc] && engine.board[slr][slc].type === 'P' && (lr === 0 || lr === 7)) {
        pendingPromotion = { from:[slr,slc], to:[lr,lcol] }; showPromotion(); return;
      }
      doMove([slr, slc], [lr, lcol]); return;
    }
    if (piece && piece.color === myColor) {
      selectedSq = [lr, lcol]; legalMovesCache = engine.legalMoves(lr, lcol); renderGame(); return;
    }
    selectedSq = null; legalMovesCache = []; renderGame(); return;
  }
  if (piece && piece.color === myColor) {
    selectedSq = [lr, lcol]; legalMovesCache = engine.legalMoves(lr, lcol); renderGame();
  }
}

/* =====================================================
   EXECUTAR MOVIMENTO
===================================================== */
async function doMove(from, to, promoteTo) {
  promoteTo = promoteTo || 'Q';
  if (!engine.makeMove(from, to, promoteTo)) return;
  selectedSq = null; legalMovesCache = []; renderGame();
  if (gameMode === 'multiplayer' && roomRef) {
    try { await roomRef.update({ state: engine.serialize() }); }
    catch (e) { console.error('Erro ao salvar movimento:', e); }
  }
  if (engine.status === 'checkmate') {
    if (gameMode === 'multiplayer' && roomRef)
      await roomRef.update({ status:'finished', winner:myColor }).catch(function(){});
    gameActive = false; saveGame('win');
    showGameOver('Xeque-mate! 🏆', 'Voce venceu! Parabens!'); return;
  }
  if (engine.status === 'stalemate') {
    if (gameMode === 'multiplayer' && roomRef)
      await roomRef.update({ status:'finished', winner:null }).catch(function(){});
    gameActive = false; saveGame('draw');
    showGameOver('Empate!', 'Afogamento — nenhum movimento legal.'); return;
  }
  if (gameMode === 'ai' && engine.turn === aiColor) scheduleAIMove();
}

/* =====================================================
   PROMOCAO
===================================================== */
function showPromotion() {
  var choices = document.getElementById('promotion-choices');
  if (!choices) return;
  choices.innerHTML = '';
  ['Q','R','B','N'].forEach(function(type) {
    var btn = document.createElement('button');
    btn.className = 'promotion-choice';
    btn.textContent = SYMBOLS[myColor + type];
    btn.addEventListener('click', function() {
      hideModal('modal-promotion');
      var from = pendingPromotion.from, to = pendingPromotion.to;
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
  var bar = document.getElementById('status-bar');
  if (!bar) return;
  bar.className = 'status-bar';
  if (isSpectator) { bar.textContent = '👁 Assistindo — ' + (engine.turn === 'w' ? 'Brancas' : 'Pretas') + ' jogam'; return; }
  if (aiThinking)  { bar.innerHTML = 'IA pensando <span class="thinking-dots"><span></span><span></span><span></span></span>'; return; }
  var isMyTurn = engine.turn === myColor;
  var msgs = {
    playing:   isMyTurn ? 'Sua vez' : (gameMode === 'ai' ? 'IA pensando...' : 'Vez do oponente'),
    check:     isMyTurn ? '⚠ Xeque! Defenda seu rei' : 'Oponente esta em xeque',
    checkmate: 'Xeque-mate!',
    stalemate: 'Afogamento!'
  };
  bar.textContent = msgs[engine.status] || '';
  if (engine.status === 'check'   && isMyTurn) bar.classList.add('check');
  if (engine.status === 'playing' && isMyTurn) bar.classList.add('your-turn');
}

/* =====================================================
   HISTORICO DE MOVIMENTOS (em jogo)
===================================================== */
function updateMoveHistory() {
  var box = document.getElementById('move-history');
  if (!box) return;
  box.innerHTML = '';
  for (var i = 0; i < engine.history.length; i += 2) {
    var row = document.createElement('div'); row.className = 'move-row';
    var num = document.createElement('span'); num.className = 'move-num'; num.textContent = (Math.floor(i/2)+1) + '.';
    var w = document.createElement('span'); w.className = 'move-san'; w.textContent = engine.history[i] || '';
    var b = document.createElement('span'); b.className = 'move-san'; b.textContent = engine.history[i+1] || '';
    row.appendChild(num); row.appendChild(w); row.appendChild(b);
    box.appendChild(row);
  }
  box.scrollTop = box.scrollHeight;
}

/* =====================================================
   PECAS CAPTURADAS
===================================================== */
function updateCaptured() {
  var order = { Q:9, R:5, B:3, N:3, P:1 };
  function render(capturedColor, elId) {
    var el = document.getElementById(elId); if (!el) return;
    var pieces = engine.captured[capturedColor].slice().sort(function(a,b){ return (order[b]||0)-(order[a]||0); });
    el.innerHTML = ''; if (!pieces.length) return;
    var myScore  = pieces.reduce(function(s,t){ return s+(order[t]||0); }, 0);
    var oppScore = engine.captured[capturedColor==='w'?'b':'w'].reduce(function(s,t){ return s+(order[t]||0); }, 0);
    var adv = myScore - oppScore;
    pieces.forEach(function(type) {
      var span = document.createElement('span');
      span.className = 'cap-piece ' + (capturedColor === 'w' ? 'cap-black' : 'cap-white');
      span.textContent = SYMBOLS[capturedColor + type];
      el.appendChild(span);
    });
    if (adv > 0) {
      var s = document.createElement('span');
      s.className = 'advantage-score'; s.textContent = '+' + adv;
      el.appendChild(s);
    }
  }
  if (myColor === 'w') { render('b','captured-bottom'); render('w','captured-top'); }
  else                  { render('w','captured-bottom'); render('b','captured-top'); }
}

/* =====================================================
   CARDS DE TURNO
===================================================== */
function updateTurnCards() {
  var isMyTurn = engine.turn === myColor;
  var cb = document.getElementById('card-bottom');
  var ct = document.getElementById('card-top');
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
    var enemy = myColor === 'w' ? 'b' : 'w';
    await roomRef.update({ status:'resigned', winner:enemy, state:engine.serialize() }).catch(function(){});
  }
  saveGame('resigned');
  showGameOver('Voce resignou', gameMode === 'ai' ? 'A IA venceu.' : 'O oponente venceu.');
}

/* =====================================================
   GAME OVER
===================================================== */
function showGameOver(title, msg) {
  var t = document.getElementById('gameover-title');
  var m = document.getElementById('gameover-msg');
  var i = document.getElementById('gameover-icon');
  if (t) t.textContent = title;
  if (m) m.textContent = msg;
  if (i) i.textContent = title.indexOf('🏆') !== -1 ? '🏆'
    : title.indexOf('Empate') !== -1 ? '🤝'
    : title.indexOf('resignou') !== -1 ? '🏳' : '♟';
  var hide = function(id) { var e = document.getElementById(id); if (e) e.classList.add('hidden'); };
  var show = function(id) { var e = document.getElementById(id); if (e) e.classList.remove('hidden'); };
  hide('btn-resign'); show('btn-new-game');
  setTimeout(function() { showModal('modal-gameover'); }, 700);
}