// server.js
const express = require('express');
const http = require('http');
const socketio = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketio(server);

// Azure/Heroku-style port
const PORT = process.env.PORT || 3000;

// ---------- Static hosting ----------
app.use(express.static(path.join(__dirname, 'public')));
app.use('/assets', express.static(path.join(__dirname, 'public/assets')));

// Health check
app.get('/health', (_req, res) => res.send('ok'));

// ---------- Game state ----------
let currentTheme = '';
let callList = [];
let currentCallIndex = -1;

const playerCards = {};            // playerName => { card1, card2 }
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

// ---------- Socket handlers ----------
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // broadcast player count on connect
  io.emit('player-count', io.engine.clientsCount);

  // clear songs for everyone (big screen listens for this)
  socket.on('clear-songs', () => {
    io.emit('clear-bigscreen');
  });

  // player joins game (playerName is a string)
  socket.on('join-game', (playerName) => {
    // save name for lobby
    if (typeof playerName === 'string' && playerName.trim()) {
      activePlayers.set(socket.id, playerName.trim());
      updateLobby();
    }

    // send current theme + calls so newcomers catch up
    socket.emit('theme', currentTheme);
    socket.emit('call-update', callList.slice(0, currentCallIndex + 1));

    // if a theme is active, provide cards (reuse existing if present)
    if (currentTheme && callList.length > 0 && playerName) {
      if (playerCards[playerName]) {
        socket.emit('generateCard', playerCards[playerName]);
      } else {
        const card1 = shuffle([...callList]).slice(0, 25);
        const card2 = shuffle([...callList]).slice(0, 25);
        playerCards[playerName] = { card1, card2 };
        socket.emit('generateCard', { card1, card2 });
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

  // host confirms/broadcasts a song to all screens
  socket.on('confirmSong', (songTitle) => {
    io.emit('broadcastSong', songTitle);
  });

  // host starts a game with a theme { name, songs }
  socket.on('startgame', (theme) => {
    currentTheme = theme?.name || '';
    callList = shuffle([...(theme?.songs || [])]);
    currentCallIndex = -1;

    io.emit('theme', currentTheme);
    io.emit('call-update', []); // reset calls on clients

    // give each connected client a pair of cards
    for (const [_id, clientSocket] of io.sockets.sockets) {
      const shuffled1 = shuffle([...(theme?.songs || [])]);
      const shuffled2 = shuffle([...(theme?.songs || [])]);
      const card1 = shuffled1.slice(0, 25);
      const card2 = shuffled2.slice(0, 25);
      clientSocket.emit('generateCard', { card1, card2 });
    }
  });

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

// ---------- Start server ----------
server.listen(PORT, () => {
  console.log(`✅ Bingo server listening on :${PORT}`);
});
