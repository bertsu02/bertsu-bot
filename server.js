const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const WebSocket = require('ws');
const axios = require('axios');
const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static('public'));

const CHATROOM_ID = 303210;
let activePlayer = null;
let activePlayerDisplayName = null;
let safePicks = 0;
let difficulty = 'easy';
let BOMB_COUNT = 5;
const SIZE = 5;
let grid = [];

const multipliers = {
  1: [1.01, 1.08, 1.12, 1.18, 1.24, 1.31, 1.37, 1.46, 1.55, 1.65, 1.77, 1.9, 2.06, 2.25, 2.47, 2.75, 3.09, 3.54, 4.12, 4.95, 6.19, 8.25, 12.37, 24.75],
  2: [1.08, 1.17, 1.29, 1.41, 1.56, 1.74, 1.94, 2.18, 2.47, 2.93, 3.26, 3.81, 4.5, 5.4, 6.6, 8.25, 10.61, 14.14, 19.8, 29.7, 49.5, 99, 297],
  3: [1.14, 1.29, 1.48, 1.65, 1.84, 2.09, 2.58, 2.99, 3.55, 4.29, 5.16, 6.28, 7.5, 9.25, 11.7, 14.85, 18.83, 25.03, 37.95, 56.03, 113.85, 227.7, 569.3, 2277],
  5: [1.26, 1.46, 1.74, 2.09, 2.58, 3.2, 4.1, 5.2, 6.88, 9.07, 12.65, 17.52, 25.04, 37.95, 56.03, 83.4, 120.21, 250.4, 529.8, 1523],
  7: [1.37, 1.65, 2.09, 2.79, 3.68, 5.09, 6.96, 9.65, 13.4, 18.75, 25.94, 35.89, 59.64, 99.39, 178.91, 351.87, 834.9, 2504, 8768, 52598],
  10: [1.55, 2.18, 3.2, 4.61, 6.85, 10.31, 15.53, 23.46, 36.5, 56.6, 83.2, 138.66, 277.33, 600.87, 1442, 2965, 107059, 2022545]
};

function getMultiplier(picks, bombs) {
  return multipliers[bombs]?.[picks - 1] || null;
}

function resetGrid() {
  safePicks = 0;
  grid = Array.from({ length: SIZE }, () =>
    Array.from({ length: SIZE }, () => ({
      revealed: false,
      bomb: false
    }))
  );
  let placed = 0;
  while (placed < BOMB_COUNT) {
    const y = Math.floor(Math.random() * SIZE);
    const x = Math.floor(Math.random() * SIZE);
    if (!grid[y][x].bomb) {
      grid[y][x].bomb = true;
      placed++;
    }
  }
}

function handlePick({ x, y, username }) {
  const cell = grid[y]?.[x];
  if (!cell || cell.revealed) return;
  cell.revealed = true;

  if (cell.bomb) {
    io.emit('log', `💥 ${username} hit a bomb at (${x + 1}, ${y + 1})!`);
    io.emit('updateGrid', grid);
    io.emit('bombHit', { x, y });
    setTimeout(() => {
      resetGrid();
      io.emit('updateGrid', grid);
      io.emit('log', `🧼 Grid reset. Difficulty: ${difficulty.toUpperCase()} (${BOMB_COUNT} mines)`);
      io.emit('multiplierUpdate', multiplier || 1);
    }, 3000);
  } else {
    safePicks++;
    const multiplier = getMultiplier(safePicks, BOMB_COUNT);
    io.emit('log', `✅ ${username} picked safe at (${x + 1}, ${y + 1})! Multiplier: x${multiplier?.toFixed(2) || '1.00'}`);
    io.emit('updateGrid', grid);
  }
  const multiplier = getMultiplier(safePicks, BOMB_COUNT);
  io.emit('multiplierUpdate', multiplier || 1);

}

