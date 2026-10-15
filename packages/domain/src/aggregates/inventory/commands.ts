import type { Command } from '../../core/command.js';

export interface InitializeInventoryPayload {
  readonly sku: string;
  readonly initial_quantity: number;
}

export interface ReserveInventoryPayload {
  readonly order_id: string;
  readonly quantity: number;
}

export interface ReleaseInventoryPayload {
  readonly order_id: string;
  readonly quantity: number;
  readonly reason: string;
}

export interface DeductInventoryPayload {
  readonly order_id: string;
  readonly quantity: number;
}

export type InitializeInventoryCommand = Command<InitializeInventoryPayload>;
export type ReserveInventoryCommand = Command<ReserveInventoryPayload>;
export type ReleaseInventoryCommand = Command<ReleaseInventoryPayload>;
export type DeductInventoryCommand = Command<DeductInventoryPayload>;
