/**
 * Frontend URL helpers — backend, Supabase, MCP server URLs.
 * File: src/config/baseUrls.js
 */
import urlConfig from "../../config/appUrls.json";

const DEFAULT_API_PORT = import.meta.env.VITE_API_PORT || urlConfig.local.apiPort;

export function resolveBackendUrl() {
  const configured = import.meta.env.VITE_SOCKET_URL?.trim();
  if (configured) {
    return configured.replace(/\/$/, "");
  }

  const { protocol, hostname, host } = window.location;
  const isLocalDev =
    import.meta.env.DEV ||
    hostname === "localhost" ||
    hostname === "127.0.0.1";

  if (isLocalDev) {
    return `${protocol}//${hostname}:${DEFAULT_API_PORT}`;
  }

  return `${protocol}//${host}`;
}

export const APP_URLS = {
  get backend() {
    return resolveBackendUrl();
  },

  mcpServer: (
    import.meta.env.VITE_MCP_SERVER_URL || urlConfig.local.mcpServerUrl
  ).replace(/\/$/, ""),

  supabase: import.meta.env.VITE_SUPABASE_URL || "",

  supabaseEdgeFunction(name) {
    return `${this.supabase}/functions/v1/${name}`;
  },

  openai: urlConfig.openai,


  openWeather: urlConfig.openWeather,
  serpApi: urlConfig.serpApi,
  allOrigins: urlConfig.allOrigins,
};

/** Backend API / Socket.IO server URL */
export const socketURL = resolveBackendUrl();
