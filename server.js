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

    socket.on('player_move', (moveData) => {
        if (!socket.roomId) return;
        socket.to(socket.roomId).emit('opponent_moved', moveData);
    });

    socket.on('player_fire', (fireData) => {
        if (!socket.roomId) return;
        io.to(socket.roomId).emit('bullet_fired', fireData);
    });

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

    socket.on('request_next_turn', ({ nextIndex, nextWind }) => {
        if (!socket.roomId || !rooms[socket.roomId]) return;
        let r = rooms[socket.roomId];

        let team1Alive = r.players.some(p => p.team === 1 && p.hp > 0);
        let team2Alive = r.players.some(p => p.team === 2 && p.hp > 0);

        if (!team1Alive || !team2Alive) {
            let winTeam = team1Alive ? 1 : 2;
            io.to(socket.roomId).emit('match_finished', { winningTeam: winTeam });
            return;
        }

        r.currentIndex = nextIndex;
        r.wind = nextWind;

        io.to(socket.roomId).emit('turn_changed', {
            nextIndex: r.currentIndex,
            wind: r.wind
        });
    });

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
