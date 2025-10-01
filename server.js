/**
 * server.js — Cypha Bingo Socket/HTTP server
 * ------------------------------------------
 * What this does:
 *  - Serves the static front-end (host.html, bigscreen.html, client assets)
 *  - Manages live game state (theme, calls, player list, bingo claims)
 *  - Broadcasts updates over Socket.IO to all connected screens
 *  - Persists minimal state (player cards per game) with lowdb
 *
 * Key events (Socket.IO):
 *  - announcement            : set/clear the scrolling ticker on all screens
 *  - clear-songs             : tell bigscreen to clear the called list
 *  - join-game               : player joins; resolves name; returns cards if game active
 *  - pattern-change          : host sets bingo pattern (e.g., lines, corners)
 *  - previewSong             : host previews next song (echoed back to host)
 *  - confirmSong             : host confirms/broadcasts a song to everyone
 *  - startgame/start-game    : host starts a new game with { name, songs[] }
 *  - next-call               : advance to next call from the shuffled list
 *  - bingo-claim             : player shouts BINGO; broadcast an alert
 *
 * Notes:
 *  - There must be EXACTLY ONE "const io = ..." line. Do not redeclare `io`.
 *  - Sending an empty string for `announcement` will CLEAR the ticker on bigscreen.
 */

const path = require('path');
const http = require('http');
const express = require('express');
const socketio = require('socket.io');

// --- Lightweight JSON persistence (cards per game, current game id) ---
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');

const app = express();
const server = http.createServer(app);

// IMPORTANT: single io declaration (do not duplicate this)
const io = socketio(server);

// Use env PORT if provided (Azure/Heroku/etc.), default to 3000 for local dev
const PORT = process.env.PORT || 3000;

/* ------------------------------------------------------------------ */
/* Static file hosting                                                 */
/* ------------------------------------------------------------------ */

// Serve everything in /public at the site root.
// Example: http://localhost:3000/host.html or /bigscreen.html
app.use(express.static(path.join(__dirname, 'public')));

// Serve client.html at the root URL
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'client.html'));
});

// Optional health check for uptime monitors
app.get('/health', (_req, res) => res.send('ok'));

/* ------------------------------------------------------------------ */
/* In-memory game state (resets when server restarts)                  */
/* ------------------------------------------------------------------ */

// Current theme name (string shown in UIs)
let currentTheme = '';

// The full shuffled list of songs for the CURRENT game
let callList = [];

// Index pointer to the most recent call in callList (-1 means no calls yet)
let currentCallIndex = -1;

// Unique id for the current game (used to namespace persisted cards)
let currentGameId = null;

// Historical list of CONFIRMED calls (for convenience on reconnects)
let calledHistory = [];

// Map of gameId -> { playerName -> { card1:[], card2:[] } }
// Used to give a player the SAME cards if they refresh/rejoin the current game
let playerCardsByGame = {};

// Map socket.id -> playerName (tracks lobby/connected users)
const activePlayers = new Map();

// Last announcement text (used to initialize late joiners / refreshes)
let lastAnnouncement = '';

/* ------------------------------------------------------------------ */
/* Utilities                                                           */
/* ------------------------------------------------------------------ */

