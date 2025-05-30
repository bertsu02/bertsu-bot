const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const WebSocket = require('ws');
const axios = require('axios');
const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static('public'));

const CHATROOM_ID = 255820;
let activePlayer = null;
let activePlayerDisplayName = null;
let safePicks = 0;
let difficulty = 'easy';
let BOMB_COUNT = 5;
let gridSize = 5;
let grid = [];


function calculateMultiplier(gridSize, bombs, picksMade) {
  const totalCells = gridSize * gridSize;
  let survivalProb = 1;
  for (let i = 0; i < picksMade; i++) {
    survivalProb *= (totalCells - bombs - i) / (totalCells - i);
  }
  return 1 / survivalProb;
}

function resetGrid() {
  safePicks = 0;
  grid = Array.from({ length: gridSize }, () =>
    Array.from({ length: gridSize }, () => ({
      revealed: false,
      bomb: false
    }))
  );
  let placed = 0;
  while (placed < BOMB_COUNT) {
    const y = Math.floor(Math.random() * gridSize);
    const x = Math.floor(Math.random() * gridSize);
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
      io.emit('multiplierUpdate', 1);
      io.emit('log', `📛 Grid size: ${gridSize}x${gridSize}, Mines: ${BOMB_COUNT}`);
    }, 3000);
  } else {
    safePicks++;
    const multiplier = calculateMultiplier(gridSize, BOMB_COUNT, safePicks);
    io.emit('log', `✅ ${username} picked safe at (${x + 1}, ${y + 1})! Multiplier: x${multiplier.toFixed(2)}`);
    io.emit('updateGrid', grid);
    io.emit('multiplierUpdate', multiplier);
  }
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

 const isAdmin = ['kevinlowroller','enrogambles','trannhi74','bertsu'].includes(username.toLowerCase());

        if (username.toLowerCase() === activePlayer && content.startsWith('!m')) {
          const count = parseInt(content.split(' ')[1]);
          const maxMines = gridSize * gridSize - 1;

          if (!isNaN(count) && count >= 1 && count <= maxMines) {
            BOMB_COUNT = count;
            resetGrid();
            io.emit('updateGrid', grid);
            io.emit('log', `💣 Number of mines set to ${BOMB_COUNT} by ${username}`);
            io.emit('multiplierUpdate', 1);
          } else {
            io.emit('log', `❌ Invalid mine count. Must be between 1 and ${maxMines}.`);
          }
        }

        if (isAdmin && content.startsWith('!pl')) {
          const newPlayer = content.split(' ')[1];
          activePlayer = newPlayer.toLowerCase();
          activePlayerDisplayName = newPlayer;
          io.emit('activePlayer', activePlayerDisplayName);
          io.emit('log', `🎮 ${username} set active player to ${activePlayerDisplayName}`);
        }
        if (isAdmin && content.startsWith('!cl')) {
          activePlayer = null;
          activePlayerDisplayName = null;
          io.emit('activePlayer', null);
          io.emit('log', `🧹 Active player cleared by ${username}`);
        }
        if (username.toLowerCase() === activePlayer && content.startsWith('!co')) {
          if (!activePlayerDisplayName) {
            io.emit('log', `⚠️ No active player to cash out.`);
          } else {
            io.emit('log', `💰 ${activePlayerDisplayName} wants to cash out! Confirm?`);
            io.emit('showCashoutConfirm');
          }
        }
        if (username.toLowerCase() === activePlayer && content.startsWith('!gs')) {
          const size = parseInt(content.split(' ')[1]);
          if ([5, 6, 7].includes(size)) {
            gridSize = size;
            resetGrid();
            io.emit('updateGrid', grid);
            io.emit('log', `📐 Grid size set to ${size}x${size} by ${username}`);
            io.emit('multiplierUpdate', 1);
          } else {
            io.emit('log', `❌ Invalid grid size. Use 5, 6, 7.`);
          }
        }

        if (content.startsWith('!p') && username.toLowerCase() === activePlayer) {
         const match = content.match(/!p\s+(\d+)/);
if (match) {
  const pickNumber = parseInt(match[1]);
  const index = pickNumber - 1;
  const y = Math.floor(index / gridSize);
  const x = index % gridSize;

  if (pickNumber >= 1 && pickNumber <= gridSize * gridSize) {
    handlePick({ x, y, username });
  } else {
    io.emit('log', `❌ Invalid pick. Choose between 1 and ${gridSize * gridSize}.`);
  }
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
  socket.emit('multiplierUpdate', 1);

  socket.on('confirmCashout', () => {
    const multiplier = calculateMultiplier(gridSize, BOMB_COUNT, safePicks) || 1;
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
