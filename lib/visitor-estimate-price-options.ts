import 'server-only';
import type { CapabilityContext } from './visitor-capabilities';
import { totalPublishedPrices } from './visitor-price-calculation';

/** Only expose variants that the same calculation boundary will accept. */
export function estimatePriceOptions(context: Pick<CapabilityContext, 'index'>, recordId: string) {
  const asOf = new Date().toISOString().slice(0, 10);
  const fields = context.index.space.fields.filter(field => field.type === 'money');
  return fields.flatMap(field => {
    try {
      const total = totalPublishedPrices(context.index, { lines: [{ recordId, fieldId: field.id, quantity: 1 }] }, asOf);
      const line = total.lines[0], basis = line.unit ?? line.per;
      return [{ fieldId: field.id, label: field.label, text: `${total.formattedSubtotal}${basis ? ` / ${basis}` : ''}`.slice(0, 160) }];
    } catch { return []; }
  }).slice(0, 16);
}
