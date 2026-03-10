/**
 * JOYT — Express + WebSocket Server
 * Serves API on /api/* and static React build from /client/dist
 */

const express    = require('express');
const cors       = require('cors');
const http       = require('http');
const path       = require('path');
const { WebSocketServer } = require('ws');
const { router, setBroadcast } = require('./routes');

const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT || 3001;

// ── WebSocket setup ───────────────────────────────────────────────────────
const wss = new WebSocketServer({ server });

const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

// Broadcast JSON to all connected clients
function broadcast(data) {
  const msg = JSON.stringify(data);
  clients.forEach(ws => {
    if (ws.readyState === 1) ws.send(msg);
  });
}

setBroadcast(broadcast);

// ── Middleware ────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── API ───────────────────────────────────────────────────────────────────
app.use('/api', router);

// ── Serve React build in production ──────────────────────────────────────
const DIST = path.join(__dirname, '../client/dist');
app.use(express.static(DIST));
app.get('*', (req, res) => {
  res.sendFile(path.join(DIST, 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n🎸  JOYT server running on http://localhost:${PORT}`);
  console.log(`    WebSocket ready on ws://localhost:${PORT}`);
  console.log(`    API docs: GET /api/players, /api/dashboard, etc.\n`);
});
