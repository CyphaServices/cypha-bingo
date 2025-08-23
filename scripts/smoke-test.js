// Simple smoke test that simulates a host starting a game and one client joining via socket.io-client
const { io } = require('socket.io-client');

const serverUrl = process.env.SERVER_URL || 'http://localhost:3000';

async function run() {
  console.log('Starting smoke test against', serverUrl);
  const host = io(serverUrl);

  host.on('connect', () => {
    console.log('Host connected as', host.id);

    // Start a fake game
    host.emit('startgame', { name: 'Smoke Test Theme', songs: Array.from({length: 30}, (_,i)=>`Song ${i+1}`) });

    setTimeout(()=>{
      host.disconnect();
      console.log('Host disconnected');
    }, 2000);
  });

  const client = io(serverUrl);
  client.on('connect', () => {
    console.log('Client connected as', client.id);
    client.emit('join-game', 'SmokePlayer');
  });

  client.on('generateCard', (data) => {
    console.log('Client received card, sample tile:', data.card1[0]);
    client.disconnect();
  });
}

run().catch(err=>console.error('Smoke test error', err));
