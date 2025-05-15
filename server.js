const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
let joinKeyword = '!join';
const joinedUsers = new Set();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const CHATROOM_ID = 15856785;
const ws = new WebSocket('wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.4.0-rc2&flash=false');

ws.on('open', () => {
  console.log('✅ Connected to Kick WebSocket');
  const subscribePayload = {
    event: 'pusher:subscribe',
    data: {
      auth: '',
      channel: `chatrooms.${CHATROOM_ID}.v2`
    }
  };
  ws.send(JSON.stringify(subscribePayload));
});

ws.on('message', (raw) => {
  try {
    const parsed = JSON.parse(raw);
    if (parsed.event === 'App\\Events\\ChatMessageEvent') {
      const data = JSON.parse(parsed.data);
      const content = data?.content?.toLowerCase();
      const username = data?.sender?.username;

      if (content?.includes(joinKeyword) && username) {
        if (!joinedUsers.has(username)) {
          joinedUsers.add(username);
          console.log(`✅ ${username} joined`);
          io.emit('update', Array.from(joinedUsers));
        }
      }
    }
  } catch (err) {
    console.error('❌ Error parsing message:', err.message);
  }
});


ws.on('close', () => {
  console.log('⚠️ WebSocket closed');
});

ws.on('error', (err) => {
  console.error('❌ WebSocket error:', err.message);
});

io.on('connection', (socket) => {
 socket.emit('update', Array.from(joinedUsers));
  socket.emit('keyword', joinKeyword);

  socket.on('setKeyword', (newKeyword) => {
    joinKeyword = newKeyword.trim().toLowerCase();
    console.log(`🔑 Join keyword set to: ${joinKeyword}`);
  });

  socket.on('roll', () => {
    if (joinedUsers.size > 0) {
      const usersArray = Array.from(joinedUsers);
      const winner = usersArray[Math.floor(Math.random() * usersArray.length)];
      joinedUsers.delete(winner);
      io.emit('update', Array.from(joinedUsers));
      io.emit('winner', winner);
      console.log(`🎉 Winner: ${winner}`);
    }
  });

  socket.on('reset', () => {
    joinedUsers.clear();
    io.emit('update', []);
    io.emit('winner', null);
    console.log('🔄 Participants reset');
  });
});

server.listen(3000, () => {
  console.log('🚀 App running at http://localhost:3000');
});
