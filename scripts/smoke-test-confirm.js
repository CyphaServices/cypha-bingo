// Simple smoke test: connect and emit confirmSong
const io = require('socket.io-client');
const socket = io('http://localhost:3000');

socket.on('connect', () => {
  console.log('test client connected', socket.id);
  // Wait 1s then emit confirmSong for a song
  setTimeout(() => {
    const song = 'Boots on the Ground - Omar Cunningham';
    console.log('emitting confirmSong ->', song);
    socket.emit('confirmSong', song);
  }, 1000);
});

socket.on('connect_error', (err) => {
  console.error('connect_error', err);
});

socket.on('new-call', (item) => {
  console.log('new-call received by test client:', item);
});

setTimeout(() => {
  console.log('test ending');
  socket.close();
}, 5000);
