// Extracts width/depth/height from free-text product descriptions or spec
// tables. Returns null for missing axes — the brief allows ~30% misses.
//
// Handles common AU furniture-listing formats:
//   "W220 x D95 x H82cm"
//   "W: 220cm  D: 95cm  H: 82cm"
//   "220W x 95D x 82H cm"
//   "Width 220 Depth 95 Height 82"
//   "220 x 95 x 82 cm"  (assume W x D x H)

const STRIP_TAGS = /<[^>]+>/g;
const NBSP = / /g;

export function parseDimensions(text) {
  if (!text) return { width_cm: null, depth_cm: null, height_cm: null };
  const clean = String(text).replace(STRIP_TAGS, ' ').replace(NBSP, ' ');

  // Detect the unit from the surrounding string. If the text mentions "mm"
  // and not "cm" near a dimension run, treat numeric values as millimetres
  // and divide by 10. Heuristic but reliable for furniture-spec strings.
  const unit = detectUnit(clean);
  const scale = (n) => (n == null ? null : Math.round((unit === 'mm' ? n / 10 : n) * 10) / 10);

  const width = extract(clean, /(?:W(?:idth)?[\s:]*)(\d{2,4}(?:\.\d+)?)/i) ??
    extract(clean, /(\d{2,4}(?:\.\d+)?)\s*W\b/i);
  const depth = extract(clean, /(?:D(?:epth)?[\s:]*)(\d{2,4}(?:\.\d+)?)/i) ??
    extract(clean, /(\d{2,4}(?:\.\d+)?)\s*D\b/i);
  const height = extract(clean, /(?:H(?:eight)?[\s:]*)(\d{2,4}(?:\.\d+)?)/i) ??
    extract(clean, /(\d{2,4}(?:\.\d+)?)\s*H\b/i);

  if (width != null && depth != null && height != null) {
    return { width_cm: scale(width), depth_cm: scale(depth), height_cm: scale(height) };
  }

  // Fallback: "220 x 95 x 82 cm" — assume W x D x H order.
  const triple = clean.match(/(\d{2,4}(?:\.\d+)?)\s*[xX×]\s*(\d{2,4}(?:\.\d+)?)\s*[xX×]\s*(\d{2,4}(?:\.\d+)?)/);
  if (triple) {
    return {
      width_cm: scale(width ?? Number(triple[1])),
      depth_cm: scale(depth ?? Number(triple[2])),
      height_cm: scale(height ?? Number(triple[3])),
    };
  }

  return { width_cm: scale(width), depth_cm: scale(depth), height_cm: scale(height) };
}

// Returns 'mm' if the dimension text is in millimetres, otherwise 'cm'. We
// prefer the unit that appears closest to a W/D/H/x×x pattern.
function detectUnit(text) {
  const sample = text.slice(0, 4000);
  const hasMM = /\d\s*mm\b/i.test(sample);
  const hasCM = /\d\s*cm\b/i.test(sample);
  if (hasMM && !hasCM) return 'mm';
  if (hasCM && !hasMM) return 'cm';
  // Both present — prefer whichever appears next to a W/D/H value.
  const nearMM = /[WDH][:\s]?\s*\d{2,4}\s*mm\b/i.test(sample);
  const nearCM = /[WDH][:\s]?\s*\d{2,4}\s*cm\b/i.test(sample);
  if (nearMM && !nearCM) return 'mm';
  return 'cm';
}

function extract(text, regex) {
  const m = text.match(regex);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}
