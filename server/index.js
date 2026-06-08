const { createChessWebSocketServer } = require('./ws-server');

// Usa a porta definida no ambiente ou 3000 como padrao local.
const PORT = Number(process.env.PORT) || 3000;

createChessWebSocketServer(PORT);
