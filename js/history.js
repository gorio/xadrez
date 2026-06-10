/* =====================================================
   HISTÓRICO DE JOGOS + REPLAY + ESPECTADOR
===================================================== */
class GameHistory {
  constructor() {
    this.replayEngine  = null;
    this.replayMoves   = [];
    this.replayIndex   = 0;
    this.replayGameId  = null;
  }

  /* -------------------------------------------------
     SALVAR PARTIDA
  ------------------------------------------------- */
  async saveGame({ gameId, mode, difficulty, myColor,
                   whiteName, blackName, whiteUid, blackUid,
                   result, reason, movesData, sanHistory, totalMoves }) {
    if (!auth.isLoggedIn) return;

    const uid    = auth.uid;
    const isWin  = (result === myColor);
    const isDraw = (result === 'draw');

    const record = {
      gameId, mode, difficulty: difficulty || '',
      myColor, whiteName, blackName,
      whiteUid: whiteUid || '', blackUid: blackUid || '',
      result, reason,
      movesData:  movesData  || '',
      sanHistory: sanHistory || '',
      totalMoves: totalMoves || 0,
      startedAt:  Date.now(),
      endedAt:    Date.now()
    };

    try {
      await firebase.database()
        .ref(`gameHistory/${uid}/${gameId}`)
        .set(record);

      /* Atualiza stats do usuário */
      const userRef  = firebase.database().ref(`users/${uid}`);
      const snap     = await userRef.once('value');
      const userData = snap.val() || {};

      await userRef.update({
        gamesPlayed: (userData.gamesPlayed || 0) + 1,
        wins:   (userData.wins   || 0) + (isWin  ? 1 : 0),
        losses: (userData.losses || 0) + (!isWin && !isDraw ? 1 : 0),
        draws:  (userData.draws  || 0) + (isDraw  ? 1 : 0)
      });
    } catch (e) {
      console.error('Erro ao salvar histórico:', e);
    }
  }

  /* -------------------------------------------------
     CARREGAR HISTÓRICO
  ------------------------------------------------- */
  async loadHistory(uid) {
    uid = uid || auth.uid;
    if (!uid) return [];

    const snap = await firebase.database()
      .ref(`gameHistory/${uid}`)
      .orderByChild('endedAt')
      .limitToLast(50)
      .once('value');

    const data = snap.val();
    if (!data) return [];

    return Object.values(data)
      .sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0));
  }

  /* -------------------------------------------------
     CARREGAR PARTIDAS AO VIVO (para espectadores)
  ------------------------------------------------- */
  async loadLiveGames() {
    const snap = await firebase.database()
      .ref('rooms')
      .orderByChild('status')
      .equalTo('playing')
      .limitToLast(20)
      .once('value');

    const data = snap.val();
    if (!data) return [];

    return Object.entries(data).map(([id, room]) => ({ id, ...room }));
  }

  /* -------------------------------------------------
     INICIAR REPLAY
  ------------------------------------------------- */
  startReplay(record) {
    this.replayGameId = record.gameId;
    this.replayMoves  = record.movesData
      ? record.movesData.split(';').filter(Boolean).map(m => {
          const parts = m.split(',');
          return {
            from: [parseInt(parts[0]), parseInt(parts[1])],
            to:   [parseInt(parts[2]), parseInt(parts[3])],
            promoteTo: parts[4] || 'Q'
          };
        })
      : [];

    this.replayIndex  = 0;
    this.replayEngine = new ChessEngine();
    return this.replayEngine;
  }

  get replayTotal()   { return this.replayMoves.length; }
  get replayCurrent() { return this.replayIndex; }

  replayGoTo(index) {
    this.replayEngine = new ChessEngine();
    this.replayIndex  = 0;

    for (let i = 0; i < index && i < this.replayMoves.length; i++) {
      const m = this.replayMoves[i];
      this.replayEngine.makeMove(m.from, m.to, m.promoteTo);
      this.replayIndex++;
    }
    return this.replayEngine;
  }

  replayNext() {
    if (this.replayIndex >= this.replayMoves.length) return null;
    const m = this.replayMoves[this.replayIndex];
    this.replayEngine.makeMove(m.from, m.to, m.promoteTo);
    this.replayIndex++;
    return this.replayEngine;
  }

  replayPrev() {
    if (this.replayIndex <= 0) return null;
    return this.replayGoTo(this.replayIndex - 1);
  }

  replayFirst() { return this.replayGoTo(0); }
  replayLast()  { return this.replayGoTo(this.replayMoves.length); }
}

const gameHistory = new GameHistory();