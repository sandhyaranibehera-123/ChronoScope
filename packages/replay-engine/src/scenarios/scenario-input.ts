import type { ScenarioInputRecord } from '@chronoscope/database';

export interface EvaluatedScenarioInputs {
  readonly forcePaymentFailure: boolean;
  readonly forceShipmentFailure: boolean;
  readonly delayMs: number;
  readonly rawInputs: readonly ScenarioInputRecord[];
}

/**
 * Evaluates active scenario inputs for an aggregate on a timeline.
 * System-guarantees.md Rule 12 & 27:
 * "A ScenarioInput (e.g. ForcePaymentFailure) is persisted in scenario_inputs before
 * domain execution — an experiment instruction, never a hand-written domain event."
 */
export function evaluateScenarioInputs(
  inputs: readonly ScenarioInputRecord[],
  aggregateId?: string,
): EvaluatedScenarioInputs {
  let forcePaymentFailure = false;
  let forceShipmentFailure = false;
  let delayMs = 0;

  for (const input of inputs) {
    if (input.aggregateId && aggregateId && input.aggregateId !== aggregateId) {
      continue;
    }

    if (input.inputType === 'ForcePaymentFailure') {
      forcePaymentFailure = true;
    } else if (input.inputType === 'ForceShipmentFailure') {
      forceShipmentFailure = true;
    } else if (input.inputType === 'InjectDelay') {
      const delay = Number(input.parameters?.['delayMs'] ?? 0);
      if (delay > delayMs) {
        delayMs = delay;
      }
    }
  }

  return {
    forcePaymentFailure,
    forceShipmentFailure,
    delayMs,
    rawInputs: inputs,
  };
}
