// Single place for everything that names the store. Change here, redeploy, done.

export const BRAND = {
  name: 'The Wardrobe Exchange',
  /** Short code for SKUs, eBay policy names and internal keys (letters only). */
  short: 'TWE',
  /** What buyers see on their card statement (max 22 chars). */
  descriptor: 'WARDROBE EXCHANGE',
  tagline: 'Pre-owned designer pieces, honestly photographed.',
  description:
    'A small, curated edit of pre-owned designer clothing. One of each. Every flaw photographed, nothing hidden.',
  /** Seller identity used in Terms, Privacy and email footers. */
  seller: {
    name: 'The Wardrobe Exchange (an independent seller)',
    city: 'Salt Lake City',
    state: 'Utah',
    stateCode: 'UT',
    // TODO(owner): replace with a PO box or mailing address before go-live (required for CAN-SPAM + Terms notices).
    mailingAddress: '[Mailing address — PO box OK]',
    email: 'hello@thewardrobeexchange.shop',
  },
  social: {
    instagram: 'thewardrobeexchange',
    ebay: 'thewardrobeexchange',
  },
  /** Buttondown username for the newsletter form; leave empty to hide the signup. */
  newsletter: {
    buttondownUsername: '',
  },
  /** Bump when the Terms / Photo Disclaimer change; stored on every order. */
  policyVersion: '2026-10-14',
  policyEffectiveDate: 'October 14, 2026',
  /** Days after delivery a buyer has to report an item materially not as described. */
  notAsDescribedWindowDays: 3,
};
