const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { RTCPeerConnection } = require('werift');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// Only serve static HTML/CSS/JS frontend files - ZERO HTTP data APIs!
app.use(express.static(path.join(__dirname, 'public')));

// Google STUN servers for WebRTC
const STUN_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
];

// Room state: roomName -> Map(userId -> { ws, pc, dataChannel })
const rooms = new Map();

wss.on('connection', (ws) => {
    let currentRoom = null;
    let userId = null;
    let serverPc = null;
    let serverDc = null;

    ws.on('error', (err) => console.error('WebSocket error:', err.message));

    // WebSocket is used ONLY for initial WebRTC signaling (connect two peers / peer-to-server)
    ws.on('message', async (raw) => {
        try {
            const data = JSON.parse(raw);

            switch (data.type) {
                // 1. Initial join to establish WebRTC DataChannel
                case 'join': {
                    currentRoom = data.room || 'room-1';
                    userId = data.userId || Math.random().toString(36).substring(2, 9);

                    if (!rooms.has(currentRoom)) {
                        rooms.set(currentRoom, new Map());
                    }

                    // Setup Server-side RTCPeerConnection for this user
                    serverPc = new RTCPeerConnection({ iceServers: STUN_SERVERS });

                    // Server listens for the WebRTC DataChannel created by Client
                    serverPc.ondatachannel = (event) => {
                        serverDc = event.channel;
                        console.log(`[WebRTC DataChannel] Established with User [${userId}] in room [${currentRoom}]`);

                        const clientObj = rooms.get(currentRoom)?.get(userId);
                        if (clientObj) {
                            clientObj.dataChannel = serverDc;
                        }

                        // Send database history to new user ONLY over WebRTC DataChannel (NO HTTP!)
                        db.getMessages(currentRoom).then(history => {
                            if (serverDc && serverDc.readyState === 'open') {
                                serverDc.send(JSON.stringify({
                                    type: 'history',
                                    messages: history
                                }));
                            }
                        }).catch(console.error);

                        // -----------------------------------------------------------------
                        // USER A SENDS SMS VIA WEBRTC DATACHANNEL ONLY:
                        // -----------------------------------------------------------------
                        serverDc.onmessage = async (msgEvent) => {
                            try {
                                const payload = JSON.parse(msgEvent.data);
                                console.log(`[WebRTC DataChannel Received from User ${userId}]: "${payload.text}"`);

                                // 1. SERVER SAVES TO DATABASE ONLY
                                const saved = await db.saveMessage({
                                    room: currentRoom,
                                    senderId: userId,
                                    message: payload.text,
                                    channel: 'webrtc-datachannel'
                                });
                                console.log(`[Database Saved in Turso Cloud muta] ID #${saved.id}`);

                                // 2. SEND CONFIRMATION BACK TO SENDER VIA WEBRTC DATACHANNEL ONLY
                                if (serverDc.readyState === 'open') {
                                    serverDc.send(JSON.stringify({
                                        type: 'sms-saved',
                                        id: saved.id,
                                        senderId: userId,
                                        text: payload.text,
                                        db: saved.db,
                                        created_at: new Date().toLocaleTimeString()
                                    }));
                                }

                                // 3. SERVER FORWARDS SMS TO USER B (AND ALL PEERS) VIA WEBRTC DATACHANNEL ONLY
                                const roomClients = rooms.get(currentRoom);
                                if (roomClients) {
                                    roomClients.forEach((peerObj, peerId) => {
                                        if (peerId !== userId && peerObj.dataChannel && peerObj.dataChannel.readyState === 'open') {
                                            console.log(`[WebRTC DataChannel Sending from Server to User ${peerId}] Delivering SMS #${saved.id}`);
                                            peerObj.dataChannel.send(JSON.stringify({
                                                type: 'incoming-sms',
                                                id: saved.id,
                                                senderId: userId,
                                                text: payload.text,
                                                db: saved.db,
                                                created_at: new Date().toLocaleTimeString()
                                            }));
                                        }
                                    });
                                }
                            } catch (err) {
                                console.error('Error handling WebRTC DataChannel message:', err.message);
                            }
                        };
                    };

                    // Send Server ICE candidate to Client for initial WebRTC setup
                    serverPc.onicecandidate = (event) => {
                        if (event.candidate && ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({
                                type: 'server-candidate',
                                candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate
                            }));
                        }
                    };

                    rooms.get(currentRoom).set(userId, {
                        ws,
                        pc: serverPc,
                        dataChannel: null
                    });

                    // Notify client of successful signaling join
                    ws.send(JSON.stringify({
                        type: 'joined',
                        room: currentRoom,
                        userId: userId
                    }));

                    break;
                }

                // WebRTC Offer for initial DataChannel handshake
                case 'client-offer': {
                    if (!serverPc) return;
                    await serverPc.setRemoteDescription({
                        type: data.offer.type,
                        sdp: data.offer.sdp
                    });
                    const serverAnswer = await serverPc.createAnswer();
                    await serverPc.setLocalDescription(serverAnswer);

                    ws.send(JSON.stringify({
                        type: 'server-answer',
                        answer: {
                            type: serverAnswer.type,
                            sdp: serverAnswer.sdp
                        }
                    }));
                    break;
                }

                // ICE candidate for initial DataChannel handshake
                case 'client-candidate': {
                    if (serverPc && data.candidate) {
                        try {
                            await serverPc.addIceCandidate(data.candidate);
                        } catch (e) {
                            console.error('Error adding client candidate:', e.message);
                        }
                    }
                    break;
                }

                default:
                    break;
            }
        } catch (err) {
            console.error('WebSocket signaling error:', err.message);
        }
    });

    ws.on('close', () => {
        if (currentRoom && userId && rooms.has(currentRoom)) {
            const roomClients = rooms.get(currentRoom);
            if (serverDc) {
                try { serverDc.close(); } catch (_) {}
            }
            if (serverPc) {
                try { serverPc.close(); } catch (_) {}
            }
            roomClients.delete(userId);
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
        console.log(`WebRTC DataChannel Server running on http://localhost:${PORT}`);
        console.log(`All SMS messages flow strictly over WebRTC DataChannel (NO HTTP APIs)`);
    });
});
