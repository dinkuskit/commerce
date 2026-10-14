import type { OrdersCollection, OrderRecord } from './store.js';

export interface ShipIsolation { recipient: 'ship-sandbox'; generation: string; mode: 'test' }
interface ShipIdentity extends ShipIsolation { site: string }
export interface ShipPin { recipient: 'ship-sandbox'; generation: string; site: string; enabled: boolean }
export function validGeneration(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
export function cohortMatches(record: OrderRecord, tuple: ShipIdentity): boolean {
  return record.paidOrder.mode === 'test' && record.shipPin?.enabled === true &&
    record.shipPin.recipient === tuple.recipient && record.shipPin.generation === tuple.generation && record.shipPin.site === tuple.site;
}

/** Admission is metadata: it never changes the frozen payment or business revision. */
export async function admitShipOrder(collection: OrdersCollection, id: string, version: number, tuple: ShipIdentity): Promise<string> {
  const current = await collection.getVersioned(id);
  if (!current) return 'not_found';
  const record = current.value;
  if (record.shipPin) return record.shipPin.recipient === tuple.recipient && record.shipPin.generation === tuple.generation && record.shipPin.site === tuple.site
    ? (record.shipPin.enabled ? 'duplicate' : 'disabled') : 'conflict';
  if (record.paidOrder.mode !== 'test' || record.completed || record.shipVersion !== undefined ||
      version !== 1 || (record.revision ?? 1) !== version) return 'invalid';
  return (await collection.compareAndSet(id, current.revision, { ...record, shipPin: { recipient: tuple.recipient, generation: tuple.generation, site: tuple.site, enabled: true } })).applied ? 'saved' : 'outdated';
}

/** Disable races with completion/ack on this same storage revision. Pin is never removed. */
export async function disableShipOrder(collection: OrdersCollection, id: string, generation: string): Promise<string> {
  const current = await collection.getVersioned(id);
  if (!current) return 'not_found';
  const pin = current.value.shipPin;
  if (!pin || pin.generation !== generation) return 'conflict';
  if (!pin.enabled) return 'disabled';
  return (await collection.compareAndSet(id, current.revision, { ...current.value, shipPin: { ...pin, enabled: false } })).applied ? 'saved' : 'outdated';
}
