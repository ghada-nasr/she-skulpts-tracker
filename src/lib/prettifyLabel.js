/**
 * prettifyLabel — converts taxonomy values to user-friendly display strings.
 *
 * Used across the app to render movement_pattern, primary_muscles, equipment,
 * tags, categories, etc. consistently in Title Case while preserving acronyms,
 * already-correct casing, hyphens, and slashes.
 *
 * Rules:
 *   1. null / undefined / empty       → ''
 *   2. Arrays                         → recurse on each element, join with ', '
 *   3. Contains underscore            → replace _ with space, then Title Case
 *   4. All lowercase                  → Title Case
 *   5. Otherwise                      → return unchanged (protects acronyms,
 *                                       already-correct casing, numbers, etc.)
 *   6. Hyphens within words           → preserved, each segment Title Cased
 *   7. Slashes between words          → preserved as-is ("Bridge / Hip Drive")
 *
 * Examples:
 *   prettifyLabel('bilateral_squat')        → 'Bilateral Squat'
 *   prettifyLabel('Bridge / Hip Drive')     → 'Bridge / Hip Drive'      (unchanged)
 *   prettifyLabel('Multi-Pattern')          → 'Multi-Pattern'           (unchanged)
 *   prettifyLabel('ACL Injury Prevention')  → 'ACL Injury Prevention'   (acronym preserved)
 *   prettifyLabel('light_weight')           → 'Light Weight'
 *   prettifyLabel('glute_hypertrophy')      → 'Glute Hypertrophy'
 *   prettifyLabel('anti-extension')         → 'Anti-Extension'
 *   prettifyLabel('agility')                → 'Agility'
 *   prettifyLabel('KAS Glute Bridge')       → 'KAS Glute Bridge'        (acronym preserved)
 *   prettifyLabel(null)                     → ''
 *   prettifyLabel([])                       → ''
 *   prettifyLabel(['Glutes', 'quads'])      → 'Glutes, Quads'
 */
export function prettifyLabel(value) {
  if (value == null) return ''
  if (Array.isArray(value)) {
    return value.map(prettifyLabel).filter(Boolean).join(', ')
  }
  const str = String(value).trim()
  if (!str) return ''

  const hasUnderscore = str.includes('_')
  const isAllLowercase = str === str.toLowerCase() && /[a-z]/.test(str)

  // Preserve as-is if already properly cased (protects acronyms, mixed case)
  if (!hasUnderscore && !isAllLowercase) return str

  // Title-case each space-delimited word, respecting hyphens inside words
  return str
    .replace(/_/g, ' ')
    .split(' ')
    .map(word => {
      if (!word) return word
      if (word.includes('-')) {
        return word.split('-').map(seg =>
          seg ? seg[0].toUpperCase() + seg.slice(1).toLowerCase() : seg
        ).join('-')
      }
      return word[0].toUpperCase() + word.slice(1).toLowerCase()
    })
    .join(' ')
}

export default prettifyLabel
