// server.js
const express = require('express');
const http = require('http');
const socketio = require('socket.io');
const path = require('path');
// persistence
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');

const app = express();
const server = http.createServer(app);
const io = socketio(server);

// Azure/Heroku-style port
const PORT = process.env.PORT || 3000;

// ---------- Static hosting ----------
app.use(express.static(path.join(__dirname, 'public')));
app.use('/assets', express.static(path.join(__dirname, 'public/assets')));

// Always serve the client HTML at root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'client.html'));
});

// Health check
app.get('/health', (_req, res) => res.send('ok'));

// ---------- Game state ----------
let currentTheme = '';
let callList = [];
let currentCallIndex = -1;
let currentGameId = null;
let calledHistory = []; // chronological list of confirmed calls
let currentAnnouncement = '';

// playerCardsByGame maps gameId => { playerName => { card1, card2 } }
let playerCardsByGame = {};
const activePlayers = new Map();   // socket.id => playerName

function shuffle(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function updateLobby() {
  const names = Array.from(activePlayers.values());
  io.emit('player-list', names);
}

// --- lowdb setup (simple file persistence) ---
const dbFile = path.join(__dirname, 'data', 'bingo-db.json');
const adapter = new JSONFile(dbFile);
const db = new Low(adapter);

async function loadDb() {
  try {
  // ensure data directory exists
  const fs = require('fs');
  const dataDir = path.dirname(dbFile);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    await db.read();
    db.data = db.data || { currentGameId: null, playerCardsByGame: {} };
    currentGameId = db.data.currentGameId || null;
    playerCardsByGame = db.data.playerCardsByGame || {};
    console.log('🔁 Loaded DB:', Object.keys(playerCardsByGame).length, 'games');
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

// ---------- Socket handlers ----------
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // broadcast player count on connect
  io.emit('player-count', io.engine.clientsCount);

  // send current state to the newly connected socket so hosts/bigscreen
  // that simply reload do not appear empty. This includes game metadata,
  // call history up to the current index, and the lobby player list.
  socket.emit('game-info', { gameId: currentGameId, theme: currentTheme });
  socket.emit('call-update', calledHistory.slice());
  socket.emit('player-list', Array.from(activePlayers.values()));
  // send current announcement so bigscreen reflects latest on refresh
  socket.emit('announcement', currentAnnouncement);

  // clear songs for everyone (big screen listens for this)
  socket.on('clear-songs', () => {
    io.emit('clear-bigscreen');
  });

  // host sets/clears announcement ticker
  socket.on('announcement', (txt) => {
    currentAnnouncement = typeof txt === 'string' ? txt : '';
    io.emit('announcement', currentAnnouncement);
  });

  // player joins game (accepts string name or object { name, resume })
  socket.on('join-game', (payload) => {
    // extract name and resume flag from either a string or object payload
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

    // If resuming, reclaim the name from any previous socket mapping so this
    // socket becomes the authoritative session for that player.
    if (resume) {
      const prev = Array.from(activePlayers.entries()).find(([, pname]) => pname === name);
      if (prev) {
        const [prevSid] = prev;
        if (prevSid !== socket.id) {
          console.log(`🔁 Reclaiming name '${name}' from previous socket ${prevSid}`);
          activePlayers.delete(prevSid);
        }
      }
    }

    // enforce unique player names among currently connected sockets unless
    // the client is explicitly resuming
    let finalName = name;
    if (!resume) {
      const nameTaken = Array.from(activePlayers.entries()).some(([sid, pname]) => pname === finalName && sid !== socket.id);
      if (nameTaken) {
        // automatic disambiguation: append #n
        let suffix = 2;
        while (Array.from(activePlayers.values()).includes(`${name}#${suffix}`)) suffix++;
        finalName = `${name}#${suffix}`;
        socket.emit('name-disambiguated', finalName);
      }
    }

  // register player using resolved name (may have been disambiguated or reclaimed)
  console.log(`➡️ join-game payload:`, payload, `-> resolved: ${finalName} (resume: ${resume})`);
  activePlayers.set(socket.id, finalName);
    updateLobby();

  // send current theme + calls so newcomers catch up
  // (deprecated) 'theme' event removed in favor of the structured 'game-info' event
    socket.emit('call-update', callList.slice(0, currentCallIndex + 1));

  // Accept join so client can show UI (return the resolved name)
  socket.emit('join-accepted', finalName);
  // Send current game info to the joining socket so late-joiners / refreshes
  // immediately receive the active theme and game id.
  socket.emit('game-info', { gameId: currentGameId, theme: currentTheme });

    // if a theme is active, provide cards for the current game (namespace by gameId)
    if (currentGameId && currentTheme && callList.length > 0) {
      playerCardsByGame[currentGameId] = playerCardsByGame[currentGameId] || {};
      const cardsForGame = playerCardsByGame[currentGameId];

      if (cardsForGame[finalName]) {
        socket.emit('generateCard', cardsForGame[finalName]);
      } else {
        const card1 = shuffle([...callList]).slice(0, 25);
        const card2 = shuffle([...callList]).slice(0, 25);
        cardsForGame[finalName] = { card1, card2 };
        socket.emit('generateCard', { card1, card2 });
        // persist new assignment
        saveDb();
      }
    }
  });

  // host changes the bingo pattern
  socket.on('pattern-change', (pattern) => {
    io.emit('bingo-pattern', pattern);
  });

  // host previews a song (echo back to host)
  socket.on('previewSong', (songTitle) => {
    socket.emit('previewSong', songTitle);
  });

  // late joiners can explicitly request cards for the current game
  socket.on('request-cards', (maybeName) => {
    if (!currentGameId || !currentTheme || callList.length === 0) return;
    const name = (typeof maybeName === 'string' && maybeName.trim()) || activePlayers.get(socket.id);
    if (!name) return;

    playerCardsByGame[currentGameId] = playerCardsByGame[currentGameId] || {};
    const cardsForGame = playerCardsByGame[currentGameId];

    if (cardsForGame[name]) {
      socket.emit('generateCard', cardsForGame[name]);
    } else {
      const card1 = shuffle([...callList]).slice(0, 25);
      const card2 = shuffle([...callList]).slice(0, 25);
      cardsForGame[name] = { card1, card2 };
      socket.emit('generateCard', { card1, card2 });
      saveDb();
    }
  });

  // host confirms/broadcasts a song to all screens
  socket.on('confirmSong', (songTitle) => {
  // persist the confirmed call in server history and broadcast
  calledHistory.push(songTitle);
  io.emit('broadcastSong', songTitle);
  io.emit('new-call', songTitle);
  });

  // host starts a game with a theme { name, songs }
  const startGame = (theme) => {
    // create a new game id (timestamp-based) so stored cards are namespaced
    currentGameId = `game_${Date.now()}`;
    currentTheme = theme?.name || '';
    callList = shuffle([...(theme?.songs || [])]);
    currentCallIndex = -1;
    calledHistory = [];

    // (deprecated) 'theme' event removed; clients should use 'game-info'
    io.emit('call-update', []); // reset calls on clients

    // broadcast game info for clients (useful for debugging / display)
    io.emit('game-info', { gameId: currentGameId, theme: currentTheme });

    // clear previous games' stored cards to free memory
    for (const gid in playerCardsByGame) {
      if (Object.prototype.hasOwnProperty.call(playerCardsByGame, gid)) {
        delete playerCardsByGame[gid];
      }
    }

    playerCardsByGame[currentGameId] = {};

    // give each connected client a pair of cards and store them for resume
    for (const [id, clientSocket] of io.sockets.sockets) {
      const shuffled1 = shuffle([...(theme?.songs || [])]);
      const shuffled2 = shuffle([...(theme?.songs || [])]);
      const card1 = shuffled1.slice(0, 25);
      const card2 = shuffled2.slice(0, 25);

      // if we know the player's name (they joined lobby), save their cards so
      // rejoining with the same name resumes the current game's cards
      const playerName = activePlayers.get(id);
      if (playerName) {
        playerCardsByGame[currentGameId][playerName] = { card1, card2 };
      }

      clientSocket.emit('generateCard', { card1, card2 });
    }
    // persist new game state
    saveDb();
  };

  // Support both legacy and new event names
  socket.on('startgame', startGame);
  socket.on('start-game', startGame);

  // host advances to next call
  socket.on('next-call', () => {
    if (currentCallIndex + 1 < callList.length) {
      currentCallIndex++;
      io.emit('new-call', callList[currentCallIndex]);
    }
  });

  // player claims bingo
  socket.on('bingo-claim', (name) => {
    io.emit('bingo-alert', `${name} says BINGO!`);
  });

  // disconnect cleanup
  socket.on('disconnect', () => {
    activePlayers.delete(socket.id);
    updateLobby();
    io.emit('player-count', io.engine.clientsCount);
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// ---------- Start server (ensure DB is loaded first) ----------
(async () => {
  await loadDb();
  server.listen(PORT, () => {
    console.log(`✅ Bingo server listening on :${PORT}`);
  });
})();
