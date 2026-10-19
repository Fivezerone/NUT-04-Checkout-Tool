/**
 * decoyLegalDocs.ts
 *
 * User-readable decoy / placeholder documents for Terms of Service and Privacy Policy.
 * These are clearly readable, structured, sensible for NutriScore's nutritional analysis tool,
 * and easily replaceable once legally compliant versions are formally drafted.
 */

export interface LegalDoc {
  title: string;
  version: string;
  lastUpdated: string;
  isDraft: boolean;
  sections: Array<{
    heading: string;
    content: string;
  }>;
}

export const DECOY_TERMS_OF_SERVICE: LegalDoc = {
  title: "NutriScore Terms of Service",
  version: "v1.0-draft (Replaceable Decoy)",
  lastUpdated: "October 2026",
  isDraft: true,
  sections: [
    {
      heading: "1. Notice & Replacement Status",
      content:
        "This document is a user-readable draft decoy designed to outline the operational terms of the NutriScore browser extension. It is pending final legal review and will be superseded by the compliant final version upon publication."
    },
    {
      heading: "2. Nutritional Analysis & Medical Disclaimer",
      content:
        "NutriScore is an informational, educational decision-support tool created to analyze grocery items and highlight nutritional metrics (such as sugar, sodium, saturated fat, and energy density). NutriScore does NOT provide medical advice, diagnosis, or treatment. Always consult qualified healthcare professionals regarding personal medical conditions or dietary requirements."
    },
    {
      heading: "3. Service Tiers & Accounts",
      content:
        "NutriScore offers Basic (Free) and Premium tiers. Basic tier provides nutritional badges on supported retailer websites. Premium tier unlocks dashboard analytics, historical basket health tracking, and tailored dietary mode settings. Subscription terms, payment methods (M-Pesa, Card), and expiration periods are presented during checkout."
    },
    {
      heading: "4. Retailer Compatibility & Third-Party Sites",
      content:
        "NutriScore operates by analyzing publicly accessible product information on supported retailer sites (such as Carrefour and Naivas). We are not affiliated with, endorsed by, or partnered with these retailers. Retailers may alter their web layouts or pricing without notice."
    },
    {
      heading: "5. User Responsibilities & Acceptable Use",
      content:
        "You agree to use NutriScore solely for personal grocery analysis in compliance with applicable laws. You agree not to attempt to reverse engineer, disrupt the service, or abuse backend APIs."
    },
    {
      heading: "6. Limitation of Liability",
      content:
        "To the fullest extent permitted by law, NutriScore and its contributors are not liable for indirect, incidental, or consequential damages resulting from dietary decisions or reliance on product badges."
    }
  ]
};

export const DECOY_PRIVACY_POLICY: LegalDoc = {
  title: "NutriScore Privacy Policy",
  version: "v1.0-draft (Replaceable Decoy)",
  lastUpdated: "October 2026",
  isDraft: true,
  sections: [
    {
      heading: "1. Notice & Replacement Status",
      content:
        "This document is a user-readable draft decoy detailing NutriScore's privacy practices. It is pending final legal review and will be replaced by the formal compliant policy once drafted."
    },
    {
      heading: "2. Local-First Privacy Commitment",
      content:
        "NutriScore is built on a privacy-first, local-execution architecture. Your active health focus (such as diabetes, hypertension, or kidney dietary indicators) and nutritional flags are evaluated locally on your device and are NEVER shared with third-party advertising networks or tracking brokers."
    },
    {
      heading: "3. Information We Collect",
      content:
        "When you create an account, we collect your name and email address to manage authentication and verify your subscription tier. We collect anonymized, aggregated telemetry to measure extension performance without identifiers."
    },
    {
      heading: "4. Information We Do NOT Collect",
      content:
        "We do NOT track or record your general web browsing history. We do NOT log individual product pages you browse to remote servers. Product catalog resolution is performed via pre-indexed local caches and static CDN content."
    },
    {
      heading: "5. Payment Data Security",
      content:
        "Payments are processed securely through certified providers (M-Pesa / Safaricom Daraja and Paystack). NutriScore never sees, receives, or stores your M-Pesa PIN, credit card numbers, or banking credentials."
    },
    {
      heading: "6. Your Data Rights & Deletion",
      content:
        "You may export or delete your local extension data at any time via the Settings page. You can request complete deletion of your account and associated subscription records by contacting our support channel."
    }
  ]
};
