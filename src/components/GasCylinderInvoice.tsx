import type { GasCylinderLines } from '@/domain/gasCylinders';

/**
 * Itemized exchange vs new-cylinder lines. Amounts are the priced totals
 * (unit price × quantity), shown before the platform service fee.
 */
export function GasCylinderInvoice({
  lines,
  isRtl,
  currency,
}: {
  lines: GasCylinderLines | null;
  isRtl: boolean;
  currency: string;
}) {
  if (!lines) return null;
  const row = (label: string, amount: number) => (
    <div className="flex justify-between gap-3 text-sm">
      <span className="text-gray-500 font-medium">{label}</span>
      <span className="font-bold tabular-nums">
        {amount.toFixed(2)} {currency}
      </span>
    </div>
  );

  return (
    <>
      {lines.exchangeQuantity > 0
        ? row(
            isRtl
              ? `استبدال أسطوانات × ${lines.exchangeQuantity}`
              : `Cylinder exchange × ${lines.exchangeQuantity}`,
            lines.exchangeLineTotal
          )
        : null}
      {lines.newCylinderQuantity > 0
        ? row(
            isRtl
              ? `أسطوانات جديدة × ${lines.newCylinderQuantity}`
              : `New cylinders × ${lines.newCylinderQuantity}`,
            lines.newCylinderLineTotal
          )
        : null}
      {lines.deliveryFee > 0
        ? row(isRtl ? 'رسوم التوصيل' : 'Delivery fee', lines.deliveryFee)
        : null}
    </>
  );
}
