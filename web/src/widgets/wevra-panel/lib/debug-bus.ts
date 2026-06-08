/** Debug event bus — singleton, zero coupling. Delete this file to fully remove. */

export type DebugEvent =
  | { type: "request"; data: { messages: unknown[]; tools: unknown[]; raw: unknown } }
  | { type: "stream_chunk"; data: { raw: string; parsed?: unknown } }
  | { type: "response"; data: { raw: unknown; parsed: unknown } }
  | { type: "error"; data: { message: string; raw?: unknown } };

type Listener = (event: DebugEvent) => void;

const listeners = new Set<Listener>();

export const debugBus = {
  emit(event: DebugEvent): void {
    for (const fn of listeners) fn(event);
  },

  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },

  hasListeners(): boolean {
    return listeners.size > 0;
  },
};
