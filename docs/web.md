# Web Frontend Documentation

## Overview

The Web frontend is a React-based console application providing pipeline orchestration, Agent integration, session tools, artifact browsing, and log viewing.

**Entry file:** `web/src/main.tsx`
**Build tool:** Vite 7
**Dev command:** `npm run dev:web` (root directory) or `npm --prefix web run dev`
**Build command:** `npm run build:web` (root directory) or `npm --prefix web run build`

---

## Tech Stack

| Category | Technology |
| --- | --- |
| Framework | React 19.2 |
| Language | TypeScript 5.9 (strict mode) |
| Build | Vite 7 + @vitejs/plugin-react |
| CSS | Tailwind CSS 4.2 (via @tailwindcss/vite plugin) |
| Icons | @iconify-react (Lucide icon set) |
| Markdown rendering | react-markdown + remark-gfm + rehype-sanitize |
| Server communication | WebSocket (RPC + event subscription) |
| Module system | ES Module (`"type": "module"`) |

---

## Project Structure

```
web/src/
  main.tsx                    # Application entry, ReactDOM.createRoot
  App.tsx                     # Root component, route dispatch
  types.ts                    # Compatibility layer type re-exports (not recommended for new code)

  app/                        # Application entry layer
    App.tsx                   # Route component (actually at web/src/app/App.tsx)
    index.ts
    styles/
      public.css              # Application global styles

  pages/                      # Page orchestration layer
    control-plane/            # Control plane page
      ui/ControlPlanePage.tsx # Control plane main page component
      model/useControlPlanePage.ts        # Page-level state & business orchestration hook
      model/controlPlaneNavItems.tsx      # Side navigation configuration
      model/useControlPlaneDraftState.ts  # Node/group editing draft state
      model/controlPlaneUtils.ts          # Workflow editing utility functions
    landing/                  # Landing page
      ui/LandingPage.tsx      # SaaS promotional landing page

  widgets/                    # Reusable business UI blocks
    top-bar/                  # Top status bar (gateway status, nav toggle)
    nav-panel/                # Side navigation panel (resource switching)
    pipeline-board/           # Pipeline panel (list, DAG, batch run, plugin modal)
    agent-list/               # Agent list cards
    session-modal/            # Session modal (message sending, history viewing)
    timeline-panel/           # Timeline panel
    node-detail/              # Node detail editing panel & parallel group detail panel
    run-log-viewer/           # Runtime log viewer
    scheduler-card/           # Scheduler configuration card
    artifact-board/           # Artifact panel (tree browsing, preview, filtering)
    overview-board/           # Overview panel

  features/                   # User action capabilities
    node-retry/               # Node retry feature
    session-create/           # Session creation feature
    session-send/             # Session message sending feature

  entities/                   # Domain models & API
    gateway/                  # Gateway (status, service)
    agent/                    # Agent (types, service, data mapping)
    session/                  # Session (types, service, data mapping, history parsing)
    pipeline/                 # Pipeline (types, service, error parsing)
    timeline/                 # Timeline (types, service)
    artifact/                 # Artifact storage (types, service)
    run-log/                  # Runtime logs (types, service)

  shared/                     # Shared capabilities
    ws-client.ts              # WebSocket client (RPC request, event subscription, ApiError)
    realtime/                 # Real-time event parsing & dispatch
      gateway-events.ts       # Event type definitions & parsing & dispatch
    lib/                      # Utility functions
      cn.ts                   # className concatenation utility
      useMediaQuery.ts        # Responsive media query hook
    ui/                       # Shared UI components
      MarkdownViewer.tsx      # Markdown rendering component
      Metric.tsx              # Metric display component
      Skeleton.tsx            # Skeleton screen component
      InlineSelect.tsx        # Inline dropdown selector
      panelClasses.ts         # Panel style constants
      surfaceClassNames.ts    # Surface style constants
```

### Layered Architecture

The project follows an FSD-like (Feature-Sliced Design) layered structure:

```
pages       (Page orchestration layer: assembles widgets + coordinates features + manages page state)
  widgets   (Business UI blocks: display + event passthrough)
  features  (User actions: business interaction logic)
    entities (Domain models: type definitions + API calls + data mapping)
      shared  (Shared capabilities: HTTP/WS foundation, event dispatch, shared UI)
```

