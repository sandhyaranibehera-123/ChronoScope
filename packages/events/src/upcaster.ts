/**
 * Upcaster Registry & Evolution Pipeline — system-guarantees.md Rule 4:
 * "Every event carries schema_version; upcasters are mandatory before replaying historical payloads.
 * application_version, event_schema_version, and domain_logic_version are tracked as three separate axes."
 */

export type SingleStepUpcaster<TOld = unknown, TNew = unknown> = (payload: TOld) => TNew;

export interface UpcasterKey {
  readonly eventType: string;
  readonly fromVersion: number;
}

export class UpcasterRegistry {
  private readonly upcasters = new Map<string, SingleStepUpcaster>();

  private makeKey(eventType: string, fromVersion: number): string {
    return `${eventType}:v${fromVersion}`;
  }

  /**
   * Register an upcaster transforming payload from version V to V+1.
   */
  public register<TOld = unknown, TNew = unknown>(
    eventType: string,
    fromVersion: number,
    upcaster: SingleStepUpcaster<TOld, TNew>,
  ): this {
    const key = this.makeKey(eventType, fromVersion);
    if (this.upcasters.has(key)) {
      throw new Error(`Upcaster already registered for ${key}`);
    }
    this.upcasters.set(key, upcaster as SingleStepUpcaster);
    return this;
  }

  /**
   * Upcasts a payload from `sourceVersion` to `targetVersion` through registered sequential steps.
   * If sourceVersion === targetVersion, returns the payload unchanged.
   */
  public upcast<T = unknown>(
    eventType: string,
    payload: unknown,
    sourceVersion: number,
    targetVersion: number,
  ): T {
    if (sourceVersion > targetVersion) {
      throw new Error(
        `Cannot downcast event ${eventType} from v${sourceVersion} to v${targetVersion}`,
      );
    }

    let currentPayload = payload;
    let currentVersion = sourceVersion;

    while (currentVersion < targetVersion) {
      const key = this.makeKey(eventType, currentVersion);
      const step = this.upcasters.get(key);

      if (!step) {
        throw new Error(
          `Missing upcaster for ${eventType} from v${currentVersion} to v${currentVersion + 1}. Target is v${targetVersion}.`,
        );
      }

      currentPayload = step(currentPayload);
      currentVersion += 1;
    }

    return currentPayload as T;
  }

  public hasUpcaster(eventType: string, fromVersion: number): boolean {
    return this.upcasters.has(this.makeKey(eventType, fromVersion));
  }
}

/** Global default upcaster registry singleton */
export const defaultUpcasterRegistry = new UpcasterRegistry();
