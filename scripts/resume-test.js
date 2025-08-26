const { io } = require('socket.io-client');
const serverUrl = process.env.SERVER_URL || 'http://localhost:3000';

async function run() {
  console.log('Resume test against', serverUrl);
  const client1 = io(serverUrl);
  client1.on('connect', () => {
    console.log('client1 connected', client1.id);
    client1.emit('join-game', 'Resumer');
  });
  client1.on('join-accepted', (name) => {
    console.log('client1 join-accepted', name);
    // disconnect after short delay
    setTimeout(()=>{
      client1.disconnect();
      console.log('client1 disconnected');
      // now connect client2 and attempt resume
      const client2 = io(serverUrl);
      client2.on('connect', () => {
        console.log('client2 connected', client2.id);
        client2.emit('join-game', { name: 'Resumer', resume: true });
      });
      client2.on('join-accepted', (name)=>{
        console.log('client2 join-accepted', name);
        client2.disconnect();
      });
    }, 800);
  });
}

run().catch(err=>console.error('err', err));
