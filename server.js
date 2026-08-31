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
            // Sắp xếp level thấp bắn trước, level cao sau
            let sortedPlayers = [];
            if (playerData && playerData.length > 0) {
                sortedPlayers = [...playerData].sort((a, b) => a.level - b.level);
            }

            rooms[roomId] = {
                id: roomId,
                players: sortedPlayers,
                currentIndex: 0,
                wind: (Math.random() * 0.06 - 0.03)
            };
        } else if (playerData && rooms[roomId].players.length === 0) {
            rooms[roomId].players = [...playerData].sort((a, b) => a.level - b.level);
        }

        // Báo cho toàn bộ phòng lượt đầu tiên
        io.to(roomId).emit('turn_changed', {
            nextIndex: rooms[roomId].currentIndex,
            wind: rooms[roomId].wind
        });
    });

    // 2. Đồng bộ di chuyển
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
        let r = rooms[socket.roomId];
        if (r && explodeData.updatedPlayers) {
            explodeData.updatedPlayers.forEach(up => {
                let target = r.players.find(p => p.name === up.name);
                if (target) target.hp = up.hp;
            });
        }
        io.to(socket.roomId).emit('explosion_sync', explodeData);
    });

    // 5. Chuyển lượt (Server là trọng tài tính người kế tiếp)
    socket.on('request_next_turn', () => {
        if (!socket.roomId || !rooms[socket.roomId]) return;
        let r = rooms[socket.roomId];

        let total = r.players.length;
        if (total === 0) return;

        let team1Alive = r.players.some(p => p.team === 1 && p.hp > 0);
        let team2Alive = r.players.some(p => p.team === 2 && p.hp > 0);

        if (!team1Alive || !team2Alive) {
            let winTeam = team1Alive ? 1 : 2;
            io.to(socket.roomId).emit('match_finished', { winningTeam: winTeam });
            return;
        }

        // Tìm người còn sống tiếp theo
        let nextIdx = -1;
        for (let i = 1; i <= total; i++) {
            let candidate = (r.currentIndex + i) % total;
            if (r.players[candidate] && r.players[candidate].hp > 0) {
                nextIdx = candidate;
                break;
            }
        }

        if (nextIdx !== -1) {
            r.currentIndex = nextIdx;
            r.wind = (Math.random() * 0.06 - 0.03);

            io.to(socket.roomId).emit('turn_changed', {
                nextIndex: r.currentIndex,
                wind: r.wind
            });
        }
    });

    // 6. Rút lui
    socket.on('player_surrender', ({ leaverName }) => {
        if (!socket.roomId || !rooms[socket.roomId]) return;
        let r = rooms[socket.roomId];
        let p = r.players.find(pl => pl.name === leaverName);
        if (p) p.hp = 0;

        io.to(socket.roomId).emit('player_left', { leaverName: leaverName });
    });

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
    console.log(`Server Gunny running on port: ${PORT}`);
});
