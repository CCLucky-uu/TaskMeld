# Session Modal Architecture

This document describes the current module layering, responsibility boundaries, and key data flow of `web/src/widgets/session-modal`.

## Directory Structure

- `index.ts`
  - Exports `SessionModal`.
- `ui/SessionModal.tsx`
  - Container component (orchestration layer):
    - Manages session/core-file primary state.
    - Connects to gateway stream events and updates history.
    - Composes sub-components and hooks.
- `ui/ChatHistoryPanel.tsx`
  - Session message area display component:
    - Renders user/assistant/tool bubbles.
    - Handles tool collapse, output collapse, and "back to bottom" button visibility.
- `ui/CoreFilePanel.tsx`
  - Core file display and editing UI component:
    - Header metadata, edit/cancel/save buttons.
    - Editing textarea, read-only markdown/pre views.
- `ui/hooks/useSessionHistoryScroll.ts`
  - Session scroll strategy:
    - Defaults to bottom when entering a session.
    - Disables auto-follow when user scrolls up.
    - Shows/hides the "back to bottom" button.
- `ui/hooks/useCoreFileEditor.ts`
  - Core file editing state machine:
    - `begin/cancel/save`.
    - Saving, save error, draft state management.
- `model/session-modal-types.ts`
  - Module-internal type definitions (stream patch, live tool, merged entry).
- `model/stream-patches.ts`
  - Gateway stream parsing and text assembly:
    - `readAssistantStreamPatch`
    - `readToolStreamPatch`
    - `mergeAssistantText`
- `model/merge-history.ts`
  - History message merging: merges `tool call/result` into a single renderable tool record.

## Layering Principles

- `model/*`: Pure data transformations, no React dependencies.
- `ui/hooks/*`: Reusable behavioral logic (scroll, edit state).
- `ui/*.tsx`: Display components and container components.
- `SessionModal` only does "orchestration" and no longer carries large parsing/rendering details.

## Key Data Flows

### 1) Session streaming updates

1. `SessionModal` establishes WS listener.
2. `stream-patches.ts` parses assistant/tool patches.
3. Updates `history` and `liveTools`.
4. `merge-history.ts` merges history into `mergedHistory`.
5. `ChatHistoryPanel` renders final messages and tool bubbles.

### 2) Scroll behavior

1. `useSessionHistoryScroll` performs bottom positioning when entering a session.
2. When user scrolls up, disables auto-follow and shows "back to bottom".
3. When user returns to bottom, resumes auto-follow.

### 3) Core file editing and saving

1. `SessionModal` fetches file list and content.
2. `useCoreFileEditor` manages the edit/save process.
3. `CoreFilePanel` only handles rendering and event triggering.
4. After a successful save, updates `fileContent` and list metadata via callbacks.

## Maintenance Suggestions

- When adding new gateway event types, prefer modifying `model/stream-patches.ts` to avoid spreading parsing logic into the UI.
- When adding interactions to the chat area, prefer putting them in `ChatHistoryPanel` and state logic in hooks.
- `SessionModal` should keep its "state orchestrator" role to avoid bloating again.
