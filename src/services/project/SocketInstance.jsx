/**
 * Alternate Socket.IO instance for project-level events.
 * File: src/services/project/SocketInstance.jsx
 */
\n
import { io } from "socket.io-client";
import { socketURL } from "../config/baseUrls.js";

export { socketURL } from "../config/baseUrls.js";

const socketPath = "/socket.io/";

const socketConfig = {
  path: socketPath,
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 10000,
};

let socket;

export const getSocket = () => {
  if (!socket) {
    socket = io(socketURL, socketConfig);
  }
  return socket;
};
