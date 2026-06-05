import type { Tool } from '../../types'
import { APP_VERSION } from '../../../version'
import { readFileSync } from 'node:fs'

function getPlatform(): string {
  const p = process.platform
  if (p === 'win32') return 'Windows'
  if (p === 'darwin') return 'macOS'
  if (p === 'linux') {
    if (process.env.WSL_DISTRO_NAME) return `WSL (${process.env.WSL_DISTRO_NAME})`
    try {
      const ver = readFileSync('/proc/version', 'utf-8')
      if (ver.includes('Microsoft') || ver.includes('WSL')) return 'WSL'
    } catch { /* not WSL */ }
    return 'Linux'
  }
  return p
}

export const systemTools: Tool[] = [
  {
    name: 'system_status',
    description: 'Get TaskMeld server status including uptime, version, and resource usage.',
    parameters: { type: 'object', properties: {}, required: [] },
    annotations: { readOnly: true, destructive: false, requiresConfirmation: false, idempotent: true },
    permission: 'auto',
    async execute() {
      return {
        output: JSON.stringify({
          status: 'running',
          version: APP_VERSION,
          platform: getPlatform(),
          currentTime: new Date().toISOString().replace('T', ' ').slice(0, 19),
          uptime: process.uptime(),
          memory: process.memoryUsage(),
        }, null, 2),
        isError: false,
      }
    },
  },
  {
    name: 'system_gateway',
    description: 'Get OpenClaw Gateway connection status.',
    parameters: { type: 'object', properties: {}, required: [] },
    annotations: { readOnly: true, destructive: false, requiresConfirmation: false, idempotent: true },
    permission: 'auto',
    async execute() {
      return {
        output: JSON.stringify({
          connected: false,
          message: 'Gateway status will be populated from real service data.',
        }, null, 2),
        isError: false,
      }
    },
  },
]
