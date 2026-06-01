/**
 * Generates TypeScript type definitions from i18n locale JSON files.
 * Run: npx tsx web/src/shared/i18n/generate-types.ts
 *
 * Output: web/src/shared/i18n/translation-keys.ts
 *   - TranslationKey — union of all valid dotted key paths
 *   - NamespacedKey<NS> — key paths scoped to one namespace
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, dirname } from "node:path";

const LOCALES_DIR = join(import.meta.dirname, "locales", "en");
const OUTPUT_PATH = join(import.meta.dirname, "translation-keys.ts");

type KeyTree = Record<string, unknown>;

/** Recursively collect dotted-path keys from a JSON object tree. */
function collectKeys(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object") return [];
  if (Array.isArray(obj)) return [];
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj as KeyTree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      keys.push(path);
    } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      // Treat as a namespace segment only if all leaf values are strings
      const nested = collectKeys(value, path);
      if (nested.length > 0) {
        keys.push(...nested);
      }
    }
  }
  return keys;
}

/** Read one JSON file and return its key paths. */
function readJsonKeys(filePath: string): string[] {
  const raw = readFileSync(filePath, "utf8");
  const data = JSON.parse(raw) as KeyTree;
  return collectKeys(data);
}

function main() {
  const files = readdirSync(LOCALES_DIR).filter((f) => f.endsWith(".json"));

  const namespaceKeys = new Map<string, string[]>();

  for (const file of files) {
    const ns = file.replace(".json", "");
    const filePath = join(LOCALES_DIR, file);
    const keys = readJsonKeys(filePath);
    namespaceKeys.set(ns, keys);
  }

  // Sanitize namespace names for TypeScript identifiers (hyphens → underscores)
  const typeName = (ns: string) => ns.replaceAll("-", "_");

  // Build namespace-level union types
  const nsTypeEntries = [...namespaceKeys.entries()]
    .map(([ns, keys]) => {
      const union = keys.map((k) => `  | "${k}"`).join("\n");
      return `export type ${typeName(ns)}Key =\n${union};`;
    })
    .join("\n\n");

  // Build namespaced key type: "common:status.running" | "nav:pipeline" | ...
  const allNamespacedKeys = [...namespaceKeys.entries()]
    .flatMap(([ns, keys]) => keys.map((k) => `${ns}:${k}`));

  const namespacedUnion = allNamespacedKeys
    .map((k) => `  | "${k}"`)
    .join("\n");

  // Build bare key lookup (for useTranslation with a namespace)
  const bareKeyMap = [...namespaceKeys.entries()]
    .map(([ns, keys]) => {
      const union = keys.map((k) => `  | "${k}"`).join("\n");
      return `  "${ns}": ${typeName(ns)}Key;`;
    })
    .join("\n");

  const output = `// Auto-generated from locale JSON files. Do not edit manually.
// Regenerate: npx tsx web/src/shared/i18n/generate-types.ts

${nsTypeEntries}

/** All valid translation keys with namespace prefix (e.g. "common:status.running"). */
export type TranslationKey =
${namespacedUnion};

/** Maps each namespace to its bare key type (for useTranslation-scoped t() calls). */
export interface TranslationKeyMap {
${bareKeyMap}
}
`;

  writeFileSync(OUTPUT_PATH, output, "utf8");
  console.log(`Generated ${OUTPUT_PATH} with ${allNamespacedKeys.length} keys across ${namespaceKeys.size} namespaces.`);
}

main();
