const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const rooms = {};

io.on('connection', (socket) => {
    // 1. Tham gia phòng đấu
    socket.on('join_room', ({ roomId, playerName, playerData }) => {
        socket.join(roomId);
        socket.roomId = roomId;
        socket.playerName = playerName;

        if (!rooms[roomId]) {
            rooms[roomId] = {
                id: roomId,
                players: {},
                currentTurnIndex: 0,
                wind: (Math.random() * 0.06 - 0.03)
            };
        }

        rooms[roomId].players[socket.id] = {
            id: socket.id,
            name: playerName,
            ...playerData
        };

        io.to(roomId).emit('room_state_update', rooms[roomId]);
    });

    // 2. Đồng bộ di chuyển & góc ngắm thời gian thực
    socket.on('player_move', (moveData) => {
        if (!socket.roomId) return;
        socket.to(socket.roomId).emit('opponent_moved', moveData);
    });

    // 3. Lệnh Bắn
    socket.on('player_fire', (fireData) => {
        if (!socket.roomId) return;
        io.to(socket.roomId).emit('bullet_fired', fireData);
    });

    // 4. Đồng bộ Đạn nổ, Trừ máu & Đào đất
    socket.on('bullet_exploded', (explodeData) => {
        if (!socket.roomId) return;
        io.to(socket.roomId).emit('explosion_sync', explodeData);
    });

    // 5. Chuyển lượt đa người chơi
    socket.on('request_next_turn', ({ nextIndex, nextWind }) => {
        if (!socket.roomId || !rooms[socket.roomId]) return;
        rooms[socket.roomId].currentTurnIndex = nextIndex;
        rooms[socket.roomId].wind = nextWind;

        io.to(socket.roomId).emit('turn_changed', {
            nextIndex: nextIndex,
            wind: nextWind
        });
    });

    // 6. Đầu hàng / Thoát trận
    socket.on('player_surrender', () => {
        if (!socket.roomId) return;
        io.to(socket.roomId).emit('player_left', { leaverName: socket.playerName });
    });

    socket.on('disconnect', () => {
        if (socket.roomId && rooms[socket.roomId]) {
            delete rooms[socket.roomId].players[socket.id];
            io.to(socket.roomId).emit('player_left', { leaverName: socket.playerName });
            if (Object.keys(rooms[socket.roomId].players).length === 0) {
                delete rooms[socket.roomId];
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Gunny Socket Server đang chạy tại port: ${PORT}`);
});
