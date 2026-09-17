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
            const currentRoom = rooms[socket.roomId];
            delete currentRoom.players[socket.id];
            
            // Chỉ thông báo rút lui nếu trận đấu đang diễn ra và chưa vào màn lật thẻ
            if (currentRoom.status === "PLAYING" && !currentRoom.cards) {
                io.to(socket.roomId).emit('player_left', { leaverName: socket.playerName });
            }

            if (Object.keys(currentRoom.players).length === 0) {
                delete rooms[socket.roomId];
            }
        }
    });
    // 7. Tạo danh sách thẻ bài khi kết thúc trận (Phân loại PvP 9 thẻ & Phó bản 12 thẻ)
    socket.on('match_finished_cards', (matchInfo) => {
        if (!socket.roomId || !rooms[socket.roomId]) return;
        const currentRoom = rooms[socket.roomId];

        if (!currentRoom.cards) {
            const mode = (matchInfo && matchInfo.mode) || currentRoom.mode || "pvp";
            const dungeonId = (matchInfo && matchInfo.dungeonId) || currentRoom.dungeonId || "linh_son_1";

            const isDungeon = (mode === "phoban");
            const totalCards = isDungeon ? 12 : 9;
            const cards = [];

            const ironWeapons = ["kiem_sat", "riu_sat", "dinh_sat"];
            const bronzeWeapons = ["kiem_dong", "riu_dong", "dinh_dong"];

            for (let i = 0; i < totalCards; i++) {
                let rewardItem = null;

                if (!isDungeon) {
                    // PvP: 1 - 50 Kiếm khí
                    rewardItem = {
                        type: "kiemkhi",
                        amount: Math.floor(Math.random() * 50) + 1
                    };
                } else if (dungeonId === "linh_son_1") {
                    // Ải 1: 9% rơi vũ khí Sắt, còn lại rơi 5/10/15/20 Kiếm khí
                    const roll = Math.random() * 100;
                    if (roll < 9) {
                        const randomWp = ironWeapons[Math.floor(Math.random() * ironWeapons.length)];
                        rewardItem = { type: "weapon", weaponKey: randomWp, amount: 1 };
                    } else {
                        const kiemkhiValues = [5, 10, 15, 20];
                        const amount = kiemkhiValues[Math.floor(Math.random() * kiemkhiValues.length)];
                        rewardItem = { type: "kiemkhi", amount: amount };
                    }
                } else {
                    // Ải 2: 3% vũ khí Đồng, 15% vũ khí Sắt, còn lại rơi 10/20/30/40 Kiếm khí
                    const roll = Math.random() * 100;
                    if (roll < 3) {
                        const randomWp = bronzeWeapons[Math.floor(Math.random() * bronzeWeapons.length)];
                        rewardItem = { type: "weapon", weaponKey: randomWp, amount: 1 };
                    } else if (roll < 18) { // 3% + 15% = 18%
                        const randomWp = ironWeapons[Math.floor(Math.random() * ironWeapons.length)];
                        rewardItem = { type: "weapon", weaponKey: randomWp, amount: 1 };
                    } else {
                        const kiemkhiValues = [10, 20, 30, 40];
                        const amount = kiemkhiValues[Math.floor(Math.random() * kiemkhiValues.length)];
                        rewardItem = { type: "kiemkhi", amount: amount };
                    }
                }

                cards.push({
                    id: i,
                    reward: rewardItem,
                    openedBy: null
                });
            }

            currentRoom.cards = cards;
            io.to(socket.roomId).emit('cards_board_ready', { cards, isDungeon });
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
