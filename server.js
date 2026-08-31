const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const rooms = {};

io.on('connection', (socket) => {
    // 1. Tham gia phòng đấu (Host và Guest dùng chung 1 hàm)
    socket.on('join_room', ({ roomId, playerName }) => {
        socket.join(roomId);
        socket.roomId = roomId;
        socket.playerName = playerName;

        if (!rooms[roomId]) {
            rooms[roomId] = {
                id: roomId,
                currentIndex: 0,
                wind: (Math.random() * 0.06 - 0.03)
            };
        }
    });

    // 2. Đồng bộ di chuyển 60 FPS
    socket.on('player_move', (moveData) => {
        if (!socket.roomId) return;
        socket.to(socket.roomId).emit('opponent_moved', moveData);
    });

    // 3. Lệnh Bắn
    socket.on('player_fire', (fireData) => {
        if (!socket.roomId) return;
        io.to(socket.roomId).emit('bullet_fired', fireData);
    });

    // 4. Đồng bộ Đạn nổ & Trừ máu
    socket.on('bullet_exploded', (explodeData) => {
        if (!socket.roomId) return;
        io.to(socket.roomId).emit('explosion_sync', explodeData);
    });

    // 5. Chuyển lượt
    socket.on('request_next_turn', ({ nextIndex, nextWind }) => {
        if (!socket.roomId || !rooms[socket.roomId]) return;
        rooms[socket.roomId].currentIndex = nextIndex;
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
            io.to(socket.roomId).emit('player_left', { leaverName: socket.playerName });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Gunny Server chạy tại port: ${PORT}`);
});
