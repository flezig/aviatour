"""Conservative normalization of Open Prices; not a restaurant-price estimator."""
from collections import defaultdict
from datetime import date
from decimal import Decimal, InvalidOperation
from statistics import median

# Daily groceries per adult; product taxonomy must match, all categories required.
BASKET = {'en:rice': ('kg', Decimal('.1')), 'en:breads': ('kg', Decimal('.15')),
          'en:eggs': ('unit', Decimal('2')), 'en:milks': ('l', Decimal('.25')),
          'en:apples': ('kg', Decimal('.2')), 'en:tomatoes': ('kg', Decimal('.2')),
          'en:chicken-breasts': ('kg', Decimal('.15')), 'en:yogurts': ('kg', Decimal('.125'))}

def unit_price(row, unit):
    try:
        price = Decimal(str(row['price']))
        if not price.is_finite() or price <= 0:
            return None
        price_per = row.get('price_per')
        if price_per == 'KILOGRAM' and unit == 'kg':
            return price
        product = row.get('product') or {}
        if price_per not in (None, 'UNIT'):
            return None
        quantity = Decimal(str(product.get('product_quantity')))
        q_unit = (product.get('product_quantity_unit') or '').lower()
        factor = {('g', 'kg'): Decimal('.001'), ('kg', 'kg'): Decimal(1),
                  ('ml', 'l'): Decimal('.001'), ('l', 'l'): Decimal(1),
                  ('unit', 'unit'): Decimal(1)}.get((q_unit, unit))
        if factor is None or not quantity.is_finite() or quantity <= 0:
            return None
        return price / (quantity * factor)
    except (KeyError, ValueError, TypeError, InvalidOperation, ZeroDivisionError):
        return None

def basket(rows, currency, city, today):
    groups = defaultdict(list)
    shops = defaultdict(set)
    seen = set()
    for row in rows:
        try:
            observed = date.fromisoformat(row['date'])
            if not 0 <= (today - observed).days <= 90 or row.get('duplicate_of') is not None or row.get('price_is_discounted') is not False or row.get('currency') != currency:
                continue
            location = row.get('location') or {}
            if location.get('osm_address_city') != city:
                continue
            product = row.get('product') or {}
            categories = set(product.get('categories_tags') or []) | {row.get('category_tag')}
            key = (row.get('product_code'), row.get('category_tag'), row.get('location_id'), row['date'])
            if key in seen or row.get('location_id') is None:
                continue
            seen.add(key)
            for category, (unit, _) in BASKET.items():
                if category in categories:
                    value = unit_price(row, unit)
                    if value is not None:
                        groups[category].append(value)
                        shops[category].add(row['location_id'])
        except (KeyError, TypeError, ValueError):
            continue
    missing = [c for c in BASKET if len(groups[c]) < 5 or len(shops[c]) < 3]
    if missing:
        return {'daily_cost': None, 'currency': currency, 'missing_categories': missing}
    cost = sum(median(groups[c]) * amount for c, (_, amount) in BASKET.items())
    return {'daily_cost': str(cost.quantize(Decimal('.01'))), 'currency': currency, 'missing_categories': []}
