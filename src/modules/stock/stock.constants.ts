import { MovementType } from '@prisma/client';

/**
 * Sign each movement type applies to physical stock.
 * ADJUSTMENT is intentionally 0 here: an adjustment carries its own signed
 * delta (it can add or remove) and must not be re-signed by this map.
 */
export const MOVEMENT_SIGN: Record<MovementType, 1 | -1 | 0> = {
  RECEIVE: 1,
  RETURN: 1,
  TRANSFER_IN: 1,
  DISPATCH: -1,
  TRANSFER_OUT: -1,
  ADJUSTMENT: 0,
};

/**
 * Given a movement type and an absolute (non-negative) quantity, return the
 * signed quantity to store on the movement row.
 */
export function signedQuantity(
  type: MovementType,
  absoluteQty: number,
): number {
  const sign = MOVEMENT_SIGN[type];
  // ADJUSTMENT passes its delta through unchanged (may already be negative).
  if (sign === 0) return absoluteQty;
  return sign * Math.abs(absoluteQty);
}
