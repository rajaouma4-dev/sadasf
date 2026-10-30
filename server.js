const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Room management: roomName -> Map(userId -> WebSocket)
// WebSocket is ONLY for P2P handshake (connecting 2 browsers)
const rooms = new Map();

wss.on('connection', (ws) => {
    let currentRoom = null;
    let userId = null;

    ws.on('error', (err) => console.error('WebSocket client error:', err.message));

    // WEBSOCKET HANDLES ONLY 2 THINGS: JOIN & SIGNALING
    // NO SMS, NO CHAT DATA, NO TURSO TOUCHES WEBSOCKET!
    ws.on('message', (raw) => {
        try {
            const data = JSON.parse(raw);

            switch (data.type) {
                // 1. Peer connects to room
                case 'join': {
                    currentRoom = data.room || 'room-1';
                    userId = data.userId || Math.random().toString(36).substring(2, 9);

                    if (!rooms.has(currentRoom)) {
                        rooms.set(currentRoom, new Map());
                    }

                    const roomClients = rooms.get(currentRoom);
                    roomClients.set(userId, ws);

                    console.log(`[Signaling Setup] Peer [${userId}] joined room [${currentRoom}]. Total: ${roomClients.size}`);

                    // Send list of existing peers to initiate WebRTC DataChannel
                    ws.send(JSON.stringify({
                        type: 'joined',
                        room: currentRoom,
                        userId: userId,
                        peers: Array.from(roomClients.keys()).filter(id => id !== userId)
                    }));

                    // Tell existing peers a new peer joined to establish DataChannel
                    roomClients.forEach((client, peerId) => {
                        if (peerId !== userId && client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({
                                type: 'peer-joined',
                                peerId: userId
                            }));
                        }
                    });
                    break;
                }

                // 2. Exchange WebRTC SDP Offer, Answer, and ICE candidates between peers
                case 'signal': {
                    const { target, signal } = data;
                    if (!currentRoom || !rooms.has(currentRoom)) return;

                    const roomClients = rooms.get(currentRoom);
                    const targetClient = roomClients.get(target);

                    if (targetClient && targetClient.readyState === WebSocket.OPEN) {
                        targetClient.send(JSON.stringify({
                            type: 'signal',
                            sender: userId,
                            signal: signal
                        }));
                    }
                    break;
                }

                default:
                    break;
            }
        } catch (err) {
            console.error('Signaling message error:', err.message);
        }
    });

    ws.on('close', () => {
        if (currentRoom && rooms.has(currentRoom) && userId) {
            const roomClients = rooms.get(currentRoom);
            roomClients.delete(userId);

            roomClients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({
                        type: 'peer-left',
                        peerId: userId
                    }));
                }
            });

            if (roomClients.size === 0) {
                rooms.delete(currentRoom);
            }
        }
    });
});

process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));
process.on('unhandledRejection', (reason) => console.error('Unhandled Rejection:', reason));

server.listen(PORT, '0.0.0.0', () => {
    console.log(`WebRTC Signaling Server running on port ${PORT}`);
    console.log(`WebSocket role: 100% strictly initial P2P connection setup.`);
    console.log(`ALL messages, texts, and real-time data flow ONLY via WebRTC DataChannel.`);
});