function connectToKickChat() {
  const ws = new WebSocket('wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.4.0-rc2&flash=false');

  ws.on('open', () => {
    console.log('✅ Connected to Kick WebSocket');
    ws.send(JSON.stringify({
      event: 'pusher:subscribe',
      data: {
        auth: '',
        channel: `chatrooms.${CHATROOM_ID}.v2`
      }
    }));
  });

  ws.on('message', (raw) => {
    try {
      const parsed = JSON.parse(raw);
      if (parsed.event === 'App\\Events\\ChatMessageEvent') {
        const data = JSON.parse(parsed.data);
        const content = data?.content?.toLowerCase();
        const username = data?.sender?.username;

        if (!username || !content) return;

        const isAdmin = ['bertsu', 'metron'].includes(username.toLowerCase());

        if (isAdmin && content.startsWith('!player')) {
          const newPlayer = content.split(' ')[1];
          activePlayer = newPlayer.toLowerCase();
          activePlayerDisplayName = newPlayer;
          io.emit('activePlayer', activePlayerDisplayName);
          io.emit('log', `🎮 ${username} set active player to ${activePlayerDisplayName}`);
        }
        if (isAdmin && content.startsWith('!clearplayer')) {
          activePlayer = null;
          activePlayerDisplayName = null;
          io.emit('activePlayer', null);
          io.emit('log', `🧹 Active player cleared by ${username}`);
        }
        if (username.toLowerCase() === activePlayer && content.startsWith('!cashout')) {
          if (!activePlayerDisplayName) {
            io.emit('log', `⚠️ No active player to cash out.`);
          } else {
            io.emit('log', `💰 ${activePlayerDisplayName} wants to cash out! Confirm?`);
            io.emit('showCashoutConfirm');
          }
        }

        if (username.toLowerCase() === activePlayer && content.startsWith('!easy')) {
          difficulty = 'easy'; BOMB_COUNT = 5;
          resetGrid();
          io.emit('updateGrid', grid);
          io.emit('log', `⚙️ Difficulty set to EASY`);
        }
        if (username.toLowerCase() === activePlayer && content.startsWith('!medium')) {
          difficulty = 'medium'; BOMB_COUNT = 7;
          resetGrid();
          io.emit('updateGrid', grid);
          io.emit('log', `⚙️ Difficulty set to MEDIUM`);
        }
        if (username.toLowerCase() === activePlayer && content.startsWith('!hard')) {
          difficulty = 'hard'; BOMB_COUNT = 10;
          resetGrid();
          io.emit('updateGrid', grid);
          io.emit('log', `⚙️ Difficulty set to HARD`);
        }

        if (content.startsWith('!pick') && username.toLowerCase() === activePlayer) {
          const match = content.match(/!pick\s+(\d+)[, ]+(\d+)/);
          if (match) {
            const x = parseInt(match[1]) - 1;
            const y = parseInt(match[2]) - 1;
            handlePick({ x, y, username });
          }
        }
      }
    } catch (err) {
      console.error('❌ Error parsing message:', err.message);
    }
  });

  ws.on('close', () => {
    console.log('⚠️ WebSocket closed. Reconnecting...');
    setTimeout(connectToKickChat, 3000);
  });

  ws.on('error', (err) => {
    console.error('❌ WebSocket error:', err.message);
    ws.close();
  });
}

resetGrid();
connectToKickChat();

io.on('connection', (socket) => {
  socket.emit('updateGrid', grid);
  socket.emit('activePlayer', activePlayerDisplayName);
  socket.on('confirmCashout', () => {
    const multiplier = getMultiplier(safePicks, BOMB_COUNT) || 1;
    io.emit('log', `💰 ${activePlayerDisplayName} cashed out at x${multiplier.toFixed(2)}!`);
    activePlayer = null;
    activePlayerDisplayName = null;
    io.emit('activePlayer', null);
    resetGrid();
    io.emit('updateGrid', grid);
    io.emit('multiplierUpdate', 1);
  });
  socket.on('pick', ({ x, y }) => {
    if (activePlayer !== 'web user') {
      socket.emit('log', '⛔ Not your turn.');
    } else {
      handlePick({ x, y, username: 'Web User' });
    }
  });
});


server.listen(3000, () => {
  console.log('🚀 Game running on http://localhost:3000');
});
