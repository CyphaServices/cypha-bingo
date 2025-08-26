// smoke-test-confirm-log.js
// Connect to server, emit confirmSong, and write output to a temporary file.
const io = require('socket.io-client');
const fs = require('fs');
const out = [];
const socket = io('http://localhost:3000');

socket.on('connect', () => {
  out.push(`connected ${socket.id}`);
  // Wait 1s then emit confirmSong for a song
  setTimeout(() => {
    const song = 'Boots on the Ground - Omar Cunningham';
    out.push(`emitting confirmSong -> ${song}`);
    socket.emit('confirmSong', song);
  }, 1000);
});

socket.on('new-call', (item) => {
  out.push(`new-call received by test client: ${item}`);
});

socket.on('connect_error', (err) => {
  out.push('connect_error: ' + err.message);
});

setTimeout(() => {
  fs.writeFileSync('c:/cypha-bingo/scripts/smoke-output.txt', out.join('\n'));
  socket.close();
}, 4000);
