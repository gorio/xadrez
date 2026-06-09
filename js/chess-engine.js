/**
 * Chess Engine — lógica completa do xadrez
 * Suporta: roque, en passant, promoção, xeque, xeque-mate, afogamento
 */
class ChessEngine {
  constructor() {
    this.reset();
  }

  reset() {
    this.board = this._initBoard();
    this.turn = 'w';
    this.castling = { wK: true, wQ: true, bK: true, bQ: true };
    this.enPassant = null;
    this.history = [];
    this.captured = { w: [], b: [] };
    this.status = 'playing'; // playing | check | checkmate | stalemate
    this.lastMove = null;
  }

  _initBoard() {
    const b = Array(8).fill(null).map(() => Array(8).fill(null));
    const order = ['R','N','B','Q','K','B','N','R'];
    for (let c = 0; c < 8; c++) {
      b[0][c] = { type: order[c], color: 'b' };
      b[1][c] = { type: 'P', color: 'b' };
      b[6][c] = { type: 'P', color: 'w' };
      b[7][c] = { type: order[c], color: 'w' };
    }
    return b;
  }

  piece(r, c) {
    if (!this._inBounds(r, c)) return null;
    return this.board[r][c];
  }

  _inBounds(r, c) {
    return r >= 0 && r < 8 && c >= 0 && c < 8;
  }

  _enemy(color) {
    return color === 'w' ? 'b' : 'w';
  }

  /* ===== GERAÇÃO DE MOVIMENTOS PSEUDO-LEGAIS ===== */
  _pseudoMoves(r, c, board, castling, enPassant) {
    const p = board[r][c];
    if (!p) return [];
    const { type, color } = p;
    const moves = [];
    const enemy = this._enemy(color);

    const add = (tr, tc, flags = {}) => {
      if (this._inBounds(tr, tc)) moves.push({ from: [r, c], to: [tr, tc], ...flags });
    };

    if (type === 'P') {
      const dir = color === 'w' ? -1 : 1;
      const startRow = color === 'w' ? 6 : 1;
      // Avanço
      if (!board[r + dir]?.[c]) {
        add(r + dir, c);
        if (r === startRow && !board[r + 2 * dir]?.[c]) {
          add(r + 2 * dir, c, { doublePush: true });
        }
      }
      // Capturas diagonais
      for (const dc of [-1, 1]) {
        const tr = r + dir, tc = c + dc;
        if (this._inBounds(tr, tc)) {
          if (board[tr][tc]?.color === enemy) add(tr, tc, { capture: true });
          if (enPassant && enPassant[0] === tr && enPassant[1] === tc) {
            add(tr, tc, { enPassant: true, capture: true });
          }
        }
      }
    }

    if (type === 'N') {
      const jumps = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
      for (const [dr, dc] of jumps) {
        const tr = r + dr, tc = c + dc;
        if (this._inBounds(tr, tc) && board[tr][tc]?.color !== color) add(tr, tc);
      }
    }

    const slide = (dirs) => {
      for (const [dr, dc] of dirs) {
        let tr = r + dr, tc = c + dc;
        while (this._inBounds(tr, tc)) {
          if (board[tr][tc]) {
            if (board[tr][tc].color === enemy) add(tr, tc, { capture: true });
            break;
          }
          add(tr, tc);
          tr += dr; tc += dc;
        }
      }
    };

    if (type === 'B') slide([[-1,-1],[-1,1],[1,-1],[1,1]]);
    if (type === 'R') slide([[-1,0],[1,0],[0,-1],[0,1]]);
    if (type === 'Q') slide([[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]]);

    if (type === 'K') {
      const dirs = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
      for (const [dr, dc] of dirs) {
        const tr = r + dr, tc = c + dc;
        if (this._inBounds(tr, tc) && board[tr][tc]?.color !== color) add(tr, tc);
      }
      // Roque
      const row = color === 'w' ? 7 : 0;
      if (castling[color + 'K'] && !board[row][5] && !board[row][6]
          && board[row][7]?.type === 'R' && board[row][7]?.color === color) {
        add(row, 6, { castle: 'K' });
      }
      if (castling[color + 'Q'] && !board[row][3] && !board[row][2] && !board[row][1]
          && board[row][0]?.type === 'R' && board[row][0]?.color === color) {
        add(row, 2, { castle: 'Q' });
      }
    }

    return moves;
  }

