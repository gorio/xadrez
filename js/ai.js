/**
 * Chess AI — Minimax com Alpha-Beta Pruning
 * Níveis: iniciante, intermediario, avancado, expert
 */
class ChessAI {
  constructor() {
    this.difficulty = 'intermediario';
    this.configs = {
      iniciante:     { depth: 1, randomness: 0.8,  randomMoves: true  },
      intermediario: { depth: 2, randomness: 0.15, randomMoves: false },
      avancado:      { depth: 3, randomness: 0.05, randomMoves: false },
      expert:        { depth: 4, randomness: 0,    randomMoves: false }
    };
  }

  setDifficulty(level) {
    this.difficulty = level;
  }

  /* =====================================================
     TABELAS DE VALOR POSICIONAL (peça + posição no board)
     Perspectiva das brancas — invertida para pretas
  ===================================================== */
  _tables() {
    const P = [
      [ 0,  0,  0,  0,  0,  0,  0,  0],
      [50, 50, 50, 50, 50, 50, 50, 50],
      [10, 10, 20, 30, 30, 20, 10, 10],
      [ 5,  5, 10, 25, 25, 10,  5,  5],
      [ 0,  0,  0, 20, 20,  0,  0,  0],
      [ 5, -5,-10,  0,  0,-10, -5,  5],
      [ 5, 10, 10,-20,-20, 10, 10,  5],
      [ 0,  0,  0,  0,  0,  0,  0,  0]
    ];
    const N = [
      [-50,-40,-30,-30,-30,-30,-40,-50],
      [-40,-20,  0,  0,  0,  0,-20,-40],
      [-30,  0, 10, 15, 15, 10,  0,-30],
      [-30,  5, 15, 20, 20, 15,  5,-30],
      [-30,  0, 15, 20, 20, 15,  0,-30],
      [-30,  5, 10, 15, 15, 10,  5,-30],
      [-40,-20,  0,  5,  5,  0,-20,-40],
      [-50,-40,-30,-30,-30,-30,-40,-50]
    ];
    const B = [
      [-20,-10,-10,-10,-10,-10,-10,-20],
      [-10,  0,  0,  0,  0,  0,  0,-10],
      [-10,  0,  5, 10, 10,  5,  0,-10],
      [-10,  5,  5, 10, 10,  5,  5,-10],
      [-10,  0, 10, 10, 10, 10,  0,-10],
      [-10, 10, 10, 10, 10, 10, 10,-10],
      [-10,  5,  0,  0,  0,  0,  5,-10],
      [-20,-10,-10,-10,-10,-10,-10,-20]
    ];
    const R = [
      [ 0,  0,  0,  0,  0,  0,  0,  0],
      [ 5, 10, 10, 10, 10, 10, 10,  5],
      [-5,  0,  0,  0,  0,  0,  0, -5],
      [-5,  0,  0,  0,  0,  0,  0, -5],
      [-5,  0,  0,  0,  0,  0,  0, -5],
      [-5,  0,  0,  0,  0,  0,  0, -5],
      [-5,  0,  0,  0,  0,  0,  0, -5],
      [ 0,  0,  0,  5,  5,  0,  0,  0]
    ];
    const Q = [
      [-20,-10,-10, -5, -5,-10,-10,-20],
      [-10,  0,  0,  0,  0,  0,  0,-10],
      [-10,  0,  5,  5,  5,  5,  0,-10],
      [ -5,  0,  5,  5,  5,  5,  0, -5],
      [  0,  0,  5,  5,  5,  5,  0, -5],
      [-10,  5,  5,  5,  5,  5,  0,-10],
      [-10,  0,  5,  0,  0,  0,  0,-10],
      [-20,-10,-10, -5, -5,-10,-10,-20]
    ];
    const K_mid = [
      [-30,-40,-40,-50,-50,-40,-40,-30],
      [-30,-40,-40,-50,-50,-40,-40,-30],
      [-30,-40,-40,-50,-50,-40,-40,-30],
      [-30,-40,-40,-50,-50,-40,-40,-30],
      [-20,-30,-30,-40,-40,-30,-30,-20],
      [-10,-20,-20,-20,-20,-20,-20,-10],
      [ 20, 20,  0,  0,  0,  0, 20, 20],
      [ 20, 30, 10,  0,  0, 10, 30, 20]
    ];
    return { P, N, B, R, Q, K: K_mid };
  }

