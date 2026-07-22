import { fifoValuation, weightedAverageCost } from './valuation.service';

describe('weightedAverageCost', () => {
  it('averages mixed unit costs weighted by quantity', () => {
    // (10 * 2) + (30 * 4) = 140 over 40 units = 3.5
    const cost = weightedAverageCost([
      { quantity: 10, unitCost: 2 },
      { quantity: 30, unitCost: 4 },
    ]);
    expect(cost).toBe(3.5);
  });

  it('ignores outbound movements and rows without a unit cost', () => {
    const cost = weightedAverageCost([
      { quantity: 10, unitCost: 5 },
      { quantity: -4, unitCost: 5 }, // outbound, ignored
      { quantity: 10, unitCost: null }, // no cost, ignored
    ]);
    expect(cost).toBe(5);
  });

  it('returns 0 when there is no priced inbound stock', () => {
    expect(weightedAverageCost([])).toBe(0);
    expect(weightedAverageCost([{ quantity: -5, unitCost: 3 }])).toBe(0);
  });
});

describe('fifoValuation', () => {
  it('values on-hand quantity against the oldest surviving layers', () => {
    // Layers: 10 @ $2 (oldest), 10 @ $3. Dispatched 5 -> consumes oldest layer
    // first, leaving 5 @ $2 and 10 @ $3 = 15 on hand.
    const result = fifoValuation(
      [
        { quantity: 10, unitCost: 2 },
        { quantity: -5, unitCost: null },
        { quantity: 10, unitCost: 3 },
      ],
      15,
    );
    // 5 @ $2 + 10 @ $3 = 10 + 30 = 40
    expect(result.quantity).toBe(15);
    expect(result.totalValue).toBe(40);
    expect(result.layers).toEqual([
      { quantity: 5, unitCost: 2, value: 10 },
      { quantity: 10, unitCost: 3, value: 30 },
    ]);
  });

  it('handles a partial consumption within a single layer', () => {
    // 100 @ $1.5, dispatched 40 -> 60 on hand @ $1.5 = 90
    const result = fifoValuation(
      [
        { quantity: 100, unitCost: 1.5 },
        { quantity: -40, unitCost: null },
      ],
      60,
    );
    expect(result.totalValue).toBe(90);
    expect(result.layers).toHaveLength(1);
    expect(result.layers[0].quantity).toBe(60);
  });

  it('returns zero value for empty or zero-on-hand input', () => {
    expect(fifoValuation([], 0).totalValue).toBe(0);
    expect(
      fifoValuation([{ quantity: 10, unitCost: 2 }], 0).totalValue,
    ).toBe(0);
  });
});
