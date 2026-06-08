import { randomUUID } from "node:crypto"

export function generateMessageId(): string {
  return randomUUID()
}
