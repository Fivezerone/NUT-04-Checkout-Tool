/**
 * declarative-engine.js — generic DOM parser driven by declarative adapter specs.
 *
 * Designed to satisfy Manifest V3 & Chrome Web Store rules:
 * - NO remotely executed code (eval / new Function forbidden).
 * - Specs are pure data (JSON) carrying ranked CSS selectors, attribute names, and regexes.
 * - Supports killSwitch per retailer to deactivate adapters remotely without an extension release.
 */

/**
 * Extract product information from a single DOM card element given a declarative spec.
 * @param {Element} card - DOM Element representing a product card
 * @param {object} spec - Declarative adapter specification
 * @returns {object|null} { retailer, id, name, price } or null if invalid / killswitched
 */
export function extractProductFromCard(card, spec) {
  if (!card || !spec || spec.killSwitch === true) return null;

  const retailer = spec.retailer || 'UNKNOWN';

  // 1. Extract ID
  let id = null;
  if (Array.isArray(spec.id)) {
    for (const rule of spec.id) {
      if (rule.attr) {
        const target = rule.selector ? card.querySelector(rule.selector) : card;
        const val = target?.getAttribute?.(rule.attr);
        if (val) {
          id = String(val).trim();
          break;
        }
      }
      if (rule.hrefRegex) {
        const links = card.querySelectorAll ? card.querySelectorAll('a[href]') : [];
        for (const a of links) {
          const href = a.getAttribute('href') || '';
          const match = href.match(new RegExp(rule.hrefRegex));
          if (match && match[1]) {
            id = String(match[1]).trim();
            break;
          }
        }
        if (id) break;
      }
    }
  }

  if (!id) return null;

  // 2. Extract Name (ranked selector list)
  let name = '';
  if (Array.isArray(spec.name)) {
    for (const sel of spec.name) {
      const el = card.querySelector?.(sel);
      if (el && el.textContent) {
        name = el.textContent.trim();
        if (name) break;
      }
    }
  }

  // 3. Extract Price
  let price = null;
  if (spec.price?.selector) {
    const priceEl = card.querySelector?.(spec.price.selector);
    if (priceEl && priceEl.textContent) {
      const text = priceEl.textContent.replace(/[^0-9.]/g, '');
      const parsed = parseFloat(text);
      if (Number.isFinite(parsed)) price = parsed;
    }
  }

  return {
    retailer,
    id,
    name,
    price
  };
}

/**
 * Query product cards within a container using ranked card selectors.
 * @param {Element|Document} container
 * @param {object} spec
 * @returns {Element[]}
 */
export function findCards(container, spec) {
  if (!container || !spec || spec.killSwitch === true || !Array.isArray(spec.card)) return [];

  for (const sel of spec.card) {
    const elements = container.querySelectorAll?.(sel);
    if (elements && elements.length > 0) {
      return Array.from(elements);
    }
  }
  return [];
}

const NutriDeclarativeEngine = {
  extractProductFromCard,
  findCards
};

if (typeof self !== 'undefined') {
  self.NutriDeclarativeEngine = NutriDeclarativeEngine;
}

export default NutriDeclarativeEngine;
