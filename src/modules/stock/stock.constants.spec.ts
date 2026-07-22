import { MovementType } from '@prisma/client';
import { MOVEMENT_SIGN, signedQuantity } from './stock.constants';

describe('signedQuantity', () => {
  it('adds stock for inbound types', () => {
    expect(signedQuantity(MovementType.RECEIVE, 10)).toBe(10);
    expect(signedQuantity(MovementType.RETURN, 5)).toBe(5);
    expect(signedQuantity(MovementType.TRANSFER_IN, 7)).toBe(7);
  });

  it('removes stock for outbound types', () => {
    expect(signedQuantity(MovementType.DISPATCH, 10)).toBe(-10);
    expect(signedQuantity(MovementType.TRANSFER_OUT, 4)).toBe(-4);
  });

  it('normalises the absolute value for signed types', () => {
    // A caller passing a negative absolute for a DISPATCH still yields -qty.
    expect(signedQuantity(MovementType.DISPATCH, -10)).toBe(-10);
    expect(signedQuantity(MovementType.RECEIVE, -10)).toBe(10);
  });

  it('passes an ADJUSTMENT delta through unchanged (may be negative)', () => {
    expect(signedQuantity(MovementType.ADJUSTMENT, -3)).toBe(-3);
    expect(signedQuantity(MovementType.ADJUSTMENT, 8)).toBe(8);
  });

  it('MOVEMENT_SIGN marks ADJUSTMENT as neutral', () => {
    expect(MOVEMENT_SIGN.ADJUSTMENT).toBe(0);
    expect(MOVEMENT_SIGN.RECEIVE).toBe(1);
    expect(MOVEMENT_SIGN.DISPATCH).toBe(-1);
  });
});
