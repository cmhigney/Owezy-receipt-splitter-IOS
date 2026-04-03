import { ReceiptItem, Friend, PersonSummary, TipSplitMode } from '@/types';

export function calculateSummaries(
  items: ReceiptItem[],
  people: Friend[],
  tax: number,
  tip: number,
  tipSplitMode: TipSplitMode = 'proportional',
  _feeTotal: number = 0,
  _mandatoryChargeTotal: number = 0,
): PersonSummary[] {
  const overallSubtotal = items.reduce((sum, item) => sum + item.price, 0);
  if (overallSubtotal === 0) return [];

  const rawSummaries: PersonSummary[] = people.map((person) => {
    const personItems: { name: string; cost: number; splitCount?: number }[] = [];
    let itemSubtotal = 0;

    items.forEach((item) => {
      if (item.assignedTo.includes(person.id)) {
        const splitCount = item.assignedTo.length;
        const cost = Math.round((item.price / splitCount) * 100) / 100;
        personItems.push({ name: item.name, cost, splitCount });
        itemSubtotal += cost;
      }
    });

    const proportion = itemSubtotal / overallSubtotal;
    const taxShare = Math.round(tax * proportion * 100) / 100;
    const total = Math.round((itemSubtotal + taxShare) * 100) / 100;

    return {
      personId: person.id,
      personName: person.name,
      items: personItems,
      itemSubtotal: Math.round(itemSubtotal * 100) / 100,
      taxShare,
      tipShare: 0,
      total,
      paid: false,
    };
  });

  // BUG-M2 fix: correct tax rounding independently so the last person doesn't
  // absorb both a tax rounding error and a tip rounding error via the final
  // total correction pass.
  const expectedTaxTotal = Math.round(tax * 100) / 100;
  const actualTaxTotal = Math.round(rawSummaries.reduce((sum, s) => sum + s.taxShare, 0) * 100) / 100;
  const taxRoundingDiff = Math.round((expectedTaxTotal - actualTaxTotal) * 100) / 100;
  if (taxRoundingDiff !== 0 && rawSummaries.length > 0) {
    const lastRaw = rawSummaries[rawSummaries.length - 1];
    lastRaw.taxShare = Math.round((lastRaw.taxShare + taxRoundingDiff) * 100) / 100;
    lastRaw.total = Math.round((lastRaw.itemSubtotal + lastRaw.taxShare) * 100) / 100;
  }

  let tipShares = rawSummaries.map((summary) => {
    if (tipSplitMode === 'even' && rawSummaries.length > 0) {
      return Math.round((tip / rawSummaries.length) * 100) / 100;
    }
    const proportion = summary.itemSubtotal / overallSubtotal;
    return Math.round(tip * proportion * 100) / 100;
  });

  const expectedTip = Math.round(tip * 100) / 100;
  const actualTip = Math.round(tipShares.reduce((sum, share) => sum + share, 0) * 100) / 100;
  const tipDiff = Math.round((expectedTip - actualTip) * 100) / 100;
  if (tipDiff !== 0 && tipShares.length > 0) {
    tipShares[tipShares.length - 1] = Math.round((tipShares[tipShares.length - 1] + tipDiff) * 100) / 100;
  }

  const summaries: PersonSummary[] = rawSummaries.map((summary, index) => {
    const tipShare = tipShares[index] || 0;
    return {
      ...summary,
      tipShare,
      total: Math.round((summary.itemSubtotal + summary.taxShare + tipShare) * 100) / 100,
    };
  });

  const calculatedTotal = summaries.reduce((sum, s) => sum + s.total, 0);
  const expectedTotal = Math.round((overallSubtotal + tax + tip) * 100) / 100;
  const diff = Math.round((expectedTotal - calculatedTotal) * 100) / 100;

  if (diff !== 0 && summaries.length > 0) {
    const lastPerson = summaries[summaries.length - 1];
    lastPerson.total = Math.round((lastPerson.total + diff) * 100) / 100;
  }

  return summaries;
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

export function getRandomColor(index: number, colors: string[]): string {
  return colors[index % colors.length];
}
