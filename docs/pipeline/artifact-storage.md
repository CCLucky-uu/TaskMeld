# Artifact Storage

> Code entry points: `src/pipeline/artifact-storage.ts` (write), `src/artifacts/storage-service.ts` (query/export), `src/artifacts/artifact-index.ts` (index), `src/artifacts/artifact-cleanup.ts` (cleanup), `src/artifacts/artifact-rebuilder.ts` (rebuild index)

## Directory Structure

Artifacts are stored under the pipeline's `artifactDir`, defaulting to `.data/pipelines/{pipelineId}/artifacts/`. Organized by three levels: `status/date/runId`:

```text
.data/pipelines/{pipelineId}/artifacts/
├── success/
│   └── 2026-05-13/
│       └── run-xxx/
│           ├── envelopes/    (structured receipt JSON)
│           └── artifacts/    (artifact JSON files)
├── failed/
│   └── 2026-05-13/
│       └── run-xxx/
│           ├── envelopes/
│           └── artifacts/
├── rejected/
│   └── 2026-05-13/
│       └── run-xxx/
│           └── artifacts/    (rejected archived artifacts, no envelopes)
└── index.jsonl              (artifact index, one JSON record per line)
```

Batch run artifacts are further grouped by `batchRunId` (`batchRunId` prefixed with `batch-`):

```text
{status}/{date}/{batchRunId}/{runId}/...
```

## Storage API

### Write

```ts
persistArtifactFile(rootDir, status, ctx, artifact, opts?)
  → Write to artifacts/ directory + append index + return ArtifactManifest

persistEnvelopeFile(rootDir, status, ctx, envelope, opts?)
  → Write to envelopes/ directory + append index + return ArtifactManifest
```

### ArtifactWriteContext

```ts
type ArtifactWriteContext = {
  pipelineId: string;          // required
  runId: string;               // required
  batchRunId?: string | null;
  nodeId?: string | null;
  groupId?: string | null;
  itemKey?: string | null;
  requestId?: string | null;
  kind: StoredArtifactKind;   // "artifact" | "envelope" | "adapter" | "group"
};
```

### Index

`appendIndexRecord` / `appendMovedArtifactIndexRecord` maintain `index.jsonl`. The index deduplicates by artifactId (taking the one with the latest `updatedAt` for the same ID), supporting incremental appends and rebuilds.

Index record structure `StoredArtifactIndexRecord`:

```
{
  schemaVersion: 1, artifactId, pipelineId,
  status, kind, dateBucket,
  runId, batchRunId, nodeId, groupId, itemKey, requestId,
  type, artifactSchemaVersion, name,
  relativePath, sizeBytes, hash,
  createdAt, updatedAt
}
```

Queries support filtering by `pipelineId`, `statuses`, `kinds`, `nodeIds`, `runId`, `batchRunId`, `dateFrom`, `dateTo`.

### Query / Export

```ts
listStoredArtifacts(definitions, options?) → StoredArtifactListResult
readStoredArtifactContent(definition, relativePath) → StoredArtifactContent | null
exportStoredArtifactContents(definitions, options?) → StoredArtifactExportData
```

`listStoredArtifacts` prefers reading from the index; when the index is missing, it automatically falls back to filesystem scanning. Supports cursor-based pagination.

## Rejected Artifacts

Artifacts of nodes rejected by downstream are moved to the `rejected/{date}/{runId}/artifacts/` directory via `archiveRejectedArtifacts()`.

> Code entry point: `src/pipeline/execution/rejected-artifact-archiver.ts`

After the move, the index is updated with new records (same artifactId gets a new record; queries deduplicate by `updatedAt`, taking the latest), ensuring rejected artifacts are queryable via `listStoredArtifacts`.

## Cleanup

`src/artifacts/artifact-cleanup.ts` supports:

- `planCleanup()` — Generate a cleanup plan (dry-run), no files deleted
- `executeCleanup()` — Execute cleanup: delete files + empty directories + clear temp files + rebuild index
- Filter by date/status; default retention policy: success 30 days, failed/rejected 90 days
- Decisions based on `updatedAt` timestamps; files that have not exceeded the retention period will not be cleaned up
