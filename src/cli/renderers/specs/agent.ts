import type { RenderSpecMap } from "../engine/types";

import { readRecord } from "../engine/utils";

export const agentRenderSpecs: RenderSpecMap = {
  "agent.list": {
    kind: "list",
    title: "Agent List",
    columns: [
      {
        title: "Agent ID",
        render: (row) => row.id ?? "-",
      },
      {
        title: "Name",
        render: (row) => {
          const raw = readRecord(row.raw);
          return raw.name ?? row.name ?? "-";
        },
      },
      {
        title: "Workspace",
        render: (row) => {
          const raw = readRecord(row.raw);
          return raw.workspace ?? "-";
        },
      },
      {
        title: "Runtime",
        render: (row) => {
          const raw = readRecord(row.raw);
          const runtime = readRecord(raw.agentRuntime);
          return runtime.id ?? "-";
        },
      },
      {
        title: "Model Primary",
        render: (row) => {
          const raw = readRecord(row.raw);
          const model = readRecord(raw.model);
          return model.primary ?? "-";
        },
      },
      {
        title: "Last Active At",
        render: (row) => row.lastActiveAt ?? row.lastActiveAtMs ?? "-",
      },
    ],
  },
  "agent.session": {
    kind: "list",
    title: "Session List",
    columns: [
      {
        title: "Agent ID",
        render: (row) => row.agentId ?? "-",
      },
      {
        title: "Session ID",
        render: (row) => row.sessionId ?? "-",
      },
    ],
  },
  "agent.send": {
    kind: "text",
    render: (data) => {
      const d = data as Record<string, unknown>;
      if (d.streamed === true) return "";
      if (!d.reply) {
        const timedOut = d.timedOut === true;
        return timedOut ? "(timed out, no reply)" : "(no reply)";
      }
      const reply = d.reply as Record<string, unknown>;
      return String(reply.content ?? "-");
    },
  },
};
