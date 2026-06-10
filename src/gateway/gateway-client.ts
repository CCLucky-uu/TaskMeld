import { WebSocket } from "ws"
import type { RawData } from "ws"
import { createHash, createPrivateKey, generateKeyPairSync, randomUUID, sign } from "node:crypto"
import { promises as fs } from "node:fs"
import type { GatewayConnectParams, GatewayEventFrame, GatewayFrame, GatewayResFrame, HelloOkPayload } from "./types"
import { sanitizeGatewayFrame } from "./frame-sanitizer"
import { resolveTaskMeldDataPath } from "../app/data-dir"

const STORAGE_DIR = resolveTaskMeldDataPath()
const STORAGE_FILE = resolveTaskMeldDataPath("openclaw-device.json")
const CONTROL_UI_ORIGIN = "http://localhost:3000"
const ED25519_SPKI_PREFIX = Buffer.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00])

const MIN_PROTOCOL = 3
const MAX_PROTOCOL = 4
const CHALLENGE_TIMEOUT_MS = 5_000
const HELLO_TIMEOUT_MS = 8_000
const BASE_RECONNECT_MS = 1_000
const MAX_RECONNECT_MS = 30_000

type PendingRequest = {
  resolve: (frame: GatewayResFrame) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

type DeviceIdentity = {
  deviceId: string
  publicKey: string
  privateKey: string
}

export type GatewayConnectionStatus =
  | "idle"
  | "connecting"
  | "ws_open"
  | "challenged"
  | "connect_sent"
  | "ready"
  | "failed_auth"
  | "failed_protocol"
  | "failed_timeout"
  | "failed_transport"
  | "closed"

export type GatewayConnectionInfo = {
  status: GatewayConnectionStatus
  lastError: string | null
  lastHelloAt: number | null
  protocol: number | null
  scopes: string[]
}

export type SendReqOptions = {
  timeoutMs?: number
  sideEffect?: boolean
  idempotencyKey?: string
}

export type GatewayClientOptions = {
  gatewayUrl: string
  token: string
  clientId?: string
  clientMode?: string
  clientVersion?: string
  platform?: string
  locale?: string
  scopes?: string[]
  onFrame?: (frame: GatewayFrame) => void
  onRawFrame?: (frame: GatewayFrame) => void
  onOpen?: () => void
  onClose?: (code: number, reason: string) => void
  onError?: (error: unknown) => void
  onStatus?: (info: GatewayConnectionInfo) => void
  shouldReconnect?: (status: GatewayConnectionStatus, reason: string) => boolean
}

export type GatewayClient = {
  connect: () => Promise<HelloOkPayload>
  close: () => void
  sendReq: (method: string, params?: Record<string, unknown>, opts?: SendReqOptions) => Promise<unknown>
  onEvent: (handler: (event: GatewayEventFrame) => void) => () => void
  getStatus: () => GatewayConnectionInfo
  getSocket: () => WebSocket | null
  getHello: () => HelloOkPayload | null
}

const base64UrlEncode = (data: Buffer) =>
  data.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")

const base64UrlDecode = (value: string) => {
  const padded = value.padEnd(Math.ceil(value.length / 4) * 4, "=")
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64")
}

const sha256Hex = (data: Buffer) => createHash("sha256").update(data).digest("hex")

const publicKeyRawBase64Url = (spkiBuffer: Buffer) => {
  if (
    spkiBuffer.length === ED25519_SPKI_PREFIX.length + 32 &&
    spkiBuffer.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return base64UrlEncode(spkiBuffer.subarray(ED25519_SPKI_PREFIX.length))
  }
  return base64UrlEncode(spkiBuffer)
}

const fingerprintPublicKey = (spkiBuffer: Buffer) => {
  let rawKey = spkiBuffer
  if (
    spkiBuffer.length === ED25519_SPKI_PREFIX.length + 32 &&
    spkiBuffer.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    rawKey = spkiBuffer.subarray(ED25519_SPKI_PREFIX.length)
  }
  return sha256Hex(rawKey)
}

const buildDeviceAuthPayload = ({
  deviceId,
  clientId,
  clientMode,
  role,
  scopes,
  signedAt,
  token,
  nonce,
}: {
  deviceId: string
  clientId: string
  clientMode: string
  role: string
  scopes: string[]
  signedAt: number
  token?: string | null
  nonce?: string
}) => {
  const version = nonce ? "v2" : "v1"
  const scopeStr = scopes.join(",")
  const base = [version, deviceId, clientId, clientMode, role, scopeStr, String(signedAt), token || ""]
  if (version === "v2") base.push(nonce || "")
  return {
    version,
    value: base.join("|"),
  }
}

const signDevicePayload = (privateKeyBase64Url: string, payload: string) => {
  const message = Buffer.from(payload, "utf8")
  const privateKeyBuffer = base64UrlDecode(privateKeyBase64Url)
  const key = createPrivateKey({ key: privateKeyBuffer, format: "der", type: "pkcs8" })
  const signature = sign(null, message, key)
  return base64UrlEncode(signature)
}

const loadOrCreateIdentity = async (): Promise<DeviceIdentity> => {
  try {
    const stored = await fs.readFile(STORAGE_FILE, "utf8")
    const parsed = JSON.parse(stored) as DeviceIdentity
    if (!parsed?.deviceId || !parsed?.publicKey || !parsed?.privateKey) {
      throw new Error("invalid_device_identity")
    }
    return parsed
  } catch {
    await fs.mkdir(STORAGE_DIR, { recursive: true })
    const { publicKey, privateKey } = generateKeyPairSync("ed25519")
    const publicKeyBuffer = publicKey.export({ type: "spki", format: "der" })
    const privateKeyBuffer = privateKey.export({ type: "pkcs8", format: "der" })

    const identity: DeviceIdentity = {
      deviceId: fingerprintPublicKey(publicKeyBuffer),
      publicKey: publicKeyRawBase64Url(publicKeyBuffer),
      privateKey: base64UrlEncode(privateKeyBuffer),
    }

    await fs.writeFile(STORAGE_FILE, JSON.stringify(identity, null, 2), "utf8")
    return identity
  }
}

const getBackoffMs = (attempt: number) => {
  const base = Math.min(MAX_RECONNECT_MS, BASE_RECONNECT_MS * 2 ** attempt)
  const jitter = Math.floor(base * Math.random() * 0.2)
  return base + jitter
}

export const createGatewayClient = (options: GatewayClientOptions): GatewayClient => {
  let socket: WebSocket | null = null
  let status: GatewayConnectionStatus = "idle"
  let lastError: string | null = null
  let lastHelloAt: number | null = null
  let protocol: number | null = null
  let activeScopes = [...(options.scopes ?? ["operator.read", "operator.write"])]
  let isManualClose = false
  let reconnectAttempt = 0
  let lastHello: HelloOkPayload | null = null
  let reconnectTimer: NodeJS.Timeout | null = null
  let challengeTimer: NodeJS.Timeout | null = null
  let helloTimer: NodeJS.Timeout | null = null
  let connectRequestId: string | null = null
  const connectWaiters = new Set<{
    resolve: (value: HelloOkPayload) => void
    reject: (reason: Error) => void
  }>()

  const pending = new Map<string, PendingRequest>()
  const eventHandlers = new Set<(event: GatewayEventFrame) => void>()

  const clearTimer = (timer: NodeJS.Timeout | null) => {
    if (timer) {
      clearTimeout(timer)
    }
  }

  const clearHandshakeTimers = () => {
    clearTimer(challengeTimer)
    clearTimer(helloTimer)
    challengeTimer = null
    helloTimer = null
  }

  const getStatus = (): GatewayConnectionInfo => ({
    status,
    lastError,
    lastHelloAt,
    protocol,
    scopes: [...activeScopes],
  })

  const updateStatus = (next: GatewayConnectionStatus, error?: string | null) => {
    status = next
    if (error !== undefined) {
      lastError = error
    }
    options.onStatus?.(getStatus())
  }

  const rejectAllPending = (reason: string) => {
    for (const [id, entry] of pending.entries()) {
      clearTimeout(entry.timer)
      entry.reject(new Error(reason))
      pending.delete(id)
    }
  }

  const failConnectWaiters = (reason: string) => {
    for (const waiter of connectWaiters) {
      waiter.reject(new Error(reason))
    }
    connectWaiters.clear()
  }

  const shouldReconnect = (failedStatus: GatewayConnectionStatus, reason: string) => {
    if (isManualClose) {
      return false
    }
    if (failedStatus === "failed_auth" || failedStatus === "failed_protocol") {
      return false
    }
    return options.shouldReconnect?.(failedStatus, reason) ?? true
  }

  const scheduleReconnect = (failedStatus: GatewayConnectionStatus, reason: string) => {
    if (!shouldReconnect(failedStatus, reason)) {
      return
    }
    if (reconnectTimer) {
      return
    }

    const delay = getBackoffMs(reconnectAttempt++)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      void openSocket()
    }, delay)
  }

  const failAndMaybeReconnect = (failedStatus: GatewayConnectionStatus, reason: string) => {
    clearHandshakeTimers()
    updateStatus(failedStatus, reason)
    rejectAllPending(reason)
    failConnectWaiters(reason)
    scheduleReconnect(failedStatus, reason)
  }

  const makeConnectParams = async (nonce?: string): Promise<GatewayConnectParams> => {
    const identity = await loadOrCreateIdentity()
    const signedAt = Date.now()
    const clientId = options.clientId ?? "openclaw-control-ui"
    const clientMode = options.clientMode ?? "webchat"
    const role = "operator"
    const authPayload = buildDeviceAuthPayload({
      deviceId: identity.deviceId,
      clientId,
      clientMode,
      role,
      scopes: activeScopes,
      signedAt,
      token: options.token,
      nonce,
    })
    const signature = signDevicePayload(identity.privateKey, authPayload.value)

    return {
      minProtocol: MIN_PROTOCOL,
      maxProtocol: MAX_PROTOCOL,
      client: {
        id: clientId,
        version: options.clientVersion ?? "0.1.0",
        platform: options.platform ?? "web",
        mode: clientMode,
        instanceId: randomUUID(),
      },
      role,
      scopes: [...activeScopes],
      caps: ["tool-events"],
      commands: [],
      permissions: {
        "device.auth.version.v1": authPayload.version === "v1",
        "device.auth.version.v2": authPayload.version === "v2",
      },
      auth: { token: options.token },
      locale: options.locale ?? "en-US",
      userAgent: `openclaw-control/${process.version} (${process.platform})`,
      device: {
        id: identity.deviceId,
        publicKey: identity.publicKey,
        signature,
        signedAt,
        nonce,
      },
    }
  }

  const sendConnectRequest = async (nonce?: string) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error("socket_not_open")
    }
    if (connectRequestId) {
      return
    }

    const reqId = `connect-${Date.now()}-${randomUUID()}`
    const connectParams = await makeConnectParams(nonce)
    const req = {
      type: "req",
      id: reqId,
      method: "connect",
      params: connectParams,
    }

    connectRequestId = reqId
    updateStatus("connect_sent", null)
    socket.send(JSON.stringify(req))

    helloTimer = setTimeout(() => {
      failAndMaybeReconnect("failed_timeout", "hello_timeout")
      socket?.close()
    }, HELLO_TIMEOUT_MS)
  }

  const handleHandshakeResponse = (frame: GatewayResFrame) => {
    if (!connectRequestId || frame.id !== connectRequestId) {
      return
    }

    clearTimer(helloTimer)
    helloTimer = null

    if (!frame.ok) {
      const msg = `connect_failed:${JSON.stringify(frame.error ?? {})}`
      failAndMaybeReconnect("failed_auth", msg)
      socket?.close()
      return
    }

    const payload = (frame.payload ?? {}) as HelloOkPayload
    if (payload?.type && payload.type !== "hello-ok") {
      failAndMaybeReconnect("failed_protocol", `invalid_hello_type:${String(payload.type)}`)
      return
    }

    const nextProtocol = Number(payload?.protocol ?? 0)
    if (!Number.isFinite(nextProtocol) || nextProtocol < MIN_PROTOCOL || nextProtocol > MAX_PROTOCOL) {
      failAndMaybeReconnect("failed_protocol", `protocol_mismatch:${String(payload?.protocol)}`)
      return
    }

    protocol = nextProtocol
    lastHelloAt = Date.now()
    lastHello = payload
    reconnectAttempt = 0
    connectRequestId = null
    updateStatus("ready", null)

    for (const waiter of connectWaiters) {
      waiter.resolve(payload)
    }
    connectWaiters.clear()
  }

  const handleMessage = async (raw: RawData) => {
    let frame: GatewayFrame
    try {
      frame = JSON.parse(raw.toString()) as GatewayFrame
    } catch (error) {
      options.onError?.(error)
      return
    }

    const rawFrame = frame
    const diagnosticFrame = sanitizeGatewayFrame(rawFrame, { maxTextLength: 16384, maxTextTailChars: 16384 })
    options.onRawFrame?.(rawFrame)
    options.onFrame?.(diagnosticFrame)

    if (frame.type === "event") {
      const event = frame as GatewayEventFrame
      if (event.event === "connect.challenge") {
        if (status !== "ws_open") {
          return
        }

        clearTimer(challengeTimer)
        challengeTimer = null
        updateStatus("challenged", null)

        const nonce = (event.payload as { nonce?: string } | undefined)?.nonce
        try {
          await sendConnectRequest(nonce)
        } catch (error) {
          options.onError?.(error)
          failAndMaybeReconnect("failed_transport", "connect_send_failed")
          socket?.close()
        }
      }

      for (const handler of eventHandlers) {
        handler(event)
      }
      return
    }

    if (frame.type === "res") {
      const response = frame as GatewayResFrame

      if (connectRequestId && response.id === connectRequestId) {
        handleHandshakeResponse(response)
        return
      }

      const entry = pending.get(response.id)
      if (entry) {
        clearTimeout(entry.timer)
        pending.delete(response.id)
        entry.resolve(response)
      }
    }
  }

  const openSocket = async () => {
    clearTimer(reconnectTimer)
    reconnectTimer = null

    // S7 fix: the old socket must have its listeners explicitly removed and be closed, to prevent stale instances and listener closures from lingering during reconnects.
    if (socket) {
      try {
        socket.removeAllListeners()
      } catch {
        /* noop */
      }
      try {
        socket.close()
      } catch {
        /* noop */
      }
      socket = null
    }

    updateStatus("connecting", null)
    connectRequestId = null

    socket = new WebSocket(options.gatewayUrl, {
      headers: { origin: CONTROL_UI_ORIGIN },
      maxPayload: 8 * 1024 * 1024,
    })

    socket.on("open", () => {
      updateStatus("ws_open", null)
      options.onOpen?.()

      challengeTimer = setTimeout(() => {
        if (!connectRequestId) {
          failAndMaybeReconnect("failed_timeout", "challenge_timeout")
          socket?.close()
        }
      }, CHALLENGE_TIMEOUT_MS)
    })

    socket.on("message", (data) => {
      void handleMessage(data)
    })

    socket.on("error", (error) => {
      options.onError?.(error)
      failAndMaybeReconnect("failed_transport", "socket_error")
      socket?.close()
    })

    socket.on("close", (code, reason) => {
      clearHandshakeTimers()
      rejectAllPending(`socket_closed:${code}`)

      if (status !== "failed_auth" && status !== "failed_protocol") {
        updateStatus(isManualClose ? "closed" : "failed_transport", `closed:${code}`)
      }

      options.onClose?.(code, reason.toString())

      // If auth/protocol errors were already determined during the handshake phase, the close is just the tail-end of a preceding proactive disconnect.
      // We must not continue reconnect as failed_transport here, otherwise pairing required / scope-upgrade
      // would trigger infinite local reconnects, repeatedly hitting 127.0.0.1:18789.
      if (!isManualClose && status !== "failed_auth" && status !== "failed_protocol") {
        scheduleReconnect("failed_transport", `closed:${code}`)
      }
    })
  }

  const connect = async (): Promise<HelloOkPayload> => {
    isManualClose = false

    if (status === "ready") {
      return {
        type: "hello-ok",
        protocol: protocol ?? MIN_PROTOCOL,
      }
    }

    const promise = new Promise<HelloOkPayload>((resolve, reject) => {
      connectWaiters.add({ resolve, reject })
    })

    if (status === "idle" || status === "closed" || status.startsWith("failed")) {
      await openSocket()
    }
    return promise
  }

  const sendReq = async (
    method: string,
    params: Record<string, unknown> = {},
    opts: SendReqOptions = {},
  ): Promise<unknown> => {
    if (status !== "ready" || !socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error("gateway_not_ready")
    }

    const id = `${method}-${Date.now()}-${randomUUID()}`
    const timeoutMs = opts.timeoutMs ?? 15_000
    const finalParams = { ...params }

    if (opts.sideEffect) {
      finalParams.idempotencyKey = opts.idempotencyKey ?? randomUUID()
    }

    const request = {
      type: "req" as const,
      id,
      method,
      params: finalParams,
    }
    options.onFrame?.(sanitizeGatewayFrame(request, { maxTextLength: 16384, maxTextTailChars: 16384 }))

    const response = await new Promise<GatewayResFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`request_timeout:${method}`))
      }, timeoutMs)

      pending.set(id, { resolve, reject, timer })
      socket?.send(JSON.stringify(request))
    })

    if (!response.ok) {
      throw new Error(`request_failed:${method}:${JSON.stringify(response.error ?? {})}`)
    }

    return response.payload
  }

  const close = () => {
    isManualClose = true
    clearHandshakeTimers()
    clearTimer(reconnectTimer)
    reconnectTimer = null
    rejectAllPending("gateway_closed")
    failConnectWaiters("gateway_closed")
    socket?.close()
    updateStatus("closed", null)
  }

  const onEvent = (handler: (event: GatewayEventFrame) => void) => {
    eventHandlers.add(handler)
    return () => {
      eventHandlers.delete(handler)
    }
  }

  return {
    connect,
    close,
    sendReq,
    onEvent,
    getStatus,
    getSocket: () => socket,
    getHello: () => lastHello,
  }
}
