/**
 * 通路結算：牌價（base_price）vs 通路規則價（系列折扣／規格覆寫）vs 明細實際 unit_price。
 */

export type PricingItemRow = {
  order_id: string;
  variant_id: string | null;
  quantity: number;
  unit_price: number;
  product_variants: { base_price: number | null; series_id: string | null } | null;
};

export type OrderPricingBreakdown = {
  listLineTotal: number;
  ruleLineTotal: number;
  actualLineTotal: number;
  shippingFee: number;
  listGrand: number;
  orderGrand: number;
};

function roundMoney(n: number): number {
  return Math.round(n);
}

function channelRuleUnitPrice(
  basePrice: number,
  seriesId: string,
  variantId: string,
  discountBySeriesId: Map<string, number>,
  overrideByVariantId: Map<string, number>
): number {
  const ov = overrideByVariantId.get(variantId);
  if (ov != null && Number.isFinite(ov)) return roundMoney(ov);
  const pct = discountBySeriesId.get(seriesId) ?? 0;
  return roundMoney(basePrice * (1 - pct / 100));
}

export function breakdownOrdersChannelPricing(
  items: PricingItemRow[],
  discountBySeriesId: Map<string, number>,
  overrideByVariantId: Map<string, number>,
  orderShippingById: Map<string, number>,
  orderTotalById: Map<string, number>
): Map<string, OrderPricingBreakdown> {
  const byOrder = new Map<
    string,
    { list: number; rule: number; actual: number; ship: number; grand: number }
  >();

  const ensure = (oid: string) => {
    if (!byOrder.has(oid)) {
      byOrder.set(oid, {
        list: 0,
        rule: 0,
        actual: 0,
        ship: orderShippingById.get(oid) ?? 0,
        grand: orderTotalById.get(oid) ?? 0,
      });
    }
    return byOrder.get(oid)!;
  };

  for (const row of items) {
    const oid = String(row.order_id);
    const q = Math.max(0, Number(row.quantity) || 0);
    const actualUnit = Number(row.unit_price) || 0;
    const agg = ensure(oid);
    agg.actual += roundMoney(actualUnit * q);

    const vid = row.variant_id != null ? String(row.variant_id) : null;
    const pv = row.product_variants;
    if (!vid || !pv || pv.series_id == null || pv.base_price == null) {
      agg.list += roundMoney(actualUnit * q);
      agg.rule += roundMoney(actualUnit * q);
      continue;
    }

    const base = Number(pv.base_price);
    if (!Number.isFinite(base)) {
      agg.list += roundMoney(actualUnit * q);
      agg.rule += roundMoney(actualUnit * q);
      continue;
    }

    const sid = String(pv.series_id);
    agg.list += roundMoney(base * q);
    const ruleUnit = channelRuleUnitPrice(base, sid, vid, discountBySeriesId, overrideByVariantId);
    agg.rule += roundMoney(ruleUnit * q);
  }

  const out = new Map<string, OrderPricingBreakdown>();
  for (const [oid, v] of byOrder) {
    const ship = orderShippingById.get(oid) ?? v.ship;
    const grand = orderTotalById.get(oid) ?? v.grand;
    out.set(oid, {
      listLineTotal: v.list,
      ruleLineTotal: v.rule,
      actualLineTotal: v.actual,
      shippingFee: ship,
      listGrand: v.list + ship,
      orderGrand: grand,
    });
  }

  return out;
}