---

## Routes and Pages

The application uses client-side routing based on `window.location.pathname` (no react-router or similar libraries), dispatched by the `normalizePathname` function in `App.tsx`:

| Path | Page | Corresponding View |
| --- | --- | --- |
| `/` | `LandingPage` | SaaS promotional landing page |
| `/overview` | `ControlPlanePage (home)` | Overview panel |
| `/pipeline` | `ControlPlanePage (pipeline)` | Pipeline management |
| `/agents` | `ControlPlanePage (agents)` | Agent list |
| `/artifacts` | `ControlPlanePage (artifacts)` | Artifact browsing |
| `/logs` | `ControlPlanePage (logs)` | Runtime logs |

**Navigation approach:**
- Uses `window.history.pushState` for SPA navigation
- Listens for `popstate` events to handle browser forward/back
- Pipeline routes support `?pipeline=<id>` query parameter to auto-target a specific pipeline

**Page layout description:**

**ControlPlanePage:**
- Left: `NavPanel` side navigation (Overview / Agents / Pipeline / Artifacts / Logs)
- Top bar: `TopBar` shows gateway status, latency, agent/session counts
- Central content area:
  - **Overview mode:** `OverviewBoard` displays all pipeline cards
  - **Pipeline mode:** `PipelineCard` displays pipeline list and DAG node graph
  - **Agents mode:** `AgentListCard` displays agent card grid
  - **Artifacts mode:** `ArtifactBoard` displays artifact tree browser
  - **Logs mode:** `RunLogPage` displays runtime logs

**LandingPage:**
- Top title bar + "Enter Console" button
- Main area displays product tagline and feature highlights
- Right side displays sample data panel

---

## Component Tree

```
App
  ├── LandingPage (path="/")
  │   └── [no child components, pure display page]
  │
  └── ControlPlanePage (path≠"/")
      ├── NavPanel
      │   └── controlPlaneNavItems (nav configuration)
      ├── TopBar (gateway status, latency, agent/session counts)
      │
      ├── [Central Content Area]
      │   ├── OverviewBoard (pageRoute="home")
      │   │   └── PipelineCard summary + Agent list
      │   │
      │   ├── PipelineCard (pageRoute="pipeline")
      │   │   ├── Pipeline list (multiple sections)
      │   │   ├── Add pipeline button
      │   │   ├── Pipeline actions (run/edit/delete/rename)
      │   │   ├── DAG node graph (draggable ordering)
      │   │   ├── Batch run controls (remote batch)
      │   │   └── Scheduler toggle/mode switch
      │   │
      │   ├── AgentListCard (pageRoute="agents")
      │   │   └── AgentCard[] (work status/execution history/output preview)
      │   │
      │   ├── ArtifactBoard (pageRoute="artifacts")
      │   │   ├── ArtifactFiltersBar
      │   │   ├── ArtifactTreePane
      │   │   └── ArtifactPreviewPane
      │   │
      │   └── RunLogPage (pageRoute="logs")
      │       └── RunLogViewer
      │
      ├── [Right Detail Panel] (pipeline route only)
      │   ├── NodeDetailPanel (when a node is selected)
      │   └── GroupDetailPanel (when a parallel group is selected)
      │
      ├── [Modal Layer]
      │   ├── Add Pipeline Modal
      │   ├── Rename Pipeline Modal
      │   ├── Delete Pipeline Modal
      │   ├── Add Node/Parallel Group Modal
      │   ├── Delete Node/Parallel Group Modal
      │   ├── SessionModal (session dialog)
      │   │   ├── Session selector
      │   │   ├── Message input area
      │   │   ├── ChatHistoryPanel (message history)
      │   │   └── CoreFilePanel (Agent core file editor)
      │   ├── PipelinePluginModal (plugin configuration)
      │   ├── Workflow JSON Editor Modal
      │   └── Agent Final Output Content Modal
```

---

## State Management

The project uses React built-in hooks for state management, without introducing Redux, Zustand, or other external state management libraries.

### Core State Hook: `useControlPlanePage`

Located at `web/src/pages/control-plane/model/useControlPlanePage.ts`, this is the single state management entry point for the control plane page, approximately 2000 lines.

