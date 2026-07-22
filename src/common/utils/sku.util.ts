import { customAlphabet } from 'nanoid';

// Uppercase + digits, no ambiguous chars (0/O, 1/I) for human-readable SKUs.
const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const nano = customAlphabet(alphabet, 5);

/** Product SKU: PRD-XXXXX */
export function generateProductSku(): string {
  return `PRD-${nano()}`;
}

/**
 * Variant SKU derived from the parent product SKU plus a slug of the variant
 * attributes, e.g. PRD-00001 + { color: Red, size: L } -> PRD-00001-RD-L.
 */
export function generateVariantSku(
  productSku: string,
  attributes?: Record<string, unknown> | null,
): string {
  const parts = Object.values(attributes ?? {})
    .map((v) =>
      String(v)
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 3),
    )
    .filter(Boolean);
  const suffix = parts.length ? parts.join('-') : nano();
  return `${productSku}-${suffix}`;
}

/** PO number: PO-YYYY-XXXXX (year is passed in to keep the util pure). */
export function generatePoNumber(year: number): string {
  return `PO-${year}-${nano()}`;
}