  /* ===== APLICA MOVIMENTO NUM BOARD CLONADO ===== */
  _applyMove(board, move, enPassant) {
    const nb = board.map(row => row.map(p => p ? { ...p } : null));
    const [fr, fc] = move.from;
    const [tr, tc] = move.to;
    const p = { ...nb[fr][fc] };

    if (move.enPassant) {
      const capRow = p.color === 'w' ? tr + 1 : tr - 1;
      nb[capRow][tc] = null;
    }

    if (move.castle === 'K') {
      const row = fr;
      nb[row][5] = { ...nb[row][7] };
      nb[row][7] = null;
    }
    if (move.castle === 'Q') {
      const row = fr;
      nb[row][3] = { ...nb[row][0] };
      nb[row][0] = null;
    }

    nb[tr][tc] = p;
    nb[fr][fc] = null;

    // Promoção automática (para validação de xeque; UI pedirá ao usuário)
    if (p.type === 'P' && (tr === 0 || tr === 7)) {
      nb[tr][tc] = { type: move.promoteTo || 'Q', color: p.color };
    }

    return nb;
  }

  /* ===== VERIFICA SE UM REI ESTÁ EM XEQUE ===== */
  _inCheck(board, color, castling, enPassant) {
    // Encontra o rei
    let kr = -1, kc = -1;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (board[r][c]?.type === 'K' && board[r][c]?.color === color) {
          kr = r; kc = c;
        }
      }
    }
    if (kr === -1) return false;

    const enemy = this._enemy(color);
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (board[r][c]?.color === enemy) {
          const moves = this._pseudoMoves(r, c, board, castling, enPassant);
          if (moves.some(m => m.to[0] === kr && m.to[1] === kc)) return true;
        }
      }
    }
    return false;
  }

  /* ===== MOVIMENTOS LEGAIS ===== */
  legalMoves(r, c) {
    const p = this.board[r][c];
    if (!p || p.color !== this.turn) return [];

    const pseudo = this._pseudoMoves(r, c, this.board, this.castling, this.enPassant);
    const legal = [];

    for (const move of pseudo) {
      // Valida roque: rei não pode passar por casa atacada
      if (move.castle) {
        const row = r;
        const color = p.color;
        const midCol = move.castle === 'K' ? 5 : 3;
        const endCol = move.to[1];
        let safe = true;
        // Rei não pode estar em xeque na posição inicial
        if (this._inCheck(this.board, color, this.castling, this.enPassant)) safe = false;
        // Casa do meio
        if (safe) {
          const nb1 = this._applyMove(this.board, { from: [row, c], to: [row, midCol] }, this.enPassant);
          if (this._inCheck(nb1, color, this.castling, this.enPassant)) safe = false;
        }
        if (safe) {
          const nb2 = this._applyMove(this.board, move, this.enPassant);
          if (this._inCheck(nb2, color, this.castling, this.enPassant)) safe = false;
        }
        if (safe) legal.push(move);
        continue;
      }

      const nb = this._applyMove(this.board, move, this.enPassant);
      if (!this._inCheck(nb, p.color, this.castling, this.enPassant)) {
        legal.push(move);
      }
    }

    return legal;
  }

  allLegalMoves(color) {
    const all = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (this.board[r][c]?.color === color) {
          all.push(...this.legalMoves(r, c));
        }
      }
    }
    return all;
  }

  /* ===== EXECUTA MOVIMENTO ===== */
  makeMove(from, to, promoteTo = 'Q') {
    const [fr, fc] = from;
    const [tr, tc] = to;
    const legal = this.legalMoves(fr, fc);
    const move = legal.find(m => m.to[0] === tr && m.to[1] === tc);
    if (!move) return false;

    move.promoteTo = promoteTo;
    const p = this.board[fr][fc];
    const target = this.board[tr][tc];

    // Captura
    if (target) this.captured[p.color].push(target.type);
    if (move.enPassant) {
      const capRow = p.color === 'w' ? tr + 1 : tr - 1;
      const epPiece = this.board[capRow][tc];
      if (epPiece) this.captured[p.color].push(epPiece.type);
    }

    // Notação SAN antes de aplicar
    const san = this._san(move, legal);

    // Aplica
    this.board = this._applyMove(this.board, move, this.enPassant);

    // Atualiza direitos de roque
    if (p.type === 'K') {
      this.castling[p.color + 'K'] = false;
      this.castling[p.color + 'Q'] = false;
    }
    if (p.type === 'R') {
      if (fc === 7) this.castling[p.color + 'K'] = false;
      if (fc === 0) this.castling[p.color + 'Q'] = false;
    }

    // En passant
    this.enPassant = move.doublePush ? [tr, tc] : null;
    if (move.doublePush) {
      this.enPassant = p.color === 'w' ? [tr + 1, tc] : [tr - 1, tc];
    }

    this.lastMove = { from, to };
    this.turn = this._enemy(this.turn);

    // Status
    const opMoves = this.allLegalMoves(this.turn);
    const check = this._inCheck(this.board, this.turn, this.castling, this.enPassant);

    if (opMoves.length === 0) {
      this.status = check ? 'checkmate' : 'stalemate';
    } else {
      this.status = check ? 'check' : 'playing';
    }

    // Adiciona sufixo na notação
    let sanFull = san;
    if (this.status === 'checkmate') sanFull += '#';
    else if (this.status === 'check') sanFull += '+';
    this.history.push(sanFull);

    return true;
  }

  /* ===== NOTAÇÃO ALGÉBRICA ===== */
  _san(move, legal) {
    const [fr, fc] = move.from;
    const [tr, tc] = move.to;
    const p = this.board[fr][fc];
    const files = 'abcdefgh';
    const ranks = '87654321';

    if (move.castle === 'K') return 'O-O';
    if (move.castle === 'Q') return 'O-O-O';

    let san = '';
    if (p.type !== 'P') {
      san += p.type;
      // Desambiguação
      const ambiguous = legal.filter(m =>
        m !== move &&
        this.board[m.from[0]]?.[m.from[1]]?.type === p.type &&
        m.to[0] === tr && m.to[1] === tc
      );
      if (ambiguous.length > 0) {
        const sameFile = ambiguous.some(m => m.from[1] === fc);
        const sameRank = ambiguous.some(m => m.from[0] === fr);
        if (!sameFile) san += files[fc];
        else if (!sameRank) san += ranks[fr];
        else san += files[fc] + ranks[fr];
      }
    }

    if (move.capture || move.enPassant) {
      if (p.type === 'P') san += files[fc];
      san += 'x';
    }

    san += files[tc] + ranks[tr];

    if (p.type === 'P' && (tr === 0 || tr === 7)) {
      san += '=' + (move.promoteTo || 'Q');
    }

    return san;
  }

  /* ===== SERIALIZAÇÃO ===== */
  serialize() {
    return {
      board: this.board.map(row => row.map(p => p ? `${p.color}${p.type}` : null)),
      turn: this.turn,
      castling: { ...this.castling },
      enPassant: this.enPassant,
      history: [...this.history],
      captured: { w: [...this.captured.w], b: [...this.captured.b] },
      status: this.status,
      lastMove: this.lastMove
    };
  }

  deserialize(data) {
    this.board = data.board.map(row =>
      row.map(p => p ? { color: p[0], type: p.slice(1) } : null)
    );
    this.turn = data.turn;
    this.castling = { ...data.castling };
    this.enPassant = data.enPassant;
    this.history = [...data.history];
    this.captured = { w: [...data.captured.w], b: [...data.captured.b] };
    this.status = data.status;
    this.lastMove = data.lastMove;
  }
}