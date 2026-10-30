const { createClient } = require('@libsql/client');

// Turso configuration for muta database in org wrrrr
const TURSO_URL = process.env.TURSO_DATABASE_URL || 'libsql://muta-wrrrr.turso.io';
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN || 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3OTMzOTQyMTMsImlkIjoiMDFhMThlOWYtZTUwMS03NTQ5LTkxNTctNzBlYjQwNDQyZWJiIiwia2lkIjoiWm41cHZkYzdvdmVMTnlCczF5X0VXMHFyS3dHNGRlR0sxdDJwa0M5Z1l6ayIsInJpZCI6IjI3OGQ5ODc3LWM4NzAtNDQ3MC05NjAxLWM0NjNjYjFiMjhhMSJ9.IjE59BQAR8FBZfFQ4o_tZ2hP_f9KqSoWCRIN33fZWLfvMOtQv3g18o_rEJQKCjkVrWirCZJHatnizQj4fjXZCw';

const client = createClient({
    url: TURSO_URL,
    authToken: TURSO_AUTH_TOKEN
});

// Memory cache fallback in case of transient network drop
const memoryStore = [];

async function initDb() {
    try {
        await client.execute(`
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                room TEXT NOT NULL,
                sender_id TEXT NOT NULL,
                message TEXT NOT NULL,
                channel TEXT DEFAULT 'webrtc-server-datachannel',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ CONNECTED TO TURSO CLOUD DATABASE: muta (org: wrrrr)');
    } catch (err) {
        console.warn('Turso init warning:', err.message);
    }
}

async function saveMessage({ room, senderId, message, channel = 'webrtc-server-datachannel' }) {
    try {
        const res = await client.execute({
            sql: `INSERT INTO messages (room, sender_id, message, channel) VALUES (?, ?, ?, ?)`,
            args: [room, senderId, message, channel]
        });
        const id = Number(res.lastInsertRowid) || Date.now();
        console.log(`[Turso Cloud DB] Saved message ID #${id}`);
        return {
            id,
            room,
            sender_id: senderId,
            message,
            channel,
            db: 'Turso Cloud (muta)'
        };
    } catch (e) {
        console.warn('Turso insert warning, using memory fallback:', e.message);
        const fallbackMsg = {
            id: memoryStore.length + 1,
            room,
            sender_id: senderId,
            message,
            channel,
            created_at: new Date().toLocaleTimeString(),
            db: 'In-Memory'
        };
        memoryStore.push(fallbackMsg);
        return fallbackMsg;
    }
}

async function getMessages(room) {
    try {
        const res = await client.execute({
            sql: `SELECT id, room, sender_id, message, channel, created_at FROM messages WHERE room = ? ORDER BY id ASC`,
            args: [room]
        });
        return res.rows.map(r => ({
            id: r.id,
            room: r.room,
            sender_id: r.sender_id,
            message: r.message,
            channel: r.channel,
            created_at: r.created_at,
            source: 'Turso Cloud (muta)'
        }));
    } catch (e) {
        console.warn('Turso query warning:', e.message);
        return memoryStore.filter(m => m.room === room);
    }
}

module.exports = {
    initDb,
    saveMessage,
    getMessages
};