  /* =====================================================
     AVALIAÇÃO DO TABULEIRO
  ===================================================== */
  _evaluate(engine) {
    if (engine.status === 'checkmate') {
      return engine.turn === 'b' ? 100000 : -100000;
    }
    if (engine.status === 'stalemate') return 0;

    const materialValue = { P:100, N:320, B:330, R:500, Q:900, K:20000 };
    const tables = this._tables();
    let score = 0;

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = engine.piece(r, c);
        if (!p) continue;

        const val  = materialValue[p.type] || 0;
        const tbl  = tables[p.type];
        const posR = p.color === 'w' ? r : 7 - r;
        const posC = p.color === 'w' ? c : 7 - c;
        const pos  = tbl ? (tbl[posR]?.[posC] || 0) : 0;

        if (p.color === 'w') score += val + pos;
        else                  score -= val + pos;
      }
    }

    return score;
  }

  /* =====================================================
     ORDENA MOVIMENTOS (melhores primeiro para poda)
  ===================================================== */
  _orderMoves(moves, engine) {
    const materialValue = { P:100, N:320, B:330, R:500, Q:900, K:20000 };
    return moves.sort((a, b) => {
      const targetA = engine.piece(a.to[0], a.to[1]);
      const targetB = engine.piece(b.to[0], b.to[1]);
      const scoreA  = targetA ? (materialValue[targetA.type] || 0) : 0;
      const scoreB  = targetB ? (materialValue[targetB.type] || 0) : 0;
      return scoreB - scoreA;
    });
  }

  /* =====================================================
     MINIMAX COM ALPHA-BETA
  ===================================================== */
  _minimax(engine, depth, alpha, beta, maximizing) {
    if (depth === 0 || engine.status === 'checkmate' || engine.status === 'stalemate') {
      return this._evaluate(engine);
    }

    const color = maximizing ? 'w' : 'b';
    let allMoves = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (engine.board[r]?.[c]?.color === color) {
          const legal = engine.legalMoves(r, c);
          legal.forEach(m => allMoves.push({ from: [r, c], to: m.to, promoteTo: 'Q' }));
        }
      }
    }

    allMoves = this._orderMoves(allMoves, engine);

    if (maximizing) {
      let maxEval = -Infinity;
      for (const move of allMoves) {
        const clone = this._cloneEngine(engine);
        clone.makeMove(move.from, move.to, move.promoteTo);
        const ev = this._minimax(clone, depth - 1, alpha, beta, false);
        maxEval  = Math.max(maxEval, ev);
        alpha    = Math.max(alpha, ev);
        if (beta <= alpha) break;
      }
      return maxEval;
    } else {
      let minEval = Infinity;
      for (const move of allMoves) {
        const clone = this._cloneEngine(engine);
        clone.makeMove(move.from, move.to, move.promoteTo);
        const ev = this._minimax(clone, depth - 1, alpha, beta, true);
        minEval  = Math.min(minEval, ev);
        beta     = Math.min(beta, ev);
        if (beta <= alpha) break;
      }
      return minEval;
    }
  }

  /* =====================================================
     CLONE DO ENGINE PARA SIMULAÇÃO
  ===================================================== */
  _cloneEngine(engine) {
    const clone = new ChessEngine();
    clone.board    = engine.board.map(row => row.map(p => p ? {...p} : null));
    clone.turn     = engine.turn;
    clone.castling = { ...engine.castling };
    clone.enPassant = engine.enPassant ? [...engine.enPassant] : null;
    clone.history  = [...engine.history];
    clone.captured = { w: [...engine.captured.w], b: [...engine.captured.b] };
    clone.status   = engine.status;
    clone.lastMove = engine.lastMove ? {
      from: [...engine.lastMove.from],
      to:   [...engine.lastMove.to]
    } : null;
    return clone;
  }

  /* =====================================================
     CALCULA MELHOR MOVIMENTO
  ===================================================== */
  getBestMove(engine) {
    const cfg   = this.configs[this.difficulty];
    const color = engine.turn; // IA sempre joga a cor atual

    /* coleta todos os movimentos legais */
    let allMoves = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (engine.board[r]?.[c]?.color === color) {
          const legal = engine.legalMoves(r, c);
          legal.forEach(m => allMoves.push({ from:[r,c], to:m.to, promoteTo:'Q' }));
        }
      }
    }

    if (allMoves.length === 0) return null;

    /* nível iniciante: às vezes faz movimento aleatório */
    if (cfg.randomMoves && Math.random() < cfg.randomness) {
      return allMoves[Math.floor(Math.random() * allMoves.length)];
    }

    const maximizing = (color === 'w');
    let bestMove  = null;
    let bestScore = maximizing ? -Infinity : Infinity;

    allMoves = this._orderMoves(allMoves, engine);

    for (const move of allMoves) {
      const clone = this._cloneEngine(engine);
      clone.makeMove(move.from, move.to, move.promoteTo);
      const score = this._minimax(clone, cfg.depth - 1, -Infinity, Infinity, !maximizing);

      /* pequena aleatoriedade nos níveis mais fáceis */
      const jitter = (Math.random() - 0.5) * cfg.randomness * 80;

      if (maximizing ? (score + jitter > bestScore) : (score + jitter < bestScore)) {
        bestScore = score + jitter;
        bestMove  = move;
      }
    }

    return bestMove || allMoves[0];
  }
}