// Fisher–Yates shuffle (pure; returns a NEW array)
function shuffle(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Broadcast the current lobby player list to everyone
function updateLobby() {
  const names = Array.from(activePlayers.values());
  io.emit('player-list', names);
}

/* ------------------------------------------------------------------ */
/* lowdb setup (very small JSON DB for persistence across restarts)    */
/* ------------------------------------------------------------------ */

const dbFile = path.join(__dirname, 'data', 'bingo-db.json');
const adapter = new JSONFile(dbFile);
const db = new Low(adapter);

async function loadDb() {
  try {
    const fs = require('fs');
    const dataDir = path.dirname(dbFile);
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    await db.read();
    db.data = db.data || { currentGameId: null, playerCardsByGame: {} };

    // Initialize from saved data
    currentGameId = db.data.currentGameId || null;
    playerCardsByGame = db.data.playerCardsByGame || {};

    console.log('🔁 DB loaded. Known games:', Object.keys(playerCardsByGame).length);
  } catch (err) {
    console.warn('⚠️ Could not read DB:', err.message);
    db.data = { currentGameId: null, playerCardsByGame: {} };
  }
}

async function saveDb() {
  try {
    db.data = db.data || {};
    db.data.currentGameId = currentGameId;
    db.data.playerCardsByGame = playerCardsByGame;
    await db.write();
  } catch (err) {
    console.warn('⚠️ Could not write DB:', err.message);
  }
}

/* ------------------------------------------------------------------ */
/* Socket.IO handlers                                                  */
/* ------------------------------------------------------------------ */

io.on('connection', (socket) => {
  console.log(`👋 Client connected: ${socket.id}`);

  // Let everyone know how many are connected (rough pulse)
  io.emit('player-count', io.engine.clientsCount);

  // Send initial state to JUST the new client so refreshes don’t look empty
  socket.emit('game-info', { gameId: currentGameId, theme: currentTheme });
  socket.emit('call-update', calledHistory.slice()); // last known confirmed calls
  socket.emit('player-list', Array.from(activePlayers.values()));
  socket.emit('announcement', lastAnnouncement);      // show current ticker immediately

  /* ---------------------- Announcement (ticker) -------------------- */
  // Host emits: socket.emit('announcement', 'Tonight: 2-for-1 wings!');
  // NOTE: An empty string '' is a valid payload to CLEAR the ticker.
  socket.on('announcement', (txt) => {
    lastAnnouncement = typeof txt === 'string' ? txt : '';
    io.emit('announcement', lastAnnouncement); // broadcast to all screens
  });

  /* ----------------------- Bigscreen controls ---------------------- */
  // Host wants to clear the visible list on the big screen
  socket.on('clear-songs', () => {
    io.emit('clear-bigscreen');
  });

  /* --------------------------- Lobby join -------------------------- */
  // Payload can be a string name or an object { name, resume }
  socket.on('join-game', (payload) => {
    // Normalize payload
    let name = '';
    let resume = false;
    if (typeof payload === 'string') {
      name = payload.trim();
    } else if (payload && typeof payload === 'object') {
      name = typeof payload.name === 'string' ? payload.name.trim() : '';
      resume = payload.resume === true;
    }

    if (!name) {
      socket.emit('join-failed', 'Invalid name');
      return;
    }

    // If resuming, reclaim the same name from an older socket
    if (resume) {
      const prev = Array.from(activePlayers.entries()).find(([, pname]) => pname === name);
      if (prev) {
        const [prevSid] = prev;
        if (prevSid !== socket.id) {
          console.log(`🔁 Reclaiming '${name}' from ${prevSid}`);
          activePlayers.delete(prevSid);
        }
      }
    }

    // Enforce unique visible names among currently connected players (unless resuming)
    let finalName = name;
    if (!resume) {
      const taken = Array.from(activePlayers.values()).includes(finalName);
      if (taken) {
        let suffix = 2;
        while (Array.from(activePlayers.values()).includes(`${name}#${suffix}`)) suffix++;
        finalName = `${name}#${suffix}`;
        socket.emit('name-disambiguated', finalName);
      }
    }

    // Register and broadcast lobby list
    activePlayers.set(socket.id, finalName);
    updateLobby();

    // Bring the player up to speed on calls so far (for current game)
    socket.emit('call-update', callList.slice(0, currentCallIndex + 1));

    // Let the client confirm the resolved name and current game info
    socket.emit('join-accepted', finalName);
    socket.emit('game-info', { gameId: currentGameId, theme: currentTheme });

    // If there is an active game, give this player their cards (and persist them)
    if (currentGameId && currentTheme && callList.length > 0) {
      playerCardsByGame[currentGameId] = playerCardsByGame[currentGameId] || {};
      const cardsForGame = playerCardsByGame[currentGameId];

      if (cardsForGame[finalName]) {
        // Already had cards for this game (e.g., refresh)
        socket.emit('generateCard', cardsForGame[finalName]);
      } else {
        // Create new cards (25 unique items per card from the theme’s songs)
        const card1 = shuffle([...callList]).slice(0, 25);
        const card2 = shuffle([...callList]).slice(0, 25);
        cardsForGame[finalName] = { card1, card2 };
        socket.emit('generateCard', { card1, card2 });
        saveDb();
      }
    }
  });

  /* ---------------------- Pattern + song flow ---------------------- */

  // Host selects a different win pattern (all UIs update)
  socket.on('pattern-change', (pattern) => {
    io.emit('bingo-pattern', pattern);
  });

  // Host previews a song (only echo back to the host who requested it)
  socket.on('previewSong', (songTitle) => {
    socket.emit('previewSong', songTitle);
  });

  // Host confirms/broadcasts a song to EVERYONE
  socket.on('confirmSong', (songTitle) => {
    calledHistory.push(songTitle);        // track confirmed song for reconnects
    io.emit('broadcastSong', songTitle);  // legacy event some screens may use
    io.emit('new-call', songTitle);       // primary event
  });

  /* --------------------------- Start game -------------------------- */

  // Accept both legacy ('startgame') and current ('start-game') event names
  function handleStartGame(theme) {
    // theme shape: { name: '80s', songs: ['Song A', 'Song B', ...] }
    currentGameId = `game_${Date.now()}`;        // unique id for namespacing cards
    currentTheme = theme?.name || '';
    callList = shuffle([...(theme?.songs || [])]);
    currentCallIndex = -1;
    calledHistory = [];                           // fresh confirmed-call history

    // Reset calls on clients and broadcast current game meta
    io.emit('call-update', []);
    io.emit('game-info', { gameId: currentGameId, theme: currentTheme });

    // Drop all previous games’ cards (keeps memory small)
    for (const gid in playerCardsByGame) {
      if (Object.prototype.hasOwnProperty.call(playerCardsByGame, gid)) {
        delete playerCardsByGame[gid];
      }
    }
    playerCardsByGame[currentGameId] = {};

    // Give each currently connected socket two new cards for THIS game
    for (const [id, clientSocket] of io.sockets.sockets) {
      const shuffled1 = shuffle([...(theme?.songs || [])]);
      const shuffled2 = shuffle([...(theme?.songs || [])]);
      const card1 = shuffled1.slice(0, 25);
      const card2 = shuffled2.slice(0, 25);

      // If we know the player's name, save their cards under that name
      const playerName = activePlayers.get(id);
      if (playerName) {
        playerCardsByGame[currentGameId][playerName] = { card1, card2 };
      }

      clientSocket.emit('generateCard', { card1, card2 });
    }

    saveDb();
  }

  socket.on('startgame', handleStartGame);
  socket.on('start-game', handleStartGame);

  /* ------------------------- Next call step ------------------------ */

  socket.on('next-call', () => {
    if (currentCallIndex + 1 < callList.length) {
      currentCallIndex++;
      io.emit('new-call', callList[currentCallIndex]);
    }
  });

  /* --------------------------- Bingo claim ------------------------- */

  socket.on('bingo-claim', (name) => {
    io.emit('bingo-alert', `${name} says BINGO!`);
  });

  /* -------------------------- Disconnects ------------------------- */

  socket.on('disconnect', () => {
    activePlayers.delete(socket.id);
    updateLobby();
    io.emit('player-count', io.engine.clientsCount);
    console.log(`👋 Client disconnected: ${socket.id}`);
  });
});

/* ------------------------------------------------------------------ */
/* Boot the server (after DB is loaded)                                */
/* ------------------------------------------------------------------ */

(async () => {
  await loadDb();
  server.listen(PORT, () => {
    console.log(`✅ Bingo server listening on http://localhost:${PORT}`);
  });
})();
