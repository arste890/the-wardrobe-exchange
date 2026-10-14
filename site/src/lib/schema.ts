// schema.org JSON-LD builders for product pages.

import type { CatalogItem } from '@kw/shared/types';
import { CONDITION_LABELS } from '@kw/shared/types';
import { BRAND } from '@kw/shared/brand';
import { SHIPPING_DAYS, HANDLING_DAYS } from '@kw/shared/shipping';
import { plainText } from './format';

export function productJsonLd(item: CatalogItem, pageUrl: string, policiesUrl: string) {
  const availability =
    item.status === 'available' ? 'https://schema.org/InStock' : item.status === 'reserved' ? 'https://schema.org/LimitedAvailability' : 'https://schema.org/SoldOut';
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: `${item.brand} ${item.title}`,
    brand: { '@type': 'Brand', name: item.brand },
    sku: item.sku,
    image: item.photos.filter((p) => p.kind !== 'flaw').map((p) => p.jpg),
    description: `${CONDITION_LABELS[item.condition_grade]}. Size ${item.size_label}. ${plainText(item.description_md)}`.slice(0, 5000),
    itemCondition: item.condition_grade === 'new_with_tags' ? 'https://schema.org/NewCondition' : 'https://schema.org/UsedCondition',
    size: item.size_label,
    color: item.color ?? undefined,
    material: item.material ?? undefined,
    offers: {
      '@type': 'Offer',
      url: pageUrl,
      priceCurrency: 'USD',
      price: (item.price_cents / 100).toFixed(2),
      availability,
      itemCondition: item.condition_grade === 'new_with_tags' ? 'https://schema.org/NewCondition' : 'https://schema.org/UsedCondition',
      seller: { '@type': 'Organization', name: BRAND.name },
      shippingDetails: {
        '@type': 'OfferShippingDetails',
        shippingRate: { '@type': 'MonetaryAmount', value: (item.shipping_cents / 100).toFixed(2), currency: 'USD' },
        shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'US' },
        deliveryTime: {
          '@type': 'ShippingDeliveryTime',
          handlingTime: { '@type': 'QuantitativeValue', minValue: 0, maxValue: HANDLING_DAYS, unitCode: 'DAY' },
          transitTime: { '@type': 'QuantitativeValue', minValue: SHIPPING_DAYS.min, maxValue: SHIPPING_DAYS.max, unitCode: 'DAY' },
        },
      },
      hasMerchantReturnPolicy: {
        '@type': 'MerchantReturnPolicy',
        applicableCountry: 'US',
        returnPolicyCategory: 'https://schema.org/MerchantReturnNotPermitted',
        merchantReturnLink: policiesUrl,
      },
    },
  };
}

export function breadcrumbJsonLd(crumbs: { name: string; url: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: c.url })),
  };
}

export function organizationJsonLd(siteUrl: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'OnlineStore',
    name: BRAND.name,
    url: siteUrl,
    description: BRAND.description,
    email: BRAND.seller.email,
    areaServed: 'US',
    sameAs: [`https://www.instagram.com/${BRAND.social.instagram}`],
  };
}
