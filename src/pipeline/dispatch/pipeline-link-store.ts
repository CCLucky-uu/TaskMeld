import { readFile, writeFile, mkdir } from "node:fs/promises";
import { isValidLinkId, type PipelineLink } from "../types/pipeline-link";
import { resolveTaskMeldDataPath } from "../../app/data-dir";

const LINKS_FILE = resolveTaskMeldDataPath("pipeline-links.json");

type LinksDocument = {
  version: 1;
  items: PipelineLink[];
};

const loadLinksDocument = async (): Promise<LinksDocument> => {
  try {
    const raw = await readFile(LINKS_FILE, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && (parsed as LinksDocument).version === 1) {
      return parsed as LinksDocument;
    }
  } catch {
    // File not found or invalid, return default
  }
  return { version: 1, items: [] };
};

const saveLinksDocument = async (doc: LinksDocument): Promise<void> => {
  await mkdir(resolveTaskMeldDataPath(), { recursive: true });
  await writeFile(LINKS_FILE, JSON.stringify(doc, null, 2), "utf8");
};

export type PipelineLinkStore = {
  list: () => Promise<PipelineLink[]>;
  getById: (id: string) => Promise<PipelineLink | null>;
  create: (link: PipelineLink) => Promise<{ ok: true; link: PipelineLink } | { ok: false; error: string }>;
  update: (id: string, patch: Partial<Pick<PipelineLink, "enabled" | "inputContract" | "onJobFailed" | "maxPendingJobs">>) => Promise<{ ok: true; link: PipelineLink } | { ok: false; error: string }>;
  remove: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>;
};

export const createPipelineLinkStore = (): PipelineLinkStore => {
  const store: PipelineLinkStore = {
    list: async () => {
      const doc = await loadLinksDocument();
      return doc.items;
    },

    getById: async (id: string) => {
      const doc = await loadLinksDocument();
      return doc.items.find((link) => link.id === id) ?? null;
    },

    create: async (link: PipelineLink) => {
      if (!isValidLinkId(link.id)) {
        return { ok: false, error: "pipeline_link_invalid_id" };
      }
      if (link.fromPipelineId === link.toPipelineId) {
        return { ok: false, error: "pipeline_link_self_loop" };
      }

      const doc = await loadLinksDocument();
      if (doc.items.some((l) => l.id === link.id)) {
        return { ok: false, error: "pipeline_link_already_exists" };
      }

      // Check for duplicate same from/to without contract differentiation
      const existingSamePair = doc.items.filter(
        (l) => l.fromPipelineId === link.fromPipelineId && l.toPipelineId === link.toPipelineId,
      );
      if (existingSamePair.length > 0) {
        const contractMatch = existingSamePair.every((l) => {
          const a = l.inputContract;
          const b = link.inputContract;
          if (!a && !b) return true;
          if (!a || !b) return false;
          return a.requireType === b.requireType && a.requireSchemaVersion === b.requireSchemaVersion;
        });
        if (contractMatch) {
          return { ok: false, error: "pipeline_link_duplicate" };
        }
      }

      doc.items.push(link);
      await saveLinksDocument(doc);
      return { ok: true, link };
    },

    update: async (id: string, patch) => {
      const doc = await loadLinksDocument();
      const index = doc.items.findIndex((l) => l.id === id);
      if (index < 0) {
        return { ok: false, error: "pipeline_link_not_found" };
      }
      const now = new Date().toISOString();
      doc.items[index] = {
        ...doc.items[index],
        ...patch,
        updatedAt: now,
      };
      await saveLinksDocument(doc);
      return { ok: true, link: doc.items[index] };
    },

    remove: async (id: string) => {
      const doc = await loadLinksDocument();
      const index = doc.items.findIndex((l) => l.id === id);
      if (index < 0) {
        return { ok: false, error: "pipeline_link_not_found" };
      }
      doc.items.splice(index, 1);
      await saveLinksDocument(doc);
      return { ok: true };
    },
  };

  return store;
};
