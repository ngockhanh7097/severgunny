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

function buildAlternatingTurnQueue(players) {
    let team1 = players.filter(p => p.team === 1).sort((a, b) => a.level - b.level);
    let team2 = players.filter(p => p.team === 2).sort((a, b) => a.level - b.level);

    let queue = [];
    let maxLen = Math.max(team1.length, team2.length);

    for (let i = 0; i < maxLen; i++) {
        if (team1[i]) queue.push(team1[i].name);
        if (team2[i]) queue.push(team2[i].name);
    }
    return queue;
}

io.on('connection', (socket) => {
    socket.on('init_match_server', ({ roomId, hostName, playersList }) => {
        socket.join(roomId);
        socket.roomId = roomId;
        socket.playerName = hostName;

        if (!rooms[roomId]) {
            let turnQueue = buildAlternatingTurnQueue(playersList);
            rooms[roomId] = {
                id: roomId,
                players: playersList,
                turnQueue: turnQueue,
                currentQueuePointer: 0,
                turnId: 1,
                state: 'AIMING',
                wind: (Math.random() * 0.06 - 0.03)
            };
        }

        let firstPlayerName = rooms[roomId].turnQueue[rooms[roomId].currentQueuePointer];
        io.to(roomId).emit('match_initialized', {
            currentTurnName: firstPlayerName,
            turnId: rooms[roomId].turnId,
            wind: rooms[roomId].wind
        });
    });

    socket.on('join_match_socket', ({ roomId, playerName }) => {
        socket.join(roomId);
        socket.roomId = roomId;
        socket.playerName = playerName;
    });

    socket.on('player_move', (moveData) => {
        if (!socket.roomId) return;
        socket.to(socket.roomId).emit('opponent_moved', moveData);
    });

    socket.on('player_fire', (fireData) => {
        let r = rooms[socket.roomId];
        if (!r || r.state !== 'AIMING' || fireData.turnId !== r.turnId) return;

        r.state = 'FLYING';
        io.to(socket.roomId).emit('bullet_fired', fireData);
    });

    socket.on('bullet_exploded', (explodeData) => {
        let r = rooms[socket.roomId];
        if (!r || explodeData.turnId !== r.turnId) return;

        if (explodeData.updatedPlayers) {
            explodeData.updatedPlayers.forEach(up => {
                let target = r.players.find(p => p.name === up.name);
                if (target) target.hp = up.hp;
            });
        }

        io.to(socket.roomId).emit('explosion_sync', explodeData);
        advanceToNextTurn(socket.roomId);
    });

    socket.on('request_pass_turn', (data) => {
        let r = rooms[socket.roomId];
        if (!r || r.state !== 'AIMING' || data.turnId !== r.turnId) return;
        advanceToNextTurn(socket.roomId);
    });

    socket.on('player_surrender', () => {
        handlePlayerExit(socket.roomId, socket.playerName);
    });

    socket.on('disconnect', () => {
        if (socket.roomId && socket.playerName) {
            handlePlayerExit(socket.roomId, socket.playerName);
        }
    });

    function handlePlayerExit(roomId, playerName) {
        let r = rooms[roomId];
        if (!r) return;

        let p = r.players.find(pl => pl.name === playerName);
        if (p) p.hp = 0;

        io.to(roomId).emit('player_left', { leaverName: playerName });

        let currentTurnName = r.turnQueue[r.currentQueuePointer];
        if (currentTurnName === playerName || r.state === 'AIMING') {
            advanceToNextTurn(roomId);
        }
    }

    function advanceToNextTurn(roomId) {
        let r = rooms[roomId];
        if (!r) return;

        let alivePlayers = r.players.filter(p => p.hp > 0);
        let team1Alive = alivePlayers.some(p => p.team === 1);
        let team2Alive = alivePlayers.some(p => p.team === 2);

        if (!team1Alive || !team2Alive) {
            r.state = 'GAME_OVER';
            return;
        }

        let nextName = null;
        let totalSlots = r.turnQueue.length;

        for (let step = 1; step <= totalSlots; step++) {
            let nextPointer = (r.currentQueuePointer + step) % totalSlots;
            let candidateName = r.turnQueue[nextPointer];
            let candidate = r.players.find(p => p.name === candidateName);

            if (candidate && candidate.hp > 0) {
                r.currentQueuePointer = nextPointer;
                nextName = candidateName;
                break;
            }
        }

        if (nextName) {
            r.turnId++;
            r.state = 'AIMING';
            r.wind = (Math.random() * 0.06 - 0.03);

            io.to(roomId).emit('turn_changed', {
                currentTurnName: nextName,
                turnId: r.turnId,
                wind: r.wind
            });
        }
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server Gunny Socket.io running on port: ${PORT}`);
});
