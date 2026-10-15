export interface InventoryState {
  readonly timeline_id: string;
  readonly aggregate_id: string; // SKU or inventory ID
  readonly sku: string;
  readonly total_quantity: number;
  readonly reserved_quantity: number;
  readonly available_quantity: number;
  readonly created_at: string;
  readonly updated_at: string;
}
