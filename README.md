# WebRTC DataChannel Signaling Server

A clean, production-ready WebSocket signaling backend and WebRTC DataChannel tester configured with Google's public STUN servers.

## Features
- **Signaling via WebSocket (`ws`)**: Peer discovery, SDP offer/answer exchange, ICE candidate signaling.
- **Google STUN Servers**:
  - `stun:stun.l.google.com:19302`
  - `stun:stun1.l.google.com:19302`
  - `stun:stun2.l.google.com:19302`
- **Render Ready**: Binds to `0.0.0.0` and uses `process.env.PORT`.
- **Built-in UI**: Open the URL in two separate tabs/browsers to test direct peer-to-peer messaging.

---

## Deploying on Render (Free Web Service)

1. Push this folder to a GitHub repository.
2. Log into [Render Dashboard](https://dashboard.render.com/).
3. Click **New +** -> **Web Service**.
4. Select your GitHub repository.
5. Fill in the build settings:
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Plan**: `Free`
6. Click **Deploy Web Service**.
7. Open the generated Render HTTPS link in two browser tabs or devices, type the same room name, click **Connect Room**, and start sending messages over the peer-to-peer DataChannel!
