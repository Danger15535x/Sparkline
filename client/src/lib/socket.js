import { io } from 'socket.io-client';

let socket = null;
const handlers = new Set();

export function connectSocket(token) {
  if (socket) return socket;
  socket = io('/', {
    path: '/socket.io',
    auth: { token },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 800,
    reconnectionDelayMax: 8000,
    timeout: 15000,
  });
  socket.onAny((event, data) => {
    for (const fn of handlers) {
      try {
        fn(event, data);
      } catch (e) {
        console.error('socket handler error', event, e);
      }
    }
  });
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}

export function getSocket() {
  return socket;
}

export function emit(event, data) {
  if (socket && socket.connected) socket.emit(event, data);
}

export function onSocketEvent(fn) {
  handlers.add(fn);
  return () => handlers.delete(fn);
}