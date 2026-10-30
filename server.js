const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Room management: roomName -> Map(userId -> WebSocket)
const rooms = new Map();

wss.on('connection', (ws) => {
    let currentRoom = null;
    let userId = null;

    ws.on('error', (err) => console.error('WebSocket client error:', err.message));

    ws.on('message', async (raw) => {
        try {
            const data = JSON.parse(raw);

            switch (data.type) {
                case 'join': {
                    currentRoom = data.room || 'room-1';
                    userId = data.userId || Math.random().toString(36).substring(2, 9);

                    if (!rooms.has(currentRoom)) {
                        rooms.set(currentRoom, new Map());
                    }

                    const roomClients = rooms.get(currentRoom);
                    roomClients.set(userId, ws);

                    console.log(`[Signaling] User [${userId}] joined room [${currentRoom}]. Total in room: ${roomClients.size}`);

                    // Send joined event with existing peers
                    ws.send(JSON.stringify({
                        type: 'joined',
                        room: currentRoom,
                        userId: userId,
                        peers: Array.from(roomClients.keys()).filter(id => id !== userId)
                    }));

                    // Send database history
                    db.getMessages(currentRoom).then(history => {
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({
                                type: 'history',
                                messages: history
                            }));
                        }
                    }).catch(console.error);

                    // Notify other peers in room to initiate WebRTC DataChannel
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

                // Signaling: exchange SDP offer/answer between peers for WebRTC DataChannel
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

                // When SMS is sent via WebRTC DataChannel, Server saves it to Turso DB:
                case 'save-db-sms': {
                    const { text } = data;
                    if (!text || !currentRoom) return;

                    console.log(`[Turso DB] Saving SMS from User [${userId}]: "${text}"`);
                    const saved = await db.saveMessage({
                        room: currentRoom,
                        senderId: userId,
                        message: text,
                        channel: 'webrtc-datachannel'
                    });

                    // Broadcast saved confirmation with DB #ID to room peers
                    const roomClients = rooms.get(currentRoom);
                    if (roomClients) {
                        roomClients.forEach((client) => {
                            if (client.readyState === WebSocket.OPEN) {
                                client.send(JSON.stringify({
                                    type: 'db-ack',
                                    id: saved.id,
                                    senderId: userId,
                                    text: text,
                                    db: saved.db,
                                    created_at: new Date().toLocaleTimeString()
                                }));
                            }
                        });
                    }
                    break;
                }

                default:
                    break;
            }
        } catch (err) {
            console.error('Error handling message:', err.message);
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

db.initDb().then(() => {
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`WebRTC P2P DataChannel Signaling Server running on port ${PORT}`);
        console.log(`Turso Cloud Database connected: muta (org: wrrrr)`);
    });
});
