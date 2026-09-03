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
    // 7. Tạo danh sách 9 thẻ bài khi trận đấu kết thúc
    socket.on('match_finished_cards', () => {
        if (!socket.roomId || !rooms[socket.roomId]) return;
        if (!rooms[socket.roomId].cards) {
            // Sinh ngẫu nhiên 9 phần thưởng kiếm khí từ 1 - 50
            const cards = [];
            for (let i = 0; i < 9; i++) {
                cards.push({
                    id: i,
                    reward: Math.floor(Math.random() * 50) + 1,
                    openedBy: null
                });
            }
            rooms[socket.roomId].cards = cards;
            io.to(socket.roomId).emit('cards_board_ready', { cards });
        }
    });

    // 8. Đồng bộ khi có người bấm lật thẻ
    socket.on('pick_card', ({ cardIndex, playerName }) => {
        if (!socket.roomId || !rooms[socket.roomId] || !rooms[socket.roomId].cards) return;
        const card = rooms[socket.roomId].cards[cardIndex];
        if (card && !card.openedBy) {
            card.openedBy = playerName;
            io.to(socket.roomId).emit('card_opened', {
                cardIndex,
                playerName,
                reward: card.reward
            });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Gunny Socket Server đang chạy tại port: ${PORT}`);
});
