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
    // 1. Khởi tạo / Tham gia phòng
    socket.on('join_room', ({ roomId, playerName, playerData }) => {
        socket.join(roomId);
        socket.roomId = roomId;
        socket.playerName = playerName;

        if (!rooms[roomId]) {
            rooms[roomId] = {
                id: roomId,
                players: [],
                currentIdx: 0,
                isFiring: false,
                wind: (Math.random() * 0.06 - 0.03)
            };
        }

        // Cập nhật danh sách người chơi
        if (playerData && playerData.length > 0) {
            // Sắp xếp level thấp bắn trước, level cao bắn sau
            rooms[roomId].players = playerData.sort((a, b) => a.level - b.level);
        }

        // Báo cho toàn bộ phòng lượt đầu tiên
        io.to(roomId).emit('turn_changed', {
            nextIndex: rooms[roomId].currentIdx,
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
        if (!r || r.isFiring) return;
        r.isFiring = true;
        io.to(socket.roomId).emit('bullet_fired', fireData);
    });

    // 4. Đạn nổ & Chuyển lượt DUY NHẤT từ Server
    socket.on('bullet_exploded', (explodeData) => {
        let r = rooms[socket.roomId];
        if (!r) return;

        // Cập nhật máu của danh sách người chơi
        if (explodeData.updatedPlayers) {
            explodeData.updatedPlayers.forEach(up => {
                let target = r.players.find(p => p.name === up.name);
                if (target) target.hp = up.hp;
            });
        }

        io.to(socket.roomId).emit('explosion_sync', explodeData);

        // Server tự động chuyển lượt
        advanceTurn(socket.roomId);
    });

    // 5. Bỏ lượt
    socket.on('request_pass_turn', () => {
        advanceTurn(socket.roomId);
    });

    // 6. Rút lui / Thoát trận
    socket.on('player_surrender', ({ leaverName }) => {
        let r = rooms[socket.roomId];
        if (!r) return;

        let p = r.players.find(pl => pl.name === leaverName);
        if (p) p.hp = 0;

        io.to(socket.roomId).emit('player_left', { leaverName: leaverName });
        advanceTurn(socket.roomId);
    });

    function advanceTurn(roomId) {
        let r = rooms[roomId];
        if (!r) return;

        r.isFiring = false;

        let team1Alive = r.players.some(p => p.team === 1 && p.hp > 0);
        let team2Alive = r.players.some(p => p.team === 2 && p.hp > 0);

        // Nếu 1 team đã chết hết sạch -> Kết thúc trận
        if (!team1Alive || !team2Alive) {
            let winningTeam = team1Alive ? 1 : 2;
            io.to(roomId).emit('match_finished', { winningTeam: winningTeam });
            return;
        }

        // Tìm người còn sống tiếp theo theo vòng tròn
        let nextIdx = -1;
        let total = r.players.length;

        for (let i = 1; i <= total; i++) {
            let candidate = (r.currentIdx + i) % total;
            if (r.players[candidate] && r.players[candidate].hp > 0) {
                nextIdx = candidate;
                break;
            }
        }

        if (nextIdx !== -1) {
            r.currentIdx = nextIdx;
            r.wind = (Math.random() * 0.06 - 0.03);

            io.to(roomId).emit('turn_changed', {
                nextIndex: r.currentIdx,
                wind: r.wind
            });
        }
    }

    socket.on('disconnect', () => {
        let r = rooms[socket.roomId];
        if (r && socket.playerName) {
            let p = r.players.find(pl => pl.name === socket.playerName);
            if (p) p.hp = 0;
            io.to(socket.roomId).emit('player_left', { leaverName: socket.playerName });
            advanceTurn(socket.roomId);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Gunny Server chạy tại port: ${PORT}`);
});
