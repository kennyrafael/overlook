/**
 * Preload for the Overlook window. Runs sandboxed with context isolation.
 * Exposes only static, read-only facts; no IPC channels yet. When IPC is added
 * (e.g. the native folder picker), expose one function per action and validate
 * every argument in the main process.
 */
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('overlook', Object.freeze({
  desktop: true,
  platform: process.platform,
}));
