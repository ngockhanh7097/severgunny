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
    // 1. Tham gia phòng đấu
    socket.on('join_room', ({ roomId, playerName, playerData }) => {
        socket.join(roomId);
        socket.roomId = roomId;
        socket.playerName = playerName;

        if (!rooms[roomId]) {
            let sortedPlayers = [];
            if (playerData && playerData.length > 0) {
                sortedPlayers = [...playerData].sort((a, b) => a.level - b.level);
            }

            rooms[roomId] = {
                id: roomId,
                players: sortedPlayers,
                currentIndex: 0,
                isLocking: false,
                wind: (Math.random() * 0.06 - 0.03)
            };
        } else if (playerData && rooms[roomId].players.length === 0) {
            rooms[roomId].players = [...playerData].sort((a, b) => a.level - b.level);
        }

        io.to(roomId).emit('turn_changed', {
            nextIndex: rooms[roomId].currentIndex,
            wind: rooms[roomId].wind
        });
    });

    // 2. Đồng bộ di chuyển 60 FPS
    socket.on('player_move', (moveData) => {
        if (!socket.roomId) return;
        socket.to(socket.roomId).emit('opponent_moved', moveData);
    });

    // 3. Lệnh Bắn
    socket.on('player_fire', (fireData) => {
        let r = rooms[socket.roomId];
        if (!r || r.isLocking) return;
        r.isLocking = true; // Khóa phòng ngay khi có lệnh bắn
        io.to(socket.roomId).emit('bullet_fired', fireData);
    });

    // 4. Đồng bộ Đạn nổ & Trừ máu
    socket.on('bullet_exploded', (explodeData) => {
        if (!socket.roomId) return;
        let r = rooms[socket.roomId];
        if (r && explodeData.updatedPlayers) {
            explodeData.updatedPlayers.forEach(up => {
                let target = r.players.find(p => p.name === up.name);
                if (target) target.hp = up.hp;
            });
        }
        io.to(socket.roomId).emit('explosion_sync', explodeData);
    });

    // 5. Yêu cầu chuyển lượt từ Client (Có đệm 1.5s xử lý an toàn)
    socket.on('request_next_turn', () => {
        if (!socket.roomId || !rooms[socket.roomId]) return;
        advanceTurnWithBuffer(socket.roomId);
    });

    // 6. Rút lui
    socket.on('player_surrender', ({ leaverName }) => {
        if (!socket.roomId || !rooms[socket.roomId]) return;
        let r = rooms[socket.roomId];
        let p = r.players.find(pl => pl.name === leaverName);
        if (p) p.hp = 0;

        io.to(socket.roomId).emit('player_left', { leaverName: leaverName });
        advanceTurnWithBuffer(socket.roomId);
    });

    function advanceTurnWithBuffer(roomId) {
        let r = rooms[roomId];
        if (!r) return;

        let total = r.players.length;
        if (total === 0) return;

        let team1Alive = r.players.some(p => p.team === 1 && p.hp > 0);
        let team2Alive = r.players.some(p => p.team === 2 && p.hp > 0);

        if (!team1Alive || !team2Alive) {
            let winTeam = team1Alive ? 1 : 2;
            io.to(roomId).emit('match_finished', { winningTeam: winTeam });
            return;
        }

        // Thông báo phòng bước vào giai đoạn đệm chuyển lượt
        io.to(roomId).emit('turn_buffering');

        setTimeout(() => {
            if (!rooms[roomId]) return;
            let currentRoom = rooms[roomId];

            let nextIdx = -1;
            for (let i = 1; i <= total; i++) {
                let candidate = (currentRoom.currentIndex + i) % total;
                if (currentRoom.players[candidate] && currentRoom.players[candidate].hp > 0) {
                    nextIdx = candidate;
                    break;
                }
            }

            if (nextIdx !== -1) {
                currentRoom.currentIndex = nextIdx;
                currentRoom.isLocking = false; // Mở khóa phòng cho người tiếp theo
                currentRoom.wind = (Math.random() * 0.06 - 0.03);

                io.to(roomId).emit('turn_changed', {
                    nextIndex: currentRoom.currentIndex,
                    wind: currentRoom.wind
                });
            }
        }, 1500); // Đệm đúng 1.5 giây
    }

    socket.on('disconnect', () => {
        if (socket.roomId && rooms[socket.roomId] && socket.playerName) {
            let r = rooms[socket.roomId];
            let p = r.players.find(pl => pl.name === socket.playerName);
            if (p) p.hp = 0;
            io.to(socket.roomId).emit('player_left', { leaverName: socket.playerName });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Gunny Server chạy tại port: ${PORT}`);
});