**State categories:**

| Category | State | Description |
| --- | --- | --- |
| Navigation | `active`, `activePipelineId` | Currently active nav item and pipeline |
| Gateway | `gateway`, `serverVersion`, `latencyMs` | Gateway connection status and version |
| Entity data | `agents`, `sessions`, `pipelineList`, `timeline` | Domain entity lists |
| Pipeline view | `pipelineStateById` | Each pipeline's run state, workflow, batch run |
| Selection | `selectedNodeId`, `selectedGroupId`, `selectedAgentId` | Currently selected node/group/agent |
| Edit drafts | Managed by `useControlPlaneDraftState` | Node config, route policy, parallel group edit drafts |
| Loading state | `isSavingNodeConfig`, `isAddingNode`, `isDeletingNode`, etc. | Loading states for various async operations |
| Modal control | `sessionModalOpen`, `createPipelineModalOpen`, etc. | Modal open/close flags |
| Session | `selectedSessionId`, `sessionMessage`, `sendMode` | Managed by `useSessionSendFeature` |

### Child State Hooks:

- **`useControlPlaneDraftState`**: Manages draft states for node editing and parallel group editing, including title, agent, instruction, dependencies, route policy, and other fields, automatically synced to the selected node.
- **`useNodeRetryFeature`**: Node retry business logic.
- **`useSessionCreateFeature`**: Session creation (JSON input submission).
- **`useSessionSendFeature`**: Session message sending, including default session selection and agent primary session matching.

### Data Flow:

```
User interaction → widget event callback
  → useControlPlanePage method
    → entities API call (fetch)
      → Update React state
        → Trigger component re-render
```

**Real-time data flow:**
```
Gateway WebSocket connection
  → Event dispatch (dispatchGatewayWsEvent)
    → Update React state
      → Trigger component re-render
```

---

## Backend Communication

### WebSocket RPC

All backend communication uses WebSocket RPC via the `wsRequest<T>()` function in `shared/ws-client.ts`. The connection is established automatically on first request and supports auto-reconnect.

**RPC request flow:**
```
wsRequest(method, params) → connect() → ws.send({ type: "req", id, method, params })
  → wait for response frame with matching id
    → resolve/reject based on frame.ok
```

**Event subscription:**
```
onWsEvent(handler) → register handler for gateway events
  → ws.onmessage parses frames, dispatches GatewayWsEvent to handlers
```

### WebSocket Real-time Communication

WebSocket connections are established via `shared/ws-client.ts`, connecting to the `/api/ws` endpoint.

**Event types:**

| Event | Description |
| --- | --- |
| `bootstrap` | Server-side full snapshot (sent on connection or reconnection) |
| `gateway.status` | Gateway connection state change |
| `gateway.ready` | Gateway ready |
| `gateway.frame` | Low-level gateway frame (internal use) |
| `pipeline.updated` | Pipeline run state update |
| `timeline.updated` | New timeline event |

**Event handling flow:**

1. `ws-client.ts` establishes the WebSocket connection automatically on first request
2. `parseGatewayWsEvent()` parses raw messages into typed events
3. `dispatchGatewayWsEvent()` dispatches to the corresponding handler by event type
4. Handler updates React state, triggering component re-render

**In `useControlPlanePage`:**
- `bootstrap` handler: replaces pipeline list, updates run state, syncs timeline
- `pipeline.updated` handler: updates node status, re-fetches item data
- `gateway.frame` handler: handles real-time agent streaming output
- `timeline.updated` handler: updates log timeline

---

## Error Handling

- WS errors are encapsulated via the `ApiError` class (`shared/ws-client.ts`), containing `status` and `body`
- The API layer extracts error messages uniformly via the `getApiErrorMessage` utility function
- Operation failures are displayed to the user via `setActionMessage` which sets a page-level notification message
- Modal errors (e.g., pipeline creation failures) are displayed in inline areas

---

## Responsive Design

- Uses `useMediaQuery("(max-width: 767px)")` to detect mobile
- Mobile: sidebar becomes a floating drawer, dismissible by tapping the overlay
- Desktop: sidebar is collapsible (53px narrow mode / 210px wide mode)
- Modals adapt to fullscreen mode on mobile
