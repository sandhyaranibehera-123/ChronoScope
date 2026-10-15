export interface RebuildProjectionOptions {
  readonly projectionName: string;
  readonly timelineId?: string;
  readonly partitionCount?: number;
  readonly lockTimeoutSeconds?: number;
}

export interface RebuildProjectionResult {
  readonly success: boolean;
  readonly runId: string;
  readonly projectionName: string;
  readonly documentsWritten: number;
  readonly sourceManifestHash: string;
  readonly projectionCollectionHash: string;
  readonly durationMs: number;
}
