import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from './supabase.js'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

// ════════════════════════════════════════════════════════════════════
// SHE SKULPTS — COACHING OS
// v2.0 — Foundations rebuild
// ════════════════════════════════════════════════════════════════════
//
// ARCHITECTURE NOTES (read me before changing things):
//
// 1. SESSION NUMBERING is *derived at render time*, never stored.
//    The `note` column is now ONLY the coach's free-text note.
//    The "Session #N" label is computed from position-within-package
//    among non-cancelled sessions. This auto-heals if rows are deleted
//    or backfilled out of order. Old data that has "Session #N — text"
//    or just "Session #N" baked into the note is stripped on render.
//
// 2. CLIENT LIFECYCLE uses the `status` column with values:
//    active | trial | paused | completed | archived | former
//    Archived clients are hidden from default views but recoverable.
//
// 3. WORKOUT BLOCKS now support GROUPS. New columns on exercise_blocks:
//    - section_type: warmup | activation | main | conditioning | mobility | cooldown
//    - block_type: single | superset | triset | giantset | circuit | complex | contrast | prefatigue
//    - group_label: A, B, C, ... (which group within the section)
//    - group_position: 1, 2, 3, ... (which exercise within the group)
//    - category: movement category (strength/mobility/etc — see CATEGORIES)
//
// 4. MEDIA INTEGRATION PLAN (deferred but architected):
//    - Each exercise will have an `exercise_id` linking to a global
//      `exercises` table (master library) — keeps blocks lightweight.
//    - Master `exercises` row will carry: media_url, gif_url, video_url,
//      thumbnail_url, plus metadata (equipment, muscles, level).
//    - Media hosted via Supabase Storage buckets:
//        `exercise-gifs`   (animated, low-res, eager load)
//        `exercise-videos` (mp4, lazy load on demand)
//        `exercise-thumbs` (poster frames)
//    - Mobile loading strategy: gif eager for visible card, video on tap.
//    - For now exercise_blocks stores a plain exercise_name string.
//      Migration path: a future `exercise_id FOREIGN KEY` column will be
//      added and backfilled via fuzzy match against the master library.
//
// 5. SMART COACH is heuristic-only at this stage. The analyzer reads
//    blocks and produces flags: volume, redundancy, balance, sequencing.
//    The intelligence layer (RPE, fatigue, periodization rules from your
//    PDFs/chats 1–38) plugs in via the same `analyzeDay()` function.
//
// ════════════════════════════════════════════════════════════════════

// ─── Brand tokens ──────────────────────────────────────────────────────────
const C = {
  sage: '#8CA199', sageDark: '#575C59', sageMid: '#737B76',
  sageLight: '#C8D6CE', sageXLight: '#ABB7B0',
  cream: '#EFE6DA', creamLight: '#F8F4EE', creamDark: '#BBB9AE',
  white: '#FFFFFF', amber: '#B8732A', amberLight: '#D89A5C',
  rose: '#9B6B6B', plum: '#7A5D6E',
  ok: '#6B8F7A', warn: '#B8732A', danger: '#9B5A5A',
}
const MONO = "'DM Mono', monospace"
const SERIF = "'Libre Baskerville', Georgia, serif"

// ─── Helpers ───────────────────────────────────────────────────────────────
const fmt = n => `AED ${Number(n || 0).toLocaleString()}`
const today = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

// Parse "15 Apr 2026" style dates safely. Returns Date or null.
const parseDate = (s) => {
  if (!s) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

// Sort sessions chronologically with created_at as tiebreaker — STABLE.
const sortSessions = arr => [...arr].sort((a, b) => {
  const da = parseDate(a.date)?.getTime() ?? 0
  const db = parseDate(b.date)?.getTime() ?? 0
  if (da !== db) return da - db
  const ca = a.created_at ? new Date(a.created_at).getTime() : 0
  const cb = b.created_at ? new Date(b.created_at).getTime() : 0
  return ca - cb
})

// Strip baked-in "Session #N" or "Cancelled..." prefix from legacy notes.
const cleanLegacyNote = (note) => {
  if (!note) return ''
  let s = String(note).trim()
  s = s.replace(/^Session\s*#?\d+\s*[—–-]?\s*/i, '')
  s = s.replace(/^Cancelled(?:\s*\([^)]*\))?\s*[—–-]?\s*/i, '')
  s = s.replace(/^Not\s+counted[^—–-]*[—–-]?\s*/i, '')
  return s.trim()
}

// Compute display label for a session: "Session #3" or "Cancelled".
// `sortedPkgSessions` MUST be the sorted list for that package.
const sessionLabel = (s, sortedPkgSessions) => {
  if (s.cancelled) return 'Cancelled'
  const nonCancelled = sortedPkgSessions.filter(x => !x.cancelled)
  const idx = nonCancelled.findIndex(x => x.id === s.id)
  return `Session #${idx + 1}`
}

// ─── Lifecycle ─────────────────────────────────────────────────────────────
const LIFECYCLE = {
  active:    { label: 'Active',     short: 'Active',  color: C.sage,      tone: 'good' },
  trial:     { label: 'Trial',      short: 'Trial',   color: C.amberLight,tone: 'note' },
  paused:    { label: 'Paused',     short: 'Paused',  color: C.sageMid,   tone: 'mute' },
  completed: { label: 'Pkg Done',   short: 'Done',    color: C.sageMid,   tone: 'mute' },
  archived:  { label: 'Archived',   short: 'Arch.',   color: C.creamDark, tone: 'mute' },
  former:    { label: 'Former',     short: 'Former',  color: C.rose,      tone: 'mute' },
}
const lifecycleOf = (c) => LIFECYCLE[c?.status] || LIFECYCLE.active

// ─── Movement categories ──────────────────────────────────────────────────
const CATEGORIES = [
  { value: 'strength',      label: 'Strength',         color: '#5E7D71' },
  { value: 'hypertrophy',   label: 'Hypertrophy',      color: '#7A8D69' },
  { value: 'power',         label: 'Power',            color: '#B8732A' },
  { value: 'athletic',      label: 'Athletic Perf.',   color: '#9B6B3F' },
  { value: 'conditioning',  label: 'Conditioning',     color: '#A86A4A' },
  { value: 'stability',     label: 'Stability',        color: '#6A8589' },
  { value: 'activation',    label: 'Activation',       color: '#9DAB7A' },
  { value: 'mobility',      label: 'Mobility',         color: '#7E9BAB' },
  { value: 'dynamic_str',   label: 'Dynamic Stretch',  color: '#8FB0BC' },
  { value: 'static_str',    label: 'Static Stretch',   color: '#A1B7C2' },
  { value: 'prehab',        label: 'Prehab',           color: '#8B9B6B' },
  { value: 'rehab',         label: 'Rehab',            color: '#9B6B6B' },
  { value: 'recovery',      label: 'Recovery',         color: '#B0A599' },
]
const categoryColor = (v) => CATEGORIES.find(c => c.value === v)?.color || C.sageMid
const categoryLabel = (v) => CATEGORIES.find(c => c.value === v)?.label || ''

const SECTIONS = [
  { value: 'warmup',       label: 'Warm-Up',     icon: '○' },
  { value: 'activation',   label: 'Activation',  icon: '◐' },
  { value: 'main',         label: 'Main Work',   icon: '●' },
  { value: 'conditioning', label: 'Conditioning',icon: '◑' },
  { value: 'mobility',     label: 'Mobility',    icon: '◇' },
  { value: 'cooldown',     label: 'Cooldown',    icon: '○' },
]
const sectionLabel = (v) => SECTIONS.find(s => s.value === v)?.label || 'Main Work'

const BLOCK_TYPES = [
  { value: 'single',     label: 'Single',     min: 1, max: 1 },
  { value: 'superset',   label: 'Superset',   min: 2, max: 2 },
  { value: 'triset',     label: 'Tri-Set',    min: 3, max: 3 },
  { value: 'giantset',   label: 'Giant Set',  min: 4, max: 8 },
  { value: 'circuit',    label: 'Circuit',    min: 3, max: 12 },
  { value: 'complex',    label: 'Complex',    min: 2, max: 6 },
  { value: 'contrast',   label: 'Contrast',   min: 2, max: 4 },
  { value: 'prefatigue', label: 'Pre-Fatigue',min: 2, max: 3 },
]
const blockTypeLabel = (v) => BLOCK_TYPES.find(b => b.value === v)?.label || 'Single'

// Group blocks by (section_type, group_label). Returns array of section
// objects { section, groups: [{ label, type, blocks }] } in stable order.
const groupBlocks = (blocks) => {
  const ordered = [...blocks].sort((a, b) => (a.block_order || 0) - (b.block_order || 0))
  const sections = []
  const sectionMap = new Map()
  for (const b of ordered) {
    const sec = b.section_type || 'main'
    if (!sectionMap.has(sec)) {
      const obj = { section: sec, groups: [], groupMap: new Map() }
      sectionMap.set(sec, obj)
      sections.push(obj)
    }
    const sObj = sectionMap.get(sec)
    const gl = (b.group_label || '').toUpperCase().trim()
    const key = gl || `__solo_${b.id}` // ungrouped = its own group
    if (!sObj.groupMap.has(key)) {
      const gObj = { label: gl || null, type: b.block_type || 'single', blocks: [] }
      sObj.groupMap.set(key, gObj)
      sObj.groups.push(gObj)
    }
    sObj.groupMap.get(key).blocks.push(b)
  }
  // sort blocks inside each group by group_position then block_order
  for (const s of sections) {
    for (const g of s.groups) {
      g.blocks.sort((a, b) => (a.group_position || 0) - (b.group_position || 0) || (a.block_order || 0) - (b.block_order || 0))
    }
  }
  // sort sections in SECTIONS order
  const order = SECTIONS.map(s => s.value)
  sections.sort((a, b) => order.indexOf(a.section) - order.indexOf(b.section))
  return sections
}

// ─── Smart Coach analyzer (heuristic v1) ──────────────────────────────────
// Returns { rating, summary, flags: [{ level, label, body }] }
// level: 'ok' | 'note' | 'warn'
const REGION_KEYWORDS = {
  lower:    ['squat','lunge','leg','glute','hamstring','calf','rdl','deadlift','hip thrust','step up','step-up','split squat','bulgarian'],
  upperPush:['press','push','dip','bench','overhead','ohp','db press'],
  upperPull:['pull','row','chin','curl','face pull','pulldown','pull-up','pullup'],
  core:     ['plank','ab ','abs','crunch','sit-up','sit up','dead bug','dead-bug','pallof','copenhagen','hollow','rollout','carry','suitcase'],
  rotation: ['twist','rotation','chop','wood','windmill'],
  power:    ['clean','snatch','jerk','jump','plyometric','plyo','box jump','bound','sprint','throw','slam'],
}
const tagRegion = (name) => {
  const n = String(name || '').toLowerCase()
  const tags = []
  for (const k in REGION_KEYWORDS) if (REGION_KEYWORDS[k].some(w => n.includes(w))) tags.push(k)
  return tags
}

const analyzeDay = (blocks) => {
  if (!blocks || blocks.length === 0) {
    return { rating: null, summary: 'Empty day', flags: [], stats: null }
  }
  const setsTotal = blocks.reduce((a, b) => a + (parseInt(b.sets) || 0), 0)
  const catCounts = {}
  for (const b of blocks) if (b.category) catCounts[b.category] = (catCounts[b.category] || 0) + 1
  const sectionCounts = {}
  for (const b of blocks) sectionCounts[b.section_type || 'main'] = (sectionCounts[b.section_type || 'main'] || 0) + 1
  const regionCounts = { lower: 0, upperPush: 0, upperPull: 0, core: 0, rotation: 0, power: 0 }
  for (const b of blocks) for (const t of tagRegion(b.exercise_name)) regionCounts[t]++

  const flags = []
  // Volume
  if (setsTotal > 32) flags.push({ level: 'warn', label: 'High volume', body: `${setsTotal} total sets — consider recovery demands.` })
  else if (setsTotal > 22) flags.push({ level: 'note', label: 'Moderate-high volume', body: `${setsTotal} sets — monitor fatigue.` })
  // Warmup
  if (!sectionCounts.warmup && !sectionCounts.activation) flags.push({ level: 'warn', label: 'No warm-up', body: 'No warm-up or activation block found.' })
  // Mobility
  if (!sectionCounts.mobility && !sectionCounts.cooldown && (catCounts.mobility || 0) === 0) {
    flags.push({ level: 'note', label: 'No mobility', body: 'Consider adding mobility or cooldown.' })
  }
  // Upper/Lower balance (only main blocks)
  const mainBlocks = blocks.filter(b => (b.section_type || 'main') === 'main')
  const mainCounts = { lower: 0, upper: 0, core: 0 }
  for (const b of mainBlocks) {
    const tags = tagRegion(b.exercise_name)
    if (tags.includes('lower')) mainCounts.lower++
    if (tags.includes('upperPush') || tags.includes('upperPull')) mainCounts.upper++
    if (tags.includes('core')) mainCounts.core++
  }
  if (mainCounts.lower > 0 && mainCounts.upper > 0) {
    const diff = Math.abs(mainCounts.lower - mainCounts.upper)
    const ratio = diff / Math.max(mainCounts.lower, mainCounts.upper)
    if (ratio >= 0.6) flags.push({ level: 'note', label: 'Region skew', body: `Upper ${mainCounts.upper} · Lower ${mainCounts.lower} — heavy bias.` })
  }
  // Push/Pull balance
  if (regionCounts.upperPush > 0 || regionCounts.upperPull > 0) {
    const d = Math.abs(regionCounts.upperPush - regionCounts.upperPull)
    if (d >= 2) flags.push({ level: 'note', label: 'Push/Pull skew', body: `Push ${regionCounts.upperPush} · Pull ${regionCounts.upperPull}.` })
  }
  // Redundancy: 3+ consecutive blocks tagged same region
  let streak = { tag: null, count: 0 }
  for (const b of mainBlocks) {
    const tags = tagRegion(b.exercise_name)
    const primary = tags[0] || null
    if (primary && primary === streak.tag) {
      streak.count++
      if (streak.count === 3) flags.push({ level: 'note', label: 'Possible redundancy', body: `3 consecutive ${primary} exercises.` })
    } else {
      streak = { tag: primary, count: 1 }
    }
  }
  // Power placement: power should come early
  const powerIdxs = mainBlocks.map((b, i) => tagRegion(b.exercise_name).includes('power') ? i : -1).filter(i => i >= 0)
  if (powerIdxs.length > 0 && powerIdxs[0] >= mainBlocks.length / 2) {
    flags.push({ level: 'note', label: 'Power placement', body: 'Power work appears late — usually performed when fresh.' })
  }

  // Overall rating
  const warnCount = flags.filter(f => f.level === 'warn').length
  const noteCount = flags.filter(f => f.level === 'note').length
  let rating = 'ok', summary = 'Well-structured'
  if (warnCount >= 2) { rating = 'warn'; summary = 'Needs review' }
  else if (warnCount === 1) { rating = 'note'; summary = 'Minor issue' }
  else if (noteCount >= 2) { rating = 'note'; summary = 'A few suggestions' }
  else if (noteCount === 1) { rating = 'ok'; summary = 'Solid — one note' }

  return {
    rating, summary, flags,
    stats: {
      blocks: blocks.length,
      sets: setsTotal,
      sections: sectionCounts,
      categories: catCounts,
      regions: regionCounts,
    }
  }
}

// ─── Small UI components ───────────────────────────────────────────────────
const Mono = ({ children, style = {} }) => (
  <span style={{ fontFamily: MONO, ...style }}>{children}</span>
)

const Pill = ({ children, color = C.sage, bg, border, style = {} }) => (
  <span style={{
    fontSize: 8, fontFamily: MONO, letterSpacing: '2px', textTransform: 'uppercase',
    padding: '3px 9px', borderRadius: 99,
    background: bg || `${color}22`,
    color, border: `1px solid ${border || color + '50'}`,
    fontWeight: 600, whiteSpace: 'nowrap', ...style,
  }}>{children}</span>
)

const LifecyclePill = ({ status }) => {
  const lc = LIFECYCLE[status] || LIFECYCLE.active
  return <Pill color={lc.color}>{lc.short}</Pill>
}

const ProgressBar = ({ done, total, height = 5 }) => {
  const pct = Math.min((done / total) * 100, 100)
  const near = done >= total - 2, isDone = done >= total
  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <Mono style={{ fontSize: 10, color: C.sageMid }}>{done}/{total}</Mono>
        <Mono style={{ fontSize: 10, color: isDone ? C.sage : near ? C.amber : C.sageMid, fontWeight: near ? 700 : 400 }}>
          {isDone ? 'DONE ✓' : near ? `${total - done} left` : `${Math.round(pct)}%`}
        </Mono>
      </div>
      <div style={{ height, background: `${C.creamDark}50`, borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: isDone ? C.sageMid : near ? C.amber : C.sage, borderRadius: 99, transition: 'width .5s' }} />
      </div>
    </div>
  )
}

const Toast = ({ msg }) => (
  <div style={{
    position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)',
    background: C.sageDark, color: C.cream, padding: '10px 22px', borderRadius: 99,
    fontSize: 12, fontFamily: MONO, zIndex: 999, boxShadow: '0 6px 24px rgba(0,0,0,.25)',
    letterSpacing: '0.5px', whiteSpace: 'nowrap',
  }}>{msg}</div>
)

const Spinner = () => (
  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 40 }}>
    <div style={{ width: 28, height: 28, border: `2px solid ${C.sageLight}`, borderTopColor: C.sage, borderRadius: '50%', animation: 'sk-spin 0.8s linear infinite' }} />
    <style>{`@keyframes sk-spin { to { transform: rotate(360deg); } }`}</style>
  </div>
)

const Header = ({ title, subtitle, onBack, right, compact }) => (
  <div style={{ background: C.sageDark, padding: onBack ? '18px 20px 16px' : '22px 20px 14px', position: 'sticky', top: 0, zIndex: 20 }}>
    {onBack && (
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: C.sageLight, fontSize: 12, fontFamily: MONO, padding: 0, marginBottom: 10, cursor: 'pointer' }}>← Back</button>
    )}
    {!onBack && !compact && (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
        <Mono style={{ fontSize: 8, letterSpacing: '4px', color: C.sageLight, textTransform: 'uppercase' }}>She Skulpts</Mono>
        <Mono style={{ fontSize: 8, color: `${C.sageLight}50` }}>·</Mono>
        <Mono style={{ fontSize: 8, letterSpacing: '2px', color: `${C.sageLight}60`, textTransform: 'uppercase', fontStyle: 'italic' }}>it's you, just sculpted</Mono>
      </div>
    )}
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h1 style={{ margin: 0, fontSize: onBack ? 24 : 26, fontWeight: 400, color: C.creamLight, fontFamily: SERIF, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</h1>
        {subtitle && <Mono style={{ fontSize: 11, color: C.sageLight, marginTop: 4, display: 'block' }}>{subtitle}</Mono>}
      </div>
      {right}
    </div>
  </div>
)

const BottomNav = ({ tab, setTab }) => (
  <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: C.sageDark, display: 'flex', borderTop: `1px solid ${C.sageMid}60`, paddingBottom: 'env(safe-area-inset-bottom, 12px)', zIndex: 50 }}>
    {[
      { id: 'clients',  label: 'Clients',  icon: '◈' },
      { id: 'library',  label: 'Library',  icon: '◇' },
      { id: 'revenue',  label: 'Revenue',  icon: '◎' },
    ].map(t => (
      <button key={t.id} onClick={() => setTab(t.id)} style={{ flex: 1, padding: '10px 0 6px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
        <span style={{ fontSize: 16, color: tab === t.id ? C.sageLight : `${C.cream}30`, transition: 'color .2s' }}>{t.icon}</span>
        <Mono style={{ fontSize: 8, letterSpacing: '1.5px', textTransform: 'uppercase', color: tab === t.id ? C.sageLight : `${C.cream}25`, transition: 'color .2s' }}>{t.label}</Mono>
      </button>
    ))}
  </div>
)

const Input = ({ label, value, onChange, placeholder, type = 'text', style = {} }) => (
  <div style={{ marginBottom: 12, ...style }}>
    {label && <Mono style={{ fontSize: 9, letterSpacing: '2px', color: C.sageMid, textTransform: 'uppercase', display: 'block', marginBottom: 5 }}>{label}</Mono>}
    <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} type={type}
      style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: `1px solid ${C.creamDark}`, background: C.white, fontSize: 15, color: C.sageDark, fontFamily: SERIF, outline: 'none', boxSizing: 'border-box' }}
    />
  </div>
)

const Textarea = ({ label, value, onChange, placeholder, rows = 3 }) => (
  <div style={{ marginBottom: 12 }}>
    {label && <Mono style={{ fontSize: 9, letterSpacing: '2px', color: C.sageMid, textTransform: 'uppercase', display: 'block', marginBottom: 5 }}>{label}</Mono>}
    <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows}
      style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: `1px solid ${C.creamDark}`, background: C.white, fontSize: 14, color: C.sageDark, fontFamily: SERIF, outline: 'none', boxSizing: 'border-box', resize: 'vertical' }}
    />
  </div>
)

const Select = ({ label, value, onChange, options, style = {} }) => (
  <div style={{ marginBottom: 12, ...style }}>
    {label && <Mono style={{ fontSize: 9, letterSpacing: '2px', color: C.sageMid, textTransform: 'uppercase', display: 'block', marginBottom: 5 }}>{label}</Mono>}
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: `1px solid ${C.creamDark}`, background: C.white, fontSize: 14, color: C.sageDark, fontFamily: MONO, outline: 'none', appearance: 'none', boxSizing: 'border-box' }}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </div>
)

const Btn = ({ children, onClick, color = C.sage, text = C.white, small = false, outline = false, full = false, disabled = false, style = {} }) => (
  <button onClick={onClick} disabled={disabled} style={{
    padding: small ? '8px 14px' : '14px 20px',
    background: disabled ? C.creamDark : outline ? 'transparent' : color,
    color: outline ? color : text,
    border: outline ? `1px solid ${color}` : 'none',
    borderRadius: 10, fontSize: small ? 11 : 13,
    fontFamily: MONO, letterSpacing: '1.5px', textTransform: 'uppercase',
    cursor: disabled ? 'not-allowed' : 'pointer', fontWeight: 500,
    width: full ? '100%' : 'auto',
    opacity: disabled ? 0.6 : 1,
    ...style,
  }}>{children}</button>
)

const Card = ({ children, onClick, style = {}, accent }) => (
  <div onClick={onClick} style={{
    background: C.white, borderRadius: 12, padding: 15, marginBottom: 9,
    cursor: onClick ? 'pointer' : 'default',
    boxShadow: '0 1px 5px rgba(0,0,0,.06)',
    borderLeft: accent ? `3px solid ${accent}` : 'none',
    ...style,
  }}>{children}</div>
)

// ─── Bottom sheet modal ────────────────────────────────────────────────────
const Sheet = ({ open, onClose, title, children, maxHeight = '90vh' }) => {
  if (!open) return null
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 100, display: 'flex', alignItems: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: C.creamLight, borderRadius: '16px 16px 0 0', padding: '20px 18px 34px', width: '100%', maxHeight, overflowY: 'auto', boxSizing: 'border-box' }}>
        {title && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
            <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 20, color: C.sageDark, margin: 0 }}>{title}</h2>
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, color: C.sageMid, cursor: 'pointer', padding: 4 }}>✕</button>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}

const ConfirmDialog = ({ open, title, body, danger, confirmLabel = 'Confirm', onConfirm, onClose }) => {
  if (!open) return null
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 110, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 20px' }}>
      <div style={{ background: C.creamLight, borderRadius: 16, padding: '22px 20px', width: '100%', maxWidth: 360 }}>
        <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 19, color: C.sageDark, marginBottom: 8, marginTop: 0 }}>{title}</h2>
        {body && <p style={{ fontFamily: MONO, fontSize: 12, color: C.sageMid, marginBottom: 16, lineHeight: 1.5 }}>{body}</p>}
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: 13, background: 'none', border: `1px solid ${C.creamDark}`, borderRadius: 10, fontSize: 13, fontFamily: MONO, color: C.sageMid, cursor: 'pointer' }}>Cancel</button>
          <button onClick={onConfirm} style={{ flex: 1, padding: 13, background: danger ? C.danger : C.sage, border: 'none', borderRadius: 10, fontSize: 13, fontFamily: MONO, color: C.white, cursor: 'pointer', letterSpacing: '1.5px', textTransform: 'uppercase' }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

// ─── Long-press / action menu ──────────────────────────────────────────────
const useLongPress = (onLongPress, ms = 500) => {
  const t = useRef(null)
  const fired = useRef(false)
  const start = (e) => {
    fired.current = false
    t.current = setTimeout(() => { fired.current = true; onLongPress(e) }, ms)
  }
  const cancel = () => { if (t.current) clearTimeout(t.current); t.current = null }
  return {
    onMouseDown: start, onMouseUp: cancel, onMouseLeave: cancel,
    onTouchStart: start, onTouchEnd: cancel, onTouchCancel: cancel,
    didFire: () => fired.current,
  }
}

const ActionMenu = ({ open, onClose, actions }) => {
  if (!open) return null
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 105, display: 'flex', alignItems: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: C.creamLight, borderRadius: '16px 16px 0 0', width: '100%', padding: '8px 0 30px', boxSizing: 'border-box' }}>
        {actions.map((a, i) => (
          <button key={i} onClick={() => { a.onClick(); onClose() }} disabled={a.disabled}
            style={{
              width: '100%', padding: '14px 22px', background: 'none', border: 'none',
              textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12,
              fontFamily: MONO, fontSize: 13, color: a.danger ? C.danger : C.sageDark,
              cursor: a.disabled ? 'not-allowed' : 'pointer',
              borderBottom: i < actions.length - 1 ? `1px solid ${C.creamDark}40` : 'none',
              opacity: a.disabled ? 0.4 : 1,
            }}>
            <span style={{ fontSize: 16, width: 22 }}>{a.icon}</span>
            <span style={{ letterSpacing: '1px' }}>{a.label}</span>
          </button>
        ))}
        <button onClick={onClose} style={{ width: '100%', padding: '14px 22px', background: 'none', border: 'none', fontFamily: MONO, fontSize: 12, color: C.sageMid, cursor: 'pointer', textAlign: 'center', marginTop: 4 }}>CANCEL</button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// CLIENTS TAB
// ═══════════════════════════════════════════════════════════════════
function ClientsTab({ clients, setClients, onOpen }) {
  const [filter, setFilter] = useState('active') // active | trial | paused | completed | archived | all
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', package_size: '10', rate: '', location: '', stars: '0', status: 'active' })
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)
  const [menuFor, setMenuFor] = useState(null) // client object
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [confirmArchive, setConfirmArchive] = useState(null)

  const showToast = msg => { setToast(msg); setTimeout(() => setToast(null), 2500) }

  const filtered = clients.filter(c => {
    if (filter === 'all') return c.status !== 'archived'
    if (filter === 'archived') return c.status === 'archived'
    return c.status === filter
  })
  const nearEnd = clients.filter(c => c.status === 'active' && c.sessions_completed >= c.package_size - 2)

  const counts = {
    active: clients.filter(c => c.status === 'active').length,
    trial: clients.filter(c => c.status === 'trial').length,
    paused: clients.filter(c => c.status === 'paused').length,
    completed: clients.filter(c => c.status === 'completed').length,
    archived: clients.filter(c => c.status === 'archived').length,
  }

  const addClient = async () => {
    if (!form.name || !form.rate) return
    setSaving(true)
    const id = slug(form.name) + '_' + Date.now()
    const newClient = {
      id, name: form.name, package_size: parseInt(form.package_size),
      rate: parseInt(form.rate), stars: parseInt(form.stars),
      current_package: 1, sessions_completed: 0,
      location: form.location, status: form.status,
      cancellations: 0, completed_packages: 0,
    }
    const { error } = await supabase.from('clients').insert([newClient])
    if (!error) {
      setClients(prev => [...prev, newClient])
      setShowAdd(false)
      setForm({ name: '', package_size: '10', rate: '', location: '', stars: '0', status: 'active' })
      showToast('Client added ✓')
    } else {
      showToast('Error: ' + error.message)
    }
    setSaving(false)
  }

  const changeStatus = async (client, status) => {
    const updates = { status }
    if (status === 'archived') updates.archived_at = new Date().toISOString()
    const { error } = await supabase.from('clients').update(updates).eq('id', client.id)
    if (!error) {
      setClients(prev => prev.map(c => c.id === client.id ? { ...c, ...updates } : c))
      showToast(`Moved to ${LIFECYCLE[status].label}`)
    } else {
      showToast('Error: ' + error.message)
    }
  }

  const deleteClient = async (client) => {
    // Hard delete — cascades to sessions, programs, etc. via FK on supabase side.
    // If FK cascades aren't set, do a manual cleanup.
    await supabase.from('exercise_logs').delete().eq('client_id', client.id)
    await supabase.from('sessions').delete().eq('client_id', client.id)
    await supabase.from('exercise_blocks').delete().in('day_id',
      (await supabase.from('program_days').select('id').in('program_id',
        (await supabase.from('programs').select('id').eq('client_id', client.id)).data?.map(p => p.id) || []
      )).data?.map(d => d.id) || []
    )
    await supabase.from('program_days').delete().in('program_id',
      (await supabase.from('programs').select('id').eq('client_id', client.id)).data?.map(p => p.id) || []
    )
    await supabase.from('programs').delete().eq('client_id', client.id)
    await supabase.from('client_goals').delete().eq('client_id', client.id)
    await supabase.from('client_notes').delete().eq('client_id', client.id)
    const { error } = await supabase.from('clients').delete().eq('id', client.id)
    if (!error) {
      setClients(prev => prev.filter(c => c.id !== client.id))
      setConfirmDelete(null)
      showToast(`${client.name} deleted`)
    } else {
      showToast('Error: ' + error.message)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: C.creamLight, paddingBottom: 90 }}>
      <Header
        title="Clients"
        right={
          <button onClick={() => setShowAdd(true)} style={{ background: C.sage, border: 'none', borderRadius: 8, padding: '7px 14px', color: C.white, fontFamily: MONO, fontSize: 11, letterSpacing: '1px', cursor: 'pointer' }}>+ Add</button>
        }
      />

      <div style={{ background: C.sageDark, padding: '0 14px 14px' }}>
        {nearEnd.length > 0 && (
          <div style={{ background: `${C.amber}20`, border: `1px solid ${C.amber}50`, borderRadius: 8, padding: '7px 12px', marginBottom: 10, marginLeft: 6, marginRight: 6 }}>
            <Mono style={{ fontSize: 8, letterSpacing: '2px', color: C.amber, textTransform: 'uppercase', display: 'block' }}>Ending Soon</Mono>
            <span style={{ fontSize: 13, color: C.creamLight, fontFamily: SERIF, marginTop: 2, display: 'block' }}>{nearEnd.map(c => c.name).join('  ·  ')}</span>
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingLeft: 6, paddingRight: 6, paddingBottom: 2, scrollbarWidth: 'none' }}>
          {[
            { id: 'active', label: `Active ${counts.active}` },
            { id: 'trial', label: `Trial ${counts.trial}` },
            { id: 'paused', label: `Paused ${counts.paused}` },
            { id: 'completed', label: `Done ${counts.completed}` },
            { id: 'all', label: 'All' },
            { id: 'archived', label: `Archived ${counts.archived}` },
          ].map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)} style={{
              padding: '4px 12px', borderRadius: 99, border: '1px solid',
              borderColor: filter === f.id ? C.sageLight : `${C.cream}20`,
              background: filter === f.id ? `${C.sageLight}25` : 'transparent',
              color: filter === f.id ? C.sageLight : `${C.cream}50`,
              fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', fontFamily: MONO, cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}>{f.label}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: '14px 16px' }}>
        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Mono style={{ fontSize: 11, color: C.sageMid }}>No clients in this view.</Mono>
          </div>
        )}
        {filtered.map((c, i) => (
          <ClientCard key={c.id} client={c} index={i}
            onOpen={() => onOpen(c)}
            onMenu={() => setMenuFor(c)}
          />
        ))}
      </div>

      {/* Add Client Modal */}
      <Sheet open={showAdd} onClose={() => setShowAdd(false)} title="New Client">
        <Input label="Name" value={form.name} onChange={v => setForm(p => ({ ...p, name: v }))} placeholder="Client name" />
        <Input label="Rate (AED per package)" value={form.rate} onChange={v => setForm(p => ({ ...p, rate: v }))} placeholder="e.g. 3200" type="number" />
        <Input label="Sessions per package" value={form.package_size} onChange={v => setForm(p => ({ ...p, package_size: v }))} placeholder="10" type="number" />
        <Input label="Location" value={form.location} onChange={v => setForm(p => ({ ...p, location: v }))} placeholder="e.g. JVC, Online" />
        <Select label="Stars (retention indicator)" value={form.stars} onChange={v => setForm(p => ({ ...p, stars: v }))}
          options={[{ value: '0', label: '☆☆☆ No rating' }, { value: '1', label: '★☆☆' }, { value: '2', label: '★★☆' }, { value: '3', label: '★★★' }]} />
        <Select label="Lifecycle" value={form.status} onChange={v => setForm(p => ({ ...p, status: v }))}
          options={[
            { value: 'active', label: 'Active' },
            { value: 'trial', label: 'Trial' },
            { value: 'paused', label: 'Paused' },
          ]} />
        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          <Btn onClick={() => setShowAdd(false)} color={C.sageMid} outline>Cancel</Btn>
          <Btn onClick={addClient} color={C.sage} full disabled={saving}>{saving ? 'Saving...' : 'Add Client'}</Btn>
        </div>
      </Sheet>

      {/* Client action menu */}
      <ActionMenu open={!!menuFor} onClose={() => setMenuFor(null)} actions={menuFor ? [
        { icon: '◈', label: 'Open Profile', onClick: () => onOpen(menuFor) },
        ...(menuFor.status !== 'active' ? [{ icon: '●', label: 'Set Active', onClick: () => changeStatus(menuFor, 'active') }] : []),
        ...(menuFor.status !== 'paused' ? [{ icon: '◐', label: 'Pause', onClick: () => changeStatus(menuFor, 'paused') }] : []),
        ...(menuFor.status !== 'trial' ? [{ icon: '○', label: 'Mark Trial', onClick: () => changeStatus(menuFor, 'trial') }] : []),
        ...(menuFor.status !== 'former' ? [{ icon: '◌', label: 'Mark Former Client', onClick: () => changeStatus(menuFor, 'former') }] : []),
        ...(menuFor.status !== 'archived'
          ? [{ icon: '◆', label: 'Archive', onClick: () => setConfirmArchive(menuFor) }]
          : [{ icon: '↩', label: 'Restore from Archive', onClick: () => changeStatus(menuFor, 'active') }]),
        { icon: '✕', label: 'Delete Permanently', danger: true, onClick: () => setConfirmDelete(menuFor) },
      ] : []} />

      <ConfirmDialog
        open={!!confirmArchive}
        title="Archive client?"
        body="They will be hidden from active views but can be restored anytime. Their data is preserved."
        confirmLabel="Archive"
        onConfirm={() => { changeStatus(confirmArchive, 'archived'); setConfirmArchive(null) }}
        onClose={() => setConfirmArchive(null)}
      />
      <ConfirmDialog
        open={!!confirmDelete}
        title={`Delete ${confirmDelete?.name} permanently?`}
        body="This removes ALL sessions, programs, goals, and progress logs. Cannot be undone."
        danger
        confirmLabel="Delete Forever"
        onConfirm={() => deleteClient(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
      />

      {toast && <Toast msg={toast} />}
      <style>{`@keyframes fadeUp { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } } [data-sk-scroll]::-webkit-scrollbar { display:none }`}</style>
    </div>
  )
}

function ClientCard({ client, index, onOpen, onMenu }) {
  const lp = useLongPress(onMenu, 450)
  return (
    <Card
      onClick={() => { if (!lp.didFire()) onOpen() }}
      accent={client.status === 'active' ? C.sage : LIFECYCLE[client.status]?.color || C.creamDark}
      style={{ animation: `fadeUp .3s ease ${index * .04}s both`, opacity: client.status === 'archived' ? 0.7 : 1 }}
    >
      <div {...lp} style={{ touchAction: 'manipulation' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 19, color: C.sageDark, fontFamily: SERIF }}>{client.name}</span>
              {client.stars > 0 && <span style={{ fontSize: 10, color: '#C9A84C' }}>{'★'.repeat(client.stars)}{'☆'.repeat(3 - client.stars)}</span>}
            </div>
            <Mono style={{ fontSize: 10, color: C.sageMid, marginTop: 2, display: 'block' }}>
              Pkg {client.current_package}  ·  {client.package_size} sessions  ·  {fmt(client.rate)}
            </Mono>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <LifecyclePill status={client.status} />
            <button onClick={(e) => { e.stopPropagation(); onMenu() }} style={{ background: 'none', border: 'none', fontSize: 16, color: C.sageMid, cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}>⋯</button>
          </div>
        </div>
        <ProgressBar done={client.sessions_completed} total={client.package_size} />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
          <Mono style={{ fontSize: 10, color: C.sageMid }}>📍 {client.location || '—'}</Mono>
          {client.cancellations > 0 && <Mono style={{ fontSize: 10, color: C.amber }}>{client.cancellations} cancel{client.cancellations > 1 ? 's' : ''}</Mono>}
        </div>
      </div>
    </Card>
  )
}

// ═══════════════════════════════════════════════════════════════════
// CLIENT DETAIL — parent with sub-tabs (Sessions/Programs/Progress/Goals/Notes)
// ═══════════════════════════════════════════════════════════════════
function ClientDetail({ client, clients, setClients, setSelectedClient, onBack }) {
  const [subTab, setSubTab] = useState('sessions') // sessions | programs | progress | goals | notes

  const earned = client.completed_packages * client.rate
  const isDone = client.sessions_completed >= client.package_size

  return (
    <div style={{ minHeight: '100vh', background: C.creamLight, paddingBottom: 90 }}>
      <Header
        title={client.name}
        subtitle={`${fmt(client.rate)} · ${client.package_size}/pkg · ${LIFECYCLE[client.status]?.label || 'Active'}`}
        onBack={onBack}
        right={<LifecyclePill status={client.status} />}
      />

      {/* Compact KPI strip */}
      <div style={{ background: C.sageDark, padding: '0 14px 14px' }}>
        <div style={{ background: '#ffffff12', borderRadius: 10, padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Mono style={{ fontSize: 9, letterSpacing: '2px', color: C.sageLight, textTransform: 'uppercase' }}>Package {client.current_package}</Mono>
            <Mono style={{ fontSize: 9, color: C.sageLight }}>{client.completed_packages} done · {fmt(earned)} earned</Mono>
          </div>
          <ProgressBar done={client.sessions_completed} total={client.package_size} />
          {isDone && <Mono style={{ marginTop: 8, fontSize: 11, color: C.amber, display: 'block' }}>⚡ Package done — discuss renewal</Mono>}
        </div>
      </div>

      {/* Sub-tab pills */}
      <div style={{ background: C.creamLight, padding: '10px 14px 0', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', scrollbarWidth: 'none' }}>
          {[
            { id: 'sessions', label: 'Sessions' },
            { id: 'programs', label: 'Programs' },
            { id: 'progress', label: 'Progress' },
            { id: 'goals', label: 'Goals' },
            { id: 'notes', label: 'Notes' },
          ].map(t => (
            <button key={t.id} onClick={() => setSubTab(t.id)} style={{
              padding: '7px 14px', borderRadius: 99, border: '1px solid',
              borderColor: subTab === t.id ? C.sage : `${C.creamDark}80`,
              background: subTab === t.id ? C.sage : C.white,
              color: subTab === t.id ? C.white : C.sageMid,
              fontSize: 10, letterSpacing: '1.5px', textTransform: 'uppercase',
              fontFamily: MONO, cursor: 'pointer', whiteSpace: 'nowrap',
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: '14px 0 14px' }}>
        {subTab === 'sessions' && <SessionsSubTab client={client} setClients={setClients} setSelectedClient={setSelectedClient} />}
        {subTab === 'programs' && <ProgramsSubTab client={client} />}
        {subTab === 'progress' && <ProgressSubTab client={client} />}
        {subTab === 'goals' && <GoalsSubTab client={client} />}
        {subTab === 'notes' && <NotesSubTab client={client} />}
      </div>
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────
// SESSIONS sub-tab (with FIXED numbering)
// ───────────────────────────────────────────────────────────────────
function SessionsSubTab({ client, setClients, setSelectedClient }) {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [showLog, setShowLog] = useState(false)
  const [logForm, setLogForm] = useState({ date: today(), location: client.location || '', note: '', cancelled: false })
  const [toast, setToast] = useState(null)
  const [saving, setSaving] = useState(false)
  const [editSession, setEditSession] = useState(null)
  const [editForm, setEditForm] = useState({ date: '', location: '', note: '', cancelled: false })
  const [confirmDelete, setConfirmDelete] = useState(null)

  const showToast = msg => { setToast(msg); setTimeout(() => setToast(null), 2500) }

  useEffect(() => { loadSessions() }, [client.id])

  const loadSessions = async () => {
    setLoading(true)
    const { data } = await supabase.from('sessions').select('*').eq('client_id', client.id)
    setSessions(sortSessions(data || []))
    setLoading(false)
  }

  // GROUP by pkg and pre-sort each — used for numbering derivation
  const sortedByPkg = useMemo(() => {
    const map = new Map()
    for (const s of sessions) {
      if (!map.has(s.pkg)) map.set(s.pkg, [])
      map.get(s.pkg).push(s)
    }
    for (const [k, arr] of map) map.set(k, sortSessions(arr))
    return map
  }, [sessions])

  const pkgs = [...sortedByPkg.keys()].sort((a, b) => a - b)

  const deleteSession = async (session) => {
    const { error } = await supabase.from('sessions').delete().eq('id', session.id)
    if (!error) {
      const adj = session.cancelled ? 0 : -1
      const adjCancel = session.cancelled ? -1 : 0
      const updates = {
        sessions_completed: Math.max(0, client.sessions_completed + adj),
        cancellations: Math.max(0, client.cancellations + adjCancel),
      }
      await supabase.from('clients').update(updates).eq('id', client.id)
      const updatedClient = { ...client, ...updates, status: client.status === 'completed' ? 'active' : client.status }
      setClients(prev => prev.map(c => c.id === client.id ? updatedClient : c))
      setSelectedClient(updatedClient)
      setConfirmDelete(null)
      await loadSessions()
      showToast('Session deleted')
    }
  }

  const saveEdit = async () => {
    if (!editSession) return
    setSaving(true)
    const { error } = await supabase.from('sessions').update({
      date: editForm.date,
      location: editForm.location,
      note: editForm.note,
      cancelled: editForm.cancelled,
    }).eq('id', editSession.id)
    if (!error) {
      await loadSessions()
      setEditSession(null)
      showToast('Session updated ✓')
    }
    setSaving(false)
  }

  const logSession = async () => {
    if (!logForm.date) return
    setSaving(true)
    // NEW BEHAVIOUR: do NOT bake "Session #N" into the note. Note is just the coach's text.
    const newSession = {
      client_id: client.id,
      date: logForm.date,
      location: logForm.cancelled ? '—' : logForm.location,
      note: logForm.note || '',
      pkg: client.current_package,
      cancelled: logForm.cancelled,
    }
    const { error: sErr } = await supabase.from('sessions').insert([newSession])
    if (!sErr) {
      const newCompleted = logForm.cancelled ? client.sessions_completed : client.sessions_completed + 1
      const isDone = newCompleted >= client.package_size
      const updates = {
        sessions_completed: newCompleted,
        cancellations: logForm.cancelled ? client.cancellations + 1 : client.cancellations,
        status: (!logForm.cancelled && isDone) ? 'completed' : (client.status === 'completed' ? 'active' : client.status),
      }
      await supabase.from('clients').update(updates).eq('id', client.id)
      const updatedClient = { ...client, ...updates }
      setClients(prev => prev.map(c => c.id === client.id ? updatedClient : c))
      setSelectedClient(updatedClient)
      await loadSessions()
      setShowLog(false)
      setLogForm({ date: today(), location: client.location || '', note: '', cancelled: false })
      showToast(logForm.cancelled ? 'Cancellation logged' : 'Session logged ✓')
    } else {
      showToast('Error: ' + sErr.message)
    }
    setSaving(false)
  }

  const startNewPackage = async () => {
    const updates = { current_package: client.current_package + 1, sessions_completed: 0, status: 'active', completed_packages: client.completed_packages + 1 }
    await supabase.from('clients').update(updates).eq('id', client.id)
    const updated = { ...client, ...updates }
    setClients(prev => prev.map(c => c.id === client.id ? updated : c))
    setSelectedClient(updated)
    showToast('New package started!')
  }

  const exportCSV = () => {
    const rows = [['Client', 'Date', 'Package', 'Label', 'Location', 'Note', 'Type']]
    for (const pkg of pkgs) {
      const sorted = sortedByPkg.get(pkg)
      for (const s of sorted) {
        rows.push([client.name, s.date, `Package ${s.pkg}`, sessionLabel(s, sorted), s.location, cleanLegacyNote(s.note), s.cancelled ? 'Cancelled' : 'Session'])
      }
    }
    const csv = rows.map(r => r.map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `${client.name.toLowerCase()}-sessions.csv`
    a.click()
  }

  const isDone = client.sessions_completed >= client.package_size
  const nonCancelledTotal = sessions.filter(s => !s.cancelled).length

  return (
    <div style={{ padding: '0 16px 100px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Mono style={{ fontSize: 9, letterSpacing: '2px', color: C.sageMid, textTransform: 'uppercase' }}>
          Session Log · {nonCancelledTotal} sessions
        </Mono>
        <button onClick={exportCSV} style={{ background: 'none', border: `1px solid ${C.sageLight}`, borderRadius: 7, padding: '3px 10px', fontSize: 9, color: C.sageMid, fontFamily: MONO, cursor: 'pointer' }}>↓ CSV</button>
      </div>
      {loading ? <Spinner /> : pkgs.length === 0 ? (
        <p style={{ textAlign: 'center', color: C.sageMid, fontFamily: MONO, fontSize: 12, padding: 20 }}>No sessions yet — log your first below</p>
      ) : pkgs.map(pkg => {
        const sorted = sortedByPkg.get(pkg)
        return (
          <div key={pkg} style={{ marginBottom: 14 }}>
            <Mono style={{ fontSize: 9, letterSpacing: '2px', color: C.sage, textTransform: 'uppercase', display: 'block', marginBottom: 5, paddingLeft: 2 }}>— Package {pkg} —</Mono>
            {sorted.map(s => {
              const label = sessionLabel(s, sorted)
              const noteBody = cleanLegacyNote(s.note)
              return (
                <div key={s.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '10px 12px', background: C.white, borderRadius: 8, marginBottom: 5,
                  opacity: s.cancelled ? 0.6 : 1,
                  borderLeft: s.cancelled ? `2px solid ${C.amber}` : `2px solid ${C.sage}40`,
                  boxShadow: '0 1px 3px rgba(0,0,0,.04)',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 14, color: C.sageDark, fontFamily: SERIF, display: 'block' }}>
                      {label}{noteBody ? <span style={{ color: C.sageMid }}> — {noteBody}</span> : null}
                    </span>
                    <Mono style={{ fontSize: 10, color: C.sageMid }}>{s.date} · {s.location}</Mono>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button onClick={() => { setEditSession(s); setEditForm({ date: s.date, location: s.location || '', note: cleanLegacyNote(s.note), cancelled: s.cancelled }) }}
                      style={{ background: 'none', border: `1px solid ${C.sageLight}`, borderRadius: 6, padding: '3px 8px', fontSize: 10, color: C.sageMid, fontFamily: MONO, cursor: 'pointer' }}>
                      Edit
                    </button>
                    <button onClick={() => setConfirmDelete(s)}
                      style={{ background: 'none', border: `1px solid ${C.amber}40`, borderRadius: 6, padding: '3px 8px', fontSize: 10, color: C.amber, fontFamily: MONO, cursor: 'pointer' }}>
                      ✕
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}

      {/* Action bar */}
      <div style={{ position: 'fixed', bottom: 56, left: 0, right: 0, padding: '10px 16px 14px', background: C.creamLight, borderTop: `1px solid ${C.creamDark}50`, display: 'flex', gap: 8 }}>
        <button onClick={() => setShowLog(true)} style={{ flex: 1, padding: 14, background: C.sage, color: C.white, border: 'none', borderRadius: 10, fontSize: 13, fontFamily: MONO, letterSpacing: '1.5px', textTransform: 'uppercase', cursor: 'pointer' }}>
          + Log Session
        </button>
        {isDone && (
          <button onClick={startNewPackage} style={{ flex: 1, padding: 14, background: C.sageDark, color: C.cream, border: 'none', borderRadius: 10, fontSize: 12, fontFamily: MONO, letterSpacing: '1.5px', textTransform: 'uppercase', cursor: 'pointer' }}>
            New Pkg →
          </button>
        )}
      </div>

      {/* Log Session sheet */}
      <Sheet open={showLog} onClose={() => setShowLog(false)} title={`Log — ${client.name}`}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: C.white, borderRadius: 10, padding: '14px 16px', marginBottom: 12 }}>
          <span style={{ fontSize: 15, color: C.sageDark, fontFamily: SERIF }}>Mark as Cancellation</span>
          <div onClick={() => setLogForm(f => ({ ...f, cancelled: !f.cancelled }))} style={{ width: 48, height: 26, borderRadius: 13, background: logForm.cancelled ? C.amber : C.creamDark, position: 'relative', cursor: 'pointer', transition: 'background .2s' }}>
            <div style={{ position: 'absolute', top: 3, left: logForm.cancelled ? 25 : 3, width: 20, height: 20, borderRadius: '50%', background: C.white, transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} />
          </div>
        </div>
        <Input label="Date" value={logForm.date} onChange={v => setLogForm(f => ({ ...f, date: v }))} placeholder="e.g. 14 May 2026" />
        {!logForm.cancelled && <Input label="Location" value={logForm.location} onChange={v => setLogForm(f => ({ ...f, location: v }))} placeholder="Online / JVC..." />}
        <Input label="Note (optional)" value={logForm.note} onChange={v => setLogForm(f => ({ ...f, note: v }))} placeholder={logForm.cancelled ? 'e.g. 3 hrs before, counted' : 'e.g. great energy today'} />
        <Mono style={{ fontSize: 10, color: C.sageMid, marginBottom: 12, display: 'block', lineHeight: 1.5 }}>
          Session number is now auto-numbered. Use the note for free text only.
        </Mono>
        <button onClick={logSession} disabled={saving} style={{ width: '100%', padding: 16, background: logForm.cancelled ? C.amber : C.sage, color: C.white, border: 'none', borderRadius: 12, fontSize: 13, fontFamily: MONO, letterSpacing: '2px', textTransform: 'uppercase', cursor: 'pointer', marginTop: 8 }}>
          {saving ? 'Saving...' : logForm.cancelled ? 'Log Cancellation' : 'Log Session'}
        </button>
      </Sheet>

      {/* Edit Session sheet */}
      <Sheet open={!!editSession} onClose={() => setEditSession(null)} title="Edit Session">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: C.white, borderRadius: 10, padding: '14px 16px', marginBottom: 12 }}>
          <span style={{ fontSize: 15, color: C.sageDark, fontFamily: SERIF }}>Cancellation</span>
          <div onClick={() => setEditForm(f => ({ ...f, cancelled: !f.cancelled }))} style={{ width: 48, height: 26, borderRadius: 13, background: editForm.cancelled ? C.amber : C.creamDark, position: 'relative', cursor: 'pointer', transition: 'background .2s' }}>
            <div style={{ position: 'absolute', top: 3, left: editForm.cancelled ? 25 : 3, width: 20, height: 20, borderRadius: '50%', background: C.white, transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} />
          </div>
        </div>
        <Input label="Date" value={editForm.date} onChange={v => setEditForm(f => ({ ...f, date: v }))} placeholder="e.g. 16 May 2026" />
        <Input label="Location" value={editForm.location} onChange={v => setEditForm(f => ({ ...f, location: v }))} placeholder="Online / JVC..." />
        <Input label="Note" value={editForm.note} onChange={v => setEditForm(f => ({ ...f, note: v }))} placeholder="Session note (no need for 'Session #N')" />
        <Btn onClick={saveEdit} color={C.sage} full disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</Btn>
      </Sheet>

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete session?"
        body={confirmDelete ? `${confirmDelete.date} · ${confirmDelete.location || '—'}` : ''}
        danger
        confirmLabel="Delete"
        onConfirm={() => deleteSession(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
      />

      {toast && <Toast msg={toast} />}
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────
// PROGRAMS sub-tab (per client)
// ───────────────────────────────────────────────────────────────────
function ProgramsSubTab({ client }) {
  const [programs, setPrograms] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeProgram, setActiveProgram] = useState(null)
  const [showNew, setShowNew] = useState(false)
  const [newForm, setNewForm] = useState({ title: '' })
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)
  const [menuFor, setMenuFor] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)

  const showToast = msg => { setToast(msg); setTimeout(() => setToast(null), 2500) }

  useEffect(() => { loadPrograms() }, [client.id])

  const loadPrograms = async () => {
    setLoading(true)
    const { data } = await supabase.from('programs').select('*').eq('client_id', client.id).order('created_at', { ascending: false })
    setPrograms(data || [])
    setLoading(false)
  }

  const createProgram = async () => {
    if (!newForm.title) return
    setSaving(true)
    await supabase.from('programs').update({ is_active: false }).eq('client_id', client.id).eq('is_active', true)
    const { data, error } = await supabase.from('programs').insert([{
      client_id: client.id, title: newForm.title, is_active: true,
    }]).select()
    if (!error && data) {
      setPrograms(prev => [data[0], ...prev.map(p => ({ ...p, is_active: false }))])
      setActiveProgram(data[0])
      setShowNew(false)
      setNewForm({ title: '' })
      showToast('Program created ✓')
    } else if (error) {
      showToast('Error: ' + error.message)
    }
    setSaving(false)
  }

  const setActiveOnly = async (p) => {
    await supabase.from('programs').update({ is_active: false }).eq('client_id', client.id)
    await supabase.from('programs').update({ is_active: true }).eq('id', p.id)
    setPrograms(prev => prev.map(x => ({ ...x, is_active: x.id === p.id })))
    showToast('Activated')
  }

  const archive = async (p) => {
    await supabase.from('programs').update({ is_active: false }).eq('id', p.id)
    setPrograms(prev => prev.map(x => x.id === p.id ? { ...x, is_active: false } : x))
    showToast('Archived')
  }

  const duplicateProgram = async (p) => {
    setSaving(true)
    const { data: dayRows } = await supabase.from('program_days').select('*').eq('program_id', p.id).order('day_order')
    const { data: blockRows } = await supabase.from('exercise_blocks').select('*').in('day_id', (dayRows || []).map(d => d.id))
    const { data: newProg } = await supabase.from('programs').insert([{
      client_id: client.id, title: p.title + ' (copy)', is_active: false,
    }]).select()
    if (newProg && newProg[0]) {
      for (const d of (dayRows || [])) {
        const { data: nd } = await supabase.from('program_days').insert([{
          program_id: newProg[0].id, name: d.name, theme: d.theme, day_order: d.day_order,
        }]).select()
        if (nd && nd[0]) {
          const blocks = (blockRows || []).filter(b => b.day_id === d.id).map(b => ({
            day_id: nd[0].id, exercise_name: b.exercise_name, sets: b.sets, reps: b.reps, weight: b.weight,
            focus: b.focus, block_type: b.block_type, notes: b.notes, block_order: b.block_order,
            section_type: b.section_type, group_label: b.group_label, group_position: b.group_position, category: b.category,
          }))
          if (blocks.length > 0) await supabase.from('exercise_blocks').insert(blocks)
        }
      }
      await loadPrograms()
      showToast('Duplicated')
    }
    setSaving(false)
  }

  const deleteProgram = async (p) => {
    const { data: days } = await supabase.from('program_days').select('id').eq('program_id', p.id)
    const dayIds = (days || []).map(d => d.id)
    if (dayIds.length > 0) await supabase.from('exercise_blocks').delete().in('day_id', dayIds)
    await supabase.from('program_days').delete().eq('program_id', p.id)
    await supabase.from('programs').delete().eq('id', p.id)
    setPrograms(prev => prev.filter(x => x.id !== p.id))
    setConfirmDelete(null)
    showToast('Program deleted')
  }

  if (activeProgram) {
    return <ProgramBuilder
      program={activeProgram}
      client={client}
      onBack={() => { setActiveProgram(null); loadPrograms() }}
      onArchive={() => archive(activeProgram)}
      onActivate={() => setActiveOnly(activeProgram)}
    />
  }

  return (
    <div style={{ padding: '0 16px 100px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <Mono style={{ fontSize: 9, letterSpacing: '2px', color: C.sageMid, textTransform: 'uppercase' }}>
          {client.name}'s Programs · {programs.length}
        </Mono>
        <button onClick={() => setShowNew(true)} style={{ background: C.sage, border: 'none', borderRadius: 8, padding: '6px 12px', color: C.white, fontFamily: MONO, fontSize: 10, letterSpacing: '1px', cursor: 'pointer' }}>+ New</button>
      </div>
      {loading ? <Spinner /> : programs.length === 0 ? (
        <p style={{ textAlign: 'center', color: C.sageMid, fontFamily: MONO, fontSize: 12, padding: 20 }}>
          No programs yet. Tap + New to start building.
        </p>
      ) : programs.map(p => (
        <Card key={p.id} accent={p.is_active ? C.sage : C.creamDark}
          onClick={() => setActiveProgram(p)}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 16, color: C.sageDark, fontFamily: SERIF, display: 'block' }}>{p.title}</span>
              <Mono style={{ fontSize: 10, color: C.sageMid, marginTop: 2 }}>{new Date(p.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</Mono>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              {p.is_active && <Pill color={C.sage}>Active</Pill>}
              <button onClick={(e) => { e.stopPropagation(); setMenuFor(p) }} style={{ background: 'none', border: 'none', fontSize: 16, color: C.sageMid, cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}>⋯</button>
            </div>
          </div>
        </Card>
      ))}

      <Sheet open={showNew} onClose={() => setShowNew(false)} title="New Program">
        <Input label="Program Title" value={newForm.title} onChange={v => setNewForm({ title: v })} placeholder={`e.g. ${client.name} — ${new Date().toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`} />
        <Mono style={{ fontSize: 10, color: C.sageMid, marginBottom: 12, display: 'block', lineHeight: 1.5 }}>
          The current active program (if any) will be archived. Old programs are never deleted automatically.
        </Mono>
        <Btn onClick={createProgram} color={C.sage} full disabled={saving}>{saving ? 'Creating...' : 'Create Program'}</Btn>
      </Sheet>

      <ActionMenu open={!!menuFor} onClose={() => setMenuFor(null)} actions={menuFor ? [
        { icon: '◈', label: 'Open Builder', onClick: () => setActiveProgram(menuFor) },
        ...(menuFor.is_active ? [] : [{ icon: '●', label: 'Set Active', onClick: () => setActiveOnly(menuFor) }]),
        ...(menuFor.is_active ? [{ icon: '◐', label: 'Archive', onClick: () => archive(menuFor) }] : []),
        { icon: '⎘', label: 'Duplicate', onClick: () => duplicateProgram(menuFor) },
        { icon: '✕', label: 'Delete', danger: true, onClick: () => setConfirmDelete(menuFor) },
      ] : []} />

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete this program?"
        body="All days and exercises will be removed. Exercise logs in Progress are preserved."
        danger confirmLabel="Delete"
        onConfirm={() => deleteProgram(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
      />

      {toast && <Toast msg={toast} />}
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────
// PROGRAM BUILDER — full workout builder with groups, sections, Smart Coach
// ───────────────────────────────────────────────────────────────────
function ProgramBuilder({ program, client, onBack, onArchive, onActivate }) {
  const [days, setDays] = useState([])
  const [activeDay, setActiveDay] = useState(null)
  const [blocks, setBlocks] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddDay, setShowAddDay] = useState(false)
  const [newDayForm, setNewDayForm] = useState({ name: '', theme: '' })
  const [showAddBlock, setShowAddBlock] = useState(false)
  const [editBlock, setEditBlock] = useState(null)
  const [editDayMeta, setEditDayMeta] = useState(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)
  const [collapsedGroups, setCollapsedGroups] = useState({}) // key: section_label
  const [showRun, setShowRun] = useState(false)
  const [coachOpen, setCoachOpen] = useState(true)
  const [blockMenu, setBlockMenu] = useState(null)
  const [groupMenu, setGroupMenu] = useState(null)
  const [confirmDeleteBlock, setConfirmDeleteBlock] = useState(null)
  const [confirmDeleteDay, setConfirmDeleteDay] = useState(null)
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState(null)

  const showToast = msg => { setToast(msg); setTimeout(() => setToast(null), 2500) }

  useEffect(() => { loadDays() }, [program.id])

  const loadDays = async () => {
    setLoading(true)
    const { data } = await supabase.from('program_days').select('*').eq('program_id', program.id).order('day_order')
    const dayList = data || []
    setDays(dayList)
    if (dayList.length > 0) {
      const first = dayList[0]
      setActiveDay(first)
      loadBlocks(first.id)
    } else {
      setActiveDay(null)
      setBlocks([])
      setLoading(false)
    }
  }
  const loadBlocks = async (dayId) => {
    setLoading(true)
    const { data } = await supabase.from('exercise_blocks').select('*').eq('day_id', dayId).order('block_order')
    setBlocks(data || [])
    setLoading(false)
  }
  const selectDay = (d) => { setActiveDay(d); loadBlocks(d.id) }

  const addDay = async () => {
    if (!newDayForm.name) return
    setSaving(true)
    const { data, error } = await supabase.from('program_days').insert([{
      program_id: program.id, name: newDayForm.name, theme: newDayForm.theme, day_order: days.length + 1,
    }]).select()
    if (!error && data) {
      setDays(prev => [...prev, data[0]])
      setActiveDay(data[0])
      setBlocks([])
      setShowAddDay(false)
      setNewDayForm({ name: '', theme: '' })
      showToast('Day added ✓')
    } else if (error) showToast('Error: ' + error.message)
    setSaving(false)
  }

  const updateDayMeta = async () => {
    if (!editDayMeta) return
    setSaving(true)
    const { error } = await supabase.from('program_days').update({
      name: editDayMeta.name, theme: editDayMeta.theme,
    }).eq('id', editDayMeta.id)
    if (!error) {
      setDays(prev => prev.map(d => d.id === editDayMeta.id ? { ...d, name: editDayMeta.name, theme: editDayMeta.theme } : d))
      if (activeDay?.id === editDayMeta.id) setActiveDay({ ...activeDay, name: editDayMeta.name, theme: editDayMeta.theme })
      setEditDayMeta(null)
      showToast('Day updated ✓')
    }
    setSaving(false)
  }

  const reorderDay = async (dir) => {
    if (!activeDay) return
    const idx = days.findIndex(d => d.id === activeDay.id)
    const targetIdx = dir === 'up' ? idx - 1 : idx + 1
    if (targetIdx < 0 || targetIdx >= days.length) return
    const arr = [...days]
    const tmpOrder = arr[idx].day_order
    arr[idx].day_order = arr[targetIdx].day_order
    arr[targetIdx].day_order = tmpOrder
    ;[arr[idx], arr[targetIdx]] = [arr[targetIdx], arr[idx]]
    setDays(arr)
    await supabase.from('program_days').update({ day_order: arr[idx].day_order }).eq('id', arr[idx].id)
    await supabase.from('program_days').update({ day_order: arr[targetIdx].day_order }).eq('id', arr[targetIdx].id)
  }

  const deleteDay = async (d) => {
    await supabase.from('exercise_blocks').delete().eq('day_id', d.id)
    await supabase.from('program_days').delete().eq('id', d.id)
    const remaining = days.filter(x => x.id !== d.id)
    setDays(remaining)
    if (remaining.length > 0) { setActiveDay(remaining[0]); loadBlocks(remaining[0].id) }
    else { setActiveDay(null); setBlocks([]) }
    setConfirmDeleteDay(null)
    showToast('Day deleted')
  }

  const duplicateDay = async (d) => {
    setSaving(true)
    const { data: dRows } = await supabase.from('program_days').insert([{
      program_id: program.id, name: d.name + ' (copy)', theme: d.theme, day_order: days.length + 1,
    }]).select()
    if (dRows && dRows[0]) {
      const { data: bRows } = await supabase.from('exercise_blocks').select('*').eq('day_id', d.id)
      const copies = (bRows || []).map(b => ({
        day_id: dRows[0].id, exercise_name: b.exercise_name, sets: b.sets, reps: b.reps, weight: b.weight,
        focus: b.focus, block_type: b.block_type, notes: b.notes, block_order: b.block_order,
        section_type: b.section_type, group_label: b.group_label, group_position: b.group_position, category: b.category,
      }))
      if (copies.length > 0) await supabase.from('exercise_blocks').insert(copies)
      await loadDays()
      showToast('Day duplicated ✓')
    }
    setSaving(false)
  }

  // ── Block CRUD ─────────────────────────────────────────────
  const nextGroupLabel = (section) => {
    const used = new Set(blocks.filter(b => (b.section_type || 'main') === section && b.group_label).map(b => b.group_label.toUpperCase()))
    for (let i = 0; i < 26; i++) {
      const c = String.fromCharCode(65 + i)
      if (!used.has(c)) return c
    }
    return 'Z'
  }

  const addBlocksSubmit = async (formData) => {
    // formData = { section_type, block_type, group_label, exercises: [{ exercise_name, sets, reps, weight, focus, notes, category }] }
    setSaving(true)
    const lastOrder = blocks.length > 0 ? Math.max(...blocks.map(b => b.block_order || 0)) : 0
    const rows = formData.exercises.map((ex, i) => ({
      day_id: activeDay.id,
      exercise_name: ex.exercise_name,
      sets: ex.sets, reps: ex.reps, weight: ex.weight,
      focus: ex.focus, notes: ex.notes, category: ex.category || null,
      section_type: formData.section_type,
      block_type: formData.block_type,
      group_label: formData.block_type === 'single' ? null : formData.group_label,
      group_position: formData.block_type === 'single' ? null : (i + 1),
      block_order: lastOrder + i + 1,
    }))
    const { data, error } = await supabase.from('exercise_blocks').insert(rows).select()
    if (!error && data) {
      setBlocks(prev => [...prev, ...data])
      setShowAddBlock(false)
      showToast(`${rows.length} exercise${rows.length > 1 ? 's' : ''} added ✓`)
    } else if (error) showToast('Error: ' + error.message)
    setSaving(false)
  }

  const saveEditBlock = async (formData) => {
    if (!editBlock) return
    setSaving(true)
    const updates = {
      exercise_name: formData.exercise_name, sets: formData.sets, reps: formData.reps,
      weight: formData.weight, focus: formData.focus, notes: formData.notes,
      section_type: formData.section_type, category: formData.category || null,
    }
    const { error } = await supabase.from('exercise_blocks').update(updates).eq('id', editBlock.id)
    if (!error) {
      setBlocks(prev => prev.map(b => b.id === editBlock.id ? { ...b, ...updates } : b))
      setEditBlock(null)
      showToast('Updated ✓')
    }
    setSaving(false)
  }

  const deleteBlock = async (b) => {
    await supabase.from('exercise_blocks').delete().eq('id', b.id)
    setBlocks(prev => prev.filter(x => x.id !== b.id))
    setConfirmDeleteBlock(null)
    showToast('Removed')
  }

  const duplicateBlock = async (b) => {
    const lastOrder = blocks.length > 0 ? Math.max(...blocks.map(x => x.block_order || 0)) : 0
    const { data, error } = await supabase.from('exercise_blocks').insert([{
      day_id: b.day_id, exercise_name: b.exercise_name, sets: b.sets, reps: b.reps, weight: b.weight,
      focus: b.focus, block_type: 'single', notes: b.notes, block_order: lastOrder + 1,
      section_type: b.section_type, group_label: null, group_position: null, category: b.category,
    }]).select()
    if (!error && data) {
      setBlocks(prev => [...prev, data[0]])
      showToast('Duplicated')
    }
  }

  const deleteGroup = async (sectionType, groupLabel) => {
    const targets = blocks.filter(b => (b.section_type || 'main') === sectionType && (b.group_label || '').toUpperCase() === groupLabel.toUpperCase())
    if (targets.length === 0) return
    await supabase.from('exercise_blocks').delete().in('id', targets.map(t => t.id))
    setBlocks(prev => prev.filter(b => !targets.find(t => t.id === b.id)))
    setConfirmDeleteGroup(null)
    showToast(`Group ${groupLabel} removed`)
  }

  // Move block up/down in its current group (or among ungrouped in its section)
  const swapBlockOrder = async (a, b) => {
    const aOrd = a.block_order, bOrd = b.block_order
    setBlocks(prev => prev.map(x => x.id === a.id ? { ...x, block_order: bOrd } : x.id === b.id ? { ...x, block_order: aOrd } : x))
    await supabase.from('exercise_blocks').update({ block_order: bOrd }).eq('id', a.id)
    await supabase.from('exercise_blocks').update({ block_order: aOrd }).eq('id', b.id)
  }
  const moveBlockUp = async (b) => {
    // Find block immediately before within same group+section
    const peers = blocks
      .filter(x => (x.section_type || 'main') === (b.section_type || 'main')
                && (x.group_label || null) === (b.group_label || null))
      .sort((x, y) => (x.block_order || 0) - (y.block_order || 0))
    const idx = peers.findIndex(p => p.id === b.id)
    if (idx <= 0) return
    await swapBlockOrder(b, peers[idx - 1])
    // also swap group_position if grouped
    if (b.group_label) {
      const aPos = b.group_position, bPos = peers[idx - 1].group_position
      setBlocks(prev => prev.map(x => x.id === b.id ? { ...x, group_position: bPos } : x.id === peers[idx - 1].id ? { ...x, group_position: aPos } : x))
      await supabase.from('exercise_blocks').update({ group_position: bPos }).eq('id', b.id)
      await supabase.from('exercise_blocks').update({ group_position: aPos }).eq('id', peers[idx - 1].id)
    }
  }
  const moveBlockDown = async (b) => {
    const peers = blocks
      .filter(x => (x.section_type || 'main') === (b.section_type || 'main')
                && (x.group_label || null) === (b.group_label || null))
      .sort((x, y) => (x.block_order || 0) - (y.block_order || 0))
    const idx = peers.findIndex(p => p.id === b.id)
    if (idx < 0 || idx >= peers.length - 1) return
    await swapBlockOrder(b, peers[idx + 1])
    if (b.group_label) {
      const aPos = b.group_position, bPos = peers[idx + 1].group_position
      setBlocks(prev => prev.map(x => x.id === b.id ? { ...x, group_position: bPos } : x.id === peers[idx + 1].id ? { ...x, group_position: aPos } : x))
      await supabase.from('exercise_blocks').update({ group_position: bPos }).eq('id', b.id)
      await supabase.from('exercise_blocks').update({ group_position: aPos }).eq('id', peers[idx + 1].id)
    }
  }

  // Move a whole group up/down within a section by shifting block_orders
  const moveGroupUp = async (sectionType, groupLabel) => {
    const sections = groupBlocks(blocks)
    const sec = sections.find(s => s.section === sectionType)
    if (!sec) return
    const idx = sec.groups.findIndex(g => (g.label || '').toUpperCase() === (groupLabel || '').toUpperCase())
    if (idx <= 0) return
    const a = sec.groups[idx], b = sec.groups[idx - 1]
    // swap their block_order ranges (simple: reassign orders)
    const aBlocks = a.blocks, bBlocks = b.blocks
    // Build the new combined order: bBlocks first → aBlocks then... wait we want a to move up so a first, b after.
    // After swap: a's blocks should come where b was; b's blocks should come where a was.
    // Easiest: take their union, sort by current order, then assign new orders interleaved.
    const all = [...bBlocks, ...aBlocks].sort((x, y) => (x.block_order || 0) - (y.block_order || 0))
    const orders = all.map(x => x.block_order)
    const newAssign = [...aBlocks.map(x => ({ ...x })), ...bBlocks.map(x => ({ ...x }))]
    for (let i = 0; i < newAssign.length; i++) newAssign[i].block_order = orders[i]
    setBlocks(prev => prev.map(x => {
      const u = newAssign.find(n => n.id === x.id)
      return u ? { ...x, block_order: u.block_order } : x
    }))
    await Promise.all(newAssign.map(n => supabase.from('exercise_blocks').update({ block_order: n.block_order }).eq('id', n.id)))
  }
  const moveGroupDown = async (sectionType, groupLabel) => {
    const sections = groupBlocks(blocks)
    const sec = sections.find(s => s.section === sectionType)
    if (!sec) return
    const idx = sec.groups.findIndex(g => (g.label || '').toUpperCase() === (groupLabel || '').toUpperCase())
    if (idx < 0 || idx >= sec.groups.length - 1) return
    return moveGroupUp(sectionType, (sec.groups[idx + 1].label || '').toUpperCase())
  }

  const sectionsRendered = useMemo(() => groupBlocks(blocks), [blocks])
  const analysis = useMemo(() => analyzeDay(blocks), [blocks])

  // ── Render ─────────────────────────────────────────────────
  if (showRun && activeDay) {
    return <RunDay program={program} day={activeDay} blocks={blocks} client={client}
      onBack={() => setShowRun(false)} />
  }

  return (
    <div style={{ minHeight: '60vh', paddingBottom: 100 }}>
      <div style={{ padding: '0 16px 12px' }}>
        {/* Header strip with program controls */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8 }}>
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: C.sageMid, fontFamily: MONO, fontSize: 11, cursor: 'pointer', padding: 0 }}>← All Programs</button>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {program.is_active ? <Pill color={C.sage}>Active</Pill> : (
              <button onClick={onActivate} style={{ background: 'none', border: `1px solid ${C.sage}80`, borderRadius: 99, padding: '3px 9px', fontSize: 8, color: C.sage, fontFamily: MONO, letterSpacing: '2px', textTransform: 'uppercase', cursor: 'pointer' }}>Set Active</button>
            )}
          </div>
        </div>
        <h2 style={{ fontFamily: SERIF, fontSize: 22, color: C.sageDark, margin: 0, fontWeight: 400 }}>{program.title}</h2>
        <Mono style={{ fontSize: 10, color: C.sageMid, marginTop: 4, display: 'block' }}>{days.length} day{days.length !== 1 ? 's' : ''}</Mono>
      </div>

      {/* Day tabs */}
      <div style={{ padding: '0 14px 12px', background: `${C.creamDark}25`, display: 'flex', gap: 6, overflowX: 'auto', scrollbarWidth: 'none' }}>
        {days.map(d => (
          <button key={d.id} onClick={() => selectDay(d)} style={{
            padding: '8px 14px', borderRadius: 10, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
            background: activeDay?.id === d.id ? C.sage : C.white,
            color: activeDay?.id === d.id ? C.white : C.sageDark,
            fontSize: 11, fontFamily: MONO, letterSpacing: '1px', textTransform: 'uppercase', fontWeight: 500,
            boxShadow: '0 1px 3px rgba(0,0,0,.06)',
          }}>{d.name}</button>
        ))}
        <button onClick={() => setShowAddDay(true)} style={{
          padding: '8px 14px', borderRadius: 10, border: `1px dashed ${C.sage}80`, background: 'transparent',
          color: C.sage, fontSize: 11, fontFamily: MONO, letterSpacing: '1px', textTransform: 'uppercase',
          cursor: 'pointer', whiteSpace: 'nowrap',
        }}>+ Day</button>
      </div>

      <div style={{ padding: '14px 16px' }}>
        {!activeDay && days.length === 0 && (
          <Card style={{ textAlign: 'center', padding: 30 }}>
            <Mono style={{ fontSize: 11, color: C.sageMid, lineHeight: 1.5 }}>No training days yet.<br />Tap + Day to start.</Mono>
          </Card>
        )}

        {activeDay && (
          <>
            {/* Day header + reorder + actions */}
            <Card style={{ borderLeft: `3px solid ${C.sage}`, marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Mono style={{ fontSize: 10, color: C.sage, textTransform: 'uppercase', letterSpacing: '2px', display: 'block', marginBottom: 3 }}>{activeDay.name}</Mono>
                  <span style={{ fontSize: 16, color: C.sageDark, fontFamily: SERIF }}>{activeDay.theme || 'Untitled day'}</span>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={() => reorderDay('up')} style={{ background: C.creamLight, border: 'none', borderRadius: 6, padding: '4px 8px', fontSize: 13, color: C.sageMid, cursor: 'pointer' }}>↑</button>
                  <button onClick={() => reorderDay('down')} style={{ background: C.creamLight, border: 'none', borderRadius: 6, padding: '4px 8px', fontSize: 13, color: C.sageMid, cursor: 'pointer' }}>↓</button>
                  <button onClick={() => setEditDayMeta({ ...activeDay })} style={{ background: 'none', border: `1px solid ${C.sageLight}`, borderRadius: 6, padding: '4px 8px', fontSize: 10, color: C.sageMid, fontFamily: MONO, cursor: 'pointer' }}>Edit</button>
                  <button onClick={() => duplicateDay(activeDay)} style={{ background: 'none', border: `1px solid ${C.sageLight}`, borderRadius: 6, padding: '4px 8px', fontSize: 10, color: C.sageMid, fontFamily: MONO, cursor: 'pointer' }}>⎘</button>
                  <button onClick={() => setConfirmDeleteDay(activeDay)} style={{ background: 'none', border: `1px solid ${C.amber}40`, borderRadius: 6, padding: '4px 8px', fontSize: 10, color: C.amber, fontFamily: MONO, cursor: 'pointer' }}>✕</button>
                </div>
              </div>
            </Card>

            {/* Smart Coach panel */}
            <SmartCoachPanel analysis={analysis} open={coachOpen} setOpen={setCoachOpen} />

            {/* Sections + groups */}
            {loading ? <Spinner /> : sectionsRendered.length === 0 ? (
              <Card style={{ textAlign: 'center', padding: 30 }}>
                <Mono style={{ fontSize: 11, color: C.sageMid, lineHeight: 1.5 }}>No exercises yet.<br />Tap + Add Exercise to start.</Mono>
              </Card>
            ) : sectionsRendered.map(sec => (
              <div key={sec.section} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, paddingLeft: 2 }}>
                  <Mono style={{ fontSize: 9, letterSpacing: '2px', color: C.sageDark, textTransform: 'uppercase', fontWeight: 600 }}>{sectionLabel(sec.section)}</Mono>
                  <div style={{ flex: 1, height: 1, background: `${C.sageMid}30` }} />
                  <Mono style={{ fontSize: 9, color: C.sageMid }}>{sec.groups.reduce((a, g) => a + g.blocks.length, 0)} ex</Mono>
                </div>
                {sec.groups.map((g, gIdx) => {
                  const key = `${sec.section}-${g.label || g.blocks[0]?.id}`
                  const collapsed = collapsedGroups[key]
                  const isGrouped = g.blocks.length > 1 || !!g.label
                  return (
                    <div key={key} style={{
                      background: isGrouped ? `${C.sageLight}40` : 'transparent',
                      borderRadius: 12, padding: isGrouped ? '8px 8px' : 0, marginBottom: 10,
                      border: isGrouped ? `1px solid ${C.sage}30` : 'none',
                    }}>
                      {isGrouped && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 6px 6px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <button onClick={() => setCollapsedGroups(p => ({ ...p, [key]: !p[key] }))} style={{ background: 'none', border: 'none', color: C.sageDark, fontSize: 12, cursor: 'pointer', padding: 0, lineHeight: 1 }}>{collapsed ? '▸' : '▾'}</button>
                            <Pill color={C.sageDark} bg={C.white}>{g.label || '—'} · {blockTypeLabel(g.type)}</Pill>
                          </div>
                          <div style={{ display: 'flex', gap: 3 }}>
                            <button onClick={() => moveGroupUp(sec.section, g.label || '')} style={{ background: C.white, border: 'none', borderRadius: 6, padding: '2px 7px', fontSize: 11, color: C.sageMid, cursor: 'pointer' }}>↑</button>
                            <button onClick={() => moveGroupDown(sec.section, g.label || '')} style={{ background: C.white, border: 'none', borderRadius: 6, padding: '2px 7px', fontSize: 11, color: C.sageMid, cursor: 'pointer' }}>↓</button>
                            <button onClick={() => setGroupMenu({ section: sec.section, label: g.label || '', type: g.type })} style={{ background: C.white, border: 'none', borderRadius: 6, padding: '2px 8px', fontSize: 13, color: C.sageMid, cursor: 'pointer', lineHeight: 1 }}>⋯</button>
                          </div>
                        </div>
                      )}
                      {!collapsed && g.blocks.map((b, bi) => (
                        <BlockCard key={b.id} block={b} grouped={isGrouped}
                          letter={g.label} pos={g.blocks.length > 1 ? bi + 1 : null}
                          onEdit={() => setEditBlock(b)}
                          onMenu={() => setBlockMenu(b)}
                          onUp={() => moveBlockUp(b)}
                          onDown={() => moveBlockDown(b)}
                        />
                      ))}
                    </div>
                  )
                })}
              </div>
            ))}
          </>
        )}
      </div>

      {/* Action bar */}
      {activeDay && (
        <div style={{ position: 'fixed', bottom: 56, left: 0, right: 0, padding: '10px 16px 14px', background: C.creamLight, borderTop: `1px solid ${C.creamDark}50`, display: 'flex', gap: 8 }}>
          <button onClick={() => setShowAddBlock(true)} style={{ flex: 1, padding: 13, background: `${C.sage}15`, border: `1px dashed ${C.sage}60`, borderRadius: 10, color: C.sage, fontFamily: MONO, fontSize: 11, letterSpacing: '1px', cursor: 'pointer', textTransform: 'uppercase' }}>
            + Add Exercise
          </button>
          <button onClick={() => setShowRun(true)} disabled={blocks.length === 0} style={{ flex: 1, padding: 13, background: blocks.length === 0 ? C.creamDark : C.sage, color: C.white, border: 'none', borderRadius: 10, fontSize: 11, fontFamily: MONO, letterSpacing: '1px', cursor: blocks.length === 0 ? 'not-allowed' : 'pointer', textTransform: 'uppercase' }}>
            ▶ Run Session
          </button>
        </div>
      )}

      {/* Add day */}
      <Sheet open={showAddDay} onClose={() => setShowAddDay(false)} title="Add Training Day">
        <Input label="Day Name" value={newDayForm.name} onChange={v => setNewDayForm(p => ({ ...p, name: v }))} placeholder={`e.g. DAY ${days.length + 1}`} />
        <Input label="Theme / Focus" value={newDayForm.theme} onChange={v => setNewDayForm(p => ({ ...p, theme: v }))} placeholder="e.g. Full Body — Posterior Bias" />
        <Btn onClick={addDay} color={C.sage} full disabled={saving}>{saving ? 'Adding...' : 'Add Day'}</Btn>
      </Sheet>

      {/* Edit day */}
      <Sheet open={!!editDayMeta} onClose={() => setEditDayMeta(null)} title="Edit Day">
        {editDayMeta && (
          <>
            <Input label="Day Name" value={editDayMeta.name} onChange={v => setEditDayMeta(p => ({ ...p, name: v }))} />
            <Input label="Theme / Focus" value={editDayMeta.theme} onChange={v => setEditDayMeta(p => ({ ...p, theme: v }))} />
            <Btn onClick={updateDayMeta} color={C.sage} full disabled={saving}>{saving ? 'Saving...' : 'Save'}</Btn>
          </>
        )}
      </Sheet>

      {/* Add block(s) — supports groups */}
      <AddBlockSheet
        open={showAddBlock}
        onClose={() => setShowAddBlock(false)}
        onSubmit={addBlocksSubmit}
        nextGroupLabel={nextGroupLabel}
        existingGroupLabels={(section) => [...new Set(blocks.filter(b => (b.section_type || 'main') === section && b.group_label).map(b => b.group_label.toUpperCase()))]}
        saving={saving}
      />

      {/* Edit block */}
      <EditBlockSheet
        open={!!editBlock}
        block={editBlock}
        onClose={() => setEditBlock(null)}
        onSubmit={saveEditBlock}
        saving={saving}
      />

      {/* Block menu */}
      <ActionMenu open={!!blockMenu} onClose={() => setBlockMenu(null)} actions={blockMenu ? [
        { icon: '✎', label: 'Edit Exercise', onClick: () => setEditBlock(blockMenu) },
        { icon: '⎘', label: 'Duplicate', onClick: () => duplicateBlock(blockMenu) },
        { icon: '↑', label: 'Move Up', onClick: () => moveBlockUp(blockMenu) },
        { icon: '↓', label: 'Move Down', onClick: () => moveBlockDown(blockMenu) },
        { icon: '✕', label: 'Delete', danger: true, onClick: () => setConfirmDeleteBlock(blockMenu) },
      ] : []} />

      {/* Group menu */}
      <ActionMenu open={!!groupMenu} onClose={() => setGroupMenu(null)} actions={groupMenu ? [
        { icon: '↑', label: 'Move Group Up', onClick: () => moveGroupUp(groupMenu.section, groupMenu.label) },
        { icon: '↓', label: 'Move Group Down', onClick: () => moveGroupDown(groupMenu.section, groupMenu.label) },
        { icon: '✕', label: 'Delete Whole Group', danger: true, onClick: () => setConfirmDeleteGroup(groupMenu) },
      ] : []} />

      <ConfirmDialog open={!!confirmDeleteBlock} title="Remove exercise?" body={confirmDeleteBlock?.exercise_name}
        danger confirmLabel="Remove"
        onConfirm={() => deleteBlock(confirmDeleteBlock)} onClose={() => setConfirmDeleteBlock(null)} />
      <ConfirmDialog open={!!confirmDeleteDay} title="Delete day?" body="All exercises in this day will be removed."
        danger confirmLabel="Delete Day"
        onConfirm={() => deleteDay(confirmDeleteDay)} onClose={() => setConfirmDeleteDay(null)} />
      <ConfirmDialog open={!!confirmDeleteGroup} title={`Delete group ${confirmDeleteGroup?.label}?`} body="All exercises in this group will be removed."
        danger confirmLabel="Delete Group"
        onConfirm={() => deleteGroup(confirmDeleteGroup.section, confirmDeleteGroup.label)} onClose={() => setConfirmDeleteGroup(null)} />

      {toast && <Toast msg={toast} />}
    </div>
  )
}

// ─── Smart Coach Panel ────────────────────────────────────────────
function SmartCoachPanel({ analysis, open, setOpen }) {
  if (!analysis || !analysis.stats) return null
  const rating = analysis.rating || 'ok'
  const ratingColor = rating === 'warn' ? C.warn : rating === 'note' ? C.amberLight : C.ok
  return (
    <Card style={{ marginBottom: 12, borderLeft: `3px solid ${ratingColor}`, padding: 12 }}>
      <div onClick={() => setOpen(!open)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 22, height: 22, borderRadius: '50%', background: `${ratingColor}25`, color: ratingColor, fontSize: 12, fontFamily: MONO, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>◆</span>
          <div>
            <Mono style={{ fontSize: 9, color: C.sageMid, letterSpacing: '2px', textTransform: 'uppercase', display: 'block' }}>Smart Coach</Mono>
            <span style={{ fontSize: 13, color: C.sageDark, fontFamily: SERIF }}>{analysis.summary}</span>
          </div>
        </div>
        <span style={{ color: C.sageMid, fontSize: 14 }}>{open ? '▾' : '▸'}</span>
      </div>
      {open && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginTop: 10 }}>
            <div><Mono style={{ fontSize: 8, color: C.sageMid, letterSpacing: '1.5px', textTransform: 'uppercase', display: 'block' }}>Blocks</Mono><span style={{ fontSize: 17, color: C.sageDark, fontFamily: SERIF }}>{analysis.stats.blocks}</span></div>
            <div><Mono style={{ fontSize: 8, color: C.sageMid, letterSpacing: '1.5px', textTransform: 'uppercase', display: 'block' }}>Sets</Mono><span style={{ fontSize: 17, color: C.sageDark, fontFamily: SERIF }}>{analysis.stats.sets}</span></div>
            <div><Mono style={{ fontSize: 8, color: C.sageMid, letterSpacing: '1.5px', textTransform: 'uppercase', display: 'block' }}>Sections</Mono><span style={{ fontSize: 17, color: C.sageDark, fontFamily: SERIF }}>{Object.keys(analysis.stats.sections).length}</span></div>
          </div>
          {Object.keys(analysis.stats.categories).length > 0 && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 10 }}>
              {Object.entries(analysis.stats.categories).map(([k, v]) => (
                <span key={k} style={{ fontSize: 9, fontFamily: MONO, padding: '2px 8px', borderRadius: 99, background: `${categoryColor(k)}25`, color: categoryColor(k), letterSpacing: '1px', textTransform: 'uppercase' }}>
                  {categoryLabel(k)} · {v}
                </span>
              ))}
            </div>
          )}
          {analysis.flags.length > 0 && (
            <div style={{ marginTop: 10 }}>
              {analysis.flags.map((f, i) => {
                const lc = f.level === 'warn' ? C.warn : f.level === 'note' ? C.amberLight : C.ok
                return (
                  <div key={i} style={{ display: 'flex', gap: 8, padding: '7px 0', borderTop: i > 0 ? `1px solid ${C.creamDark}40` : 'none' }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: lc, marginTop: 7, flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: 12, color: C.sageDark, fontFamily: SERIF, display: 'block' }}>{f.label}</span>
                      <Mono style={{ fontSize: 10, color: C.sageMid, lineHeight: 1.4 }}>{f.body}</Mono>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          {analysis.flags.length === 0 && (
            <Mono style={{ fontSize: 10, color: C.sageMid, marginTop: 10, display: 'block', fontStyle: 'italic' }}>No flags. Solid structure.</Mono>
          )}
        </>
      )}
    </Card>
  )
}

// ─── Block card (single exercise display) ─────────────────────────
function BlockCard({ block, grouped, letter, pos, onEdit, onMenu, onUp, onDown }) {
  const lp = useLongPress(onMenu, 450)
  const catColor = categoryColor(block.category)
  return (
    <div {...lp} style={{
      background: C.white, borderRadius: 10, padding: '11px 12px', marginBottom: grouped ? 5 : 8,
      boxShadow: '0 1px 3px rgba(0,0,0,.04)', borderLeft: block.category ? `3px solid ${catColor}` : `3px solid ${C.sageLight}`,
      touchAction: 'manipulation',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            {grouped && letter && pos != null && (
              <Mono style={{ fontSize: 9, color: C.sageMid, fontWeight: 700, background: `${C.sage}20`, padding: '1px 6px', borderRadius: 5 }}>{letter}{pos}</Mono>
            )}
            <span style={{ fontSize: 14, color: C.sageDark, fontFamily: SERIF }}>{block.exercise_name}</span>
          </div>
          {block.category && (
            <Mono style={{ fontSize: 8, color: catColor, letterSpacing: '1.5px', textTransform: 'uppercase' }}>{categoryLabel(block.category)}</Mono>
          )}
        </div>
        <div style={{ display: 'flex', gap: 3 }}>
          <button onClick={(e) => { e.stopPropagation(); onUp() }} style={{ background: C.creamLight, border: 'none', borderRadius: 5, padding: '2px 7px', fontSize: 11, color: C.sageMid, cursor: 'pointer' }}>↑</button>
          <button onClick={(e) => { e.stopPropagation(); onDown() }} style={{ background: C.creamLight, border: 'none', borderRadius: 5, padding: '2px 7px', fontSize: 11, color: C.sageMid, cursor: 'pointer' }}>↓</button>
          <button onClick={(e) => { e.stopPropagation(); onMenu() }} style={{ background: 'none', border: 'none', fontSize: 14, color: C.sageMid, cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}>⋯</button>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
        {[{ l: 'Sets', v: block.sets }, { l: 'Reps', v: block.reps }, { l: 'Weight', v: block.weight }].map(x => (
          <div key={x.l}>
            <Mono style={{ fontSize: 7, color: C.sageMid, textTransform: 'uppercase', letterSpacing: '1.5px', display: 'block' }}>{x.l}</Mono>
            <span style={{ fontSize: 12, color: C.sageDark, fontFamily: SERIF }}>{x.v || '—'}</span>
          </div>
        ))}
      </div>
      {(block.focus || block.notes) && (
        <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${C.creamDark}40` }}>
          {block.focus && <Mono style={{ fontSize: 10, color: C.sage, display: 'block' }}>Focus: {block.focus}</Mono>}
          {block.notes && <Mono style={{ fontSize: 10, color: C.sageMid, display: 'block', marginTop: 2 }}>{block.notes}</Mono>}
        </div>
      )}
    </div>
  )
}

// ─── Add Block Sheet — supports adding groups in one go ───────────
function AddBlockSheet({ open, onClose, onSubmit, nextGroupLabel, existingGroupLabels, saving }) {
  const [sectionType, setSectionType] = useState('main')
  const [blockType, setBlockType] = useState('single')
  const [groupLabel, setGroupLabel] = useState('')
  const [exercises, setExercises] = useState([{ exercise_name: '', sets: '', reps: '', weight: '', focus: '', notes: '', category: '' }])

  // Reset whenever opened
  useEffect(() => {
    if (open) {
      setSectionType('main')
      setBlockType('single')
      setGroupLabel('')
      setExercises([{ exercise_name: '', sets: '', reps: '', weight: '', focus: '', notes: '', category: '' }])
    }
  }, [open])

  // Update group label automatically when block_type changes
  useEffect(() => {
    if (blockType === 'single') {
      setGroupLabel('')
    } else {
      setGroupLabel(prev => prev || nextGroupLabel(sectionType))
    }
  }, [blockType, sectionType])

  // Sync exercise array length with block_type expectations
  useEffect(() => {
    const cfg = BLOCK_TYPES.find(b => b.value === blockType)
    if (!cfg) return
    setExercises(prev => {
      if (prev.length < cfg.min) {
        const extras = Array.from({ length: cfg.min - prev.length }, () => ({ exercise_name: '', sets: '', reps: '', weight: '', focus: '', notes: '', category: '' }))
        return [...prev, ...extras]
      }
      if (prev.length > cfg.max) return prev.slice(0, cfg.max)
      return prev
    })
  }, [blockType])

  const blockTypeCfg = BLOCK_TYPES.find(b => b.value === blockType)
  const canAddMore = exercises.length < (blockTypeCfg?.max || 1)

  const updateEx = (i, k, v) => setExercises(prev => prev.map((e, idx) => idx === i ? { ...e, [k]: v } : e))
  const addEx = () => setExercises(prev => [...prev, { exercise_name: '', sets: '', reps: '', weight: '', focus: '', notes: '', category: '' }])
  const removeEx = (i) => setExercises(prev => prev.filter((_, idx) => idx !== i))

  const submit = () => {
    const valid = exercises.filter(e => e.exercise_name.trim())
    if (valid.length === 0) return
    onSubmit({
      section_type: sectionType,
      block_type: blockType,
      group_label: blockType === 'single' ? null : (groupLabel || nextGroupLabel(sectionType)),
      exercises: valid,
    })
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add Exercise(s)">
      <Select label="Section" value={sectionType} onChange={setSectionType}
        options={SECTIONS.map(s => ({ value: s.value, label: s.label }))} />
      <Select label="Block Type" value={blockType} onChange={setBlockType}
        options={BLOCK_TYPES.map(b => ({ value: b.value, label: b.label }))} />
      {blockType !== 'single' && (
        <div style={{ marginBottom: 12 }}>
          <Mono style={{ fontSize: 9, letterSpacing: '2px', color: C.sageMid, textTransform: 'uppercase', display: 'block', marginBottom: 5 }}>
            Group Label (A, B, C...)
          </Mono>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input value={groupLabel} onChange={e => setGroupLabel(e.target.value.toUpperCase().slice(0, 2))}
              style={{ width: 80, padding: '10px 12px', borderRadius: 10, border: `1px solid ${C.creamDark}`, background: C.white, fontSize: 16, color: C.sageDark, fontFamily: MONO, outline: 'none', textTransform: 'uppercase' }} />
            <Mono style={{ fontSize: 10, color: C.sageMid, lineHeight: 1.4 }}>
              {(existingGroupLabels(sectionType) || []).length > 0
                ? `Used in this section: ${existingGroupLabels(sectionType).join(', ')}`
                : 'No groups yet in this section'}
            </Mono>
          </div>
        </div>
      )}
      <div style={{ borderTop: `1px solid ${C.creamDark}80`, margin: '14px 0 10px', paddingTop: 14 }}>
        <Mono style={{ fontSize: 9, letterSpacing: '2px', color: C.sageMid, textTransform: 'uppercase', display: 'block', marginBottom: 10 }}>
          Exercises ({exercises.length}{blockTypeCfg ? ` · ${blockTypeCfg.min}–${blockTypeCfg.max}` : ''})
        </Mono>
      </div>
      {exercises.map((ex, i) => (
        <div key={i} style={{ background: C.white, borderRadius: 10, padding: 12, marginBottom: 10, border: `1px solid ${C.creamDark}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Mono style={{ fontSize: 9, color: C.sage, letterSpacing: '1.5px', textTransform: 'uppercase' }}>
              {blockType === 'single' ? 'Exercise' : `${groupLabel || '—'}${i + 1}`}
            </Mono>
            {exercises.length > (blockTypeCfg?.min || 1) && (
              <button onClick={() => removeEx(i)} style={{ background: 'none', border: 'none', color: C.amber, fontSize: 12, fontFamily: MONO, cursor: 'pointer' }}>Remove</button>
            )}
          </div>
          <Input label="Exercise Name" value={ex.exercise_name} onChange={v => updateEx(i, 'exercise_name', v)} placeholder="e.g. Back Squat" />
          <Select label="Movement Category" value={ex.category} onChange={v => updateEx(i, 'category', v)}
            options={[{ value: '', label: '— None —' }, ...CATEGORIES.map(c => ({ value: c.value, label: c.label }))]} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <Input label="Sets" value={ex.sets} onChange={v => updateEx(i, 'sets', v)} placeholder="3" />
            <Input label="Reps" value={ex.reps} onChange={v => updateEx(i, 'reps', v)} placeholder="10–12" />
            <Input label="Weight" value={ex.weight} onChange={v => updateEx(i, 'weight', v)} placeholder="20KG" />
          </div>
          <Input label="Focus / Cue" value={ex.focus} onChange={v => updateEx(i, 'focus', v)} placeholder="e.g. Glutes + Quads" />
          <Input label="Notes" value={ex.notes} onChange={v => updateEx(i, 'notes', v)} placeholder="e.g. RPE 8, controlled tempo" />
        </div>
      ))}
      {canAddMore && blockType !== 'single' && (
        <button onClick={addEx} style={{ width: '100%', padding: 11, background: `${C.sage}15`, border: `1px dashed ${C.sage}60`, borderRadius: 10, color: C.sage, fontFamily: MONO, fontSize: 11, letterSpacing: '1px', cursor: 'pointer', marginBottom: 10 }}>
          + Another exercise in this group
        </button>
      )}
      <Btn onClick={submit} color={C.sage} full disabled={saving}>{saving ? 'Adding...' : `Add ${exercises.filter(e => e.exercise_name.trim()).length || ''} Exercise${exercises.filter(e => e.exercise_name.trim()).length === 1 ? '' : 's'}`}</Btn>
    </Sheet>
  )
}

// ─── Edit Block Sheet ────────────────────────────────────────────
function EditBlockSheet({ open, block, onClose, onSubmit, saving }) {
  const [form, setForm] = useState(null)
  useEffect(() => {
    if (block) setForm({
      exercise_name: block.exercise_name || '', sets: block.sets || '', reps: block.reps || '',
      weight: block.weight || '', focus: block.focus || '', notes: block.notes || '',
      section_type: block.section_type || 'main', category: block.category || '',
    })
  }, [block])
  if (!form) return null
  return (
    <Sheet open={open} onClose={onClose} title="Edit Exercise">
      <Input label="Exercise Name" value={form.exercise_name} onChange={v => setForm(p => ({ ...p, exercise_name: v }))} />
      <Select label="Section" value={form.section_type} onChange={v => setForm(p => ({ ...p, section_type: v }))}
        options={SECTIONS.map(s => ({ value: s.value, label: s.label }))} />
      <Select label="Movement Category" value={form.category} onChange={v => setForm(p => ({ ...p, category: v }))}
        options={[{ value: '', label: '— None —' }, ...CATEGORIES.map(c => ({ value: c.value, label: c.label }))]} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <Input label="Sets" value={form.sets} onChange={v => setForm(p => ({ ...p, sets: v }))} />
        <Input label="Reps" value={form.reps} onChange={v => setForm(p => ({ ...p, reps: v }))} />
        <Input label="Weight" value={form.weight} onChange={v => setForm(p => ({ ...p, weight: v }))} />
      </div>
      <Input label="Focus / Cue" value={form.focus} onChange={v => setForm(p => ({ ...p, focus: v }))} />
      <Input label="Notes" value={form.notes} onChange={v => setForm(p => ({ ...p, notes: v }))} />
      <Btn onClick={() => onSubmit(form)} color={C.sage} full disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</Btn>
    </Sheet>
  )
}

// ─── Run Day — log actual weights / reps ─────────────────────────
function RunDay({ program, day, blocks, client, onBack }) {
  const [logs, setLogs] = useState({})
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)
  const showToast = msg => { setToast(msg); setTimeout(() => setToast(null), 2500) }

  const submit = async () => {
    setSaving(true)
    const rows = Object.entries(logs).filter(([_, l]) => l.actual_weight || l.actual_reps || l.actual_sets || l.notes).map(([blockId, l]) => {
      const b = blocks.find(x => x.id === blockId)
      return {
        client_id: program.client_id, exercise_name: b?.exercise_name || '',
        date: today(), sets: l.actual_sets || b?.sets || '', reps: l.actual_reps || b?.reps || '',
        weight: l.actual_weight || b?.weight || '', notes: l.notes || '',
        program_id: program.id, day_id: day.id,
      }
    })
    if (rows.length > 0) await supabase.from('exercise_logs').insert(rows)
    setSaving(false)
    showToast('Saved to progression ✓')
    setTimeout(onBack, 800)
  }

  const sections = groupBlocks(blocks)
  return (
    <div style={{ minHeight: '60vh', paddingBottom: 100 }}>
      <div style={{ padding: '0 16px 14px' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: C.sageMid, fontFamily: MONO, fontSize: 11, cursor: 'pointer', padding: 0, marginBottom: 8 }}>← Back to Builder</button>
        <h2 style={{ fontFamily: SERIF, fontSize: 20, color: C.sageDark, margin: 0, fontWeight: 400 }}>Run — {day.name}</h2>
        <Mono style={{ fontSize: 10, color: C.sageMid, marginTop: 4, display: 'block' }}>{day.theme}</Mono>
      </div>
      <div style={{ padding: '0 16px' }}>
        <Mono style={{ fontSize: 10, color: C.sageMid, marginBottom: 14, display: 'block', lineHeight: 1.6 }}>
          Log what was actually done. These auto-save to each exercise's progression history.
        </Mono>
        {sections.map(sec => (
          <div key={sec.section} style={{ marginBottom: 14 }}>
            <Mono style={{ fontSize: 9, letterSpacing: '2px', color: C.sageDark, textTransform: 'uppercase', display: 'block', marginBottom: 6, fontWeight: 600 }}>{sectionLabel(sec.section)}</Mono>
            {sec.groups.map(g => g.blocks.map(b => (
              <Card key={b.id} style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div>
                    {g.label && <Mono style={{ fontSize: 8, color: C.sage, letterSpacing: '1.5px', display: 'block' }}>{g.label}{g.blocks.length > 1 ? g.blocks.findIndex(x => x.id === b.id) + 1 : ''}</Mono>}
                    <span style={{ fontSize: 14, color: C.sageDark, fontFamily: SERIF }}>{b.exercise_name}</span>
                  </div>
                  <Mono style={{ fontSize: 9, color: C.sageMid }}>Target: {b.sets}×{b.reps} @ {b.weight || '—'}</Mono>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  {[{ l: 'Sets done', k: 'actual_sets', ph: b.sets }, { l: 'Reps done', k: 'actual_reps', ph: b.reps }, { l: 'Weight', k: 'actual_weight', ph: b.weight }].map(f => (
                    <div key={f.k}>
                      <Mono style={{ fontSize: 7, color: C.sageMid, textTransform: 'uppercase', letterSpacing: '1px', display: 'block', marginBottom: 3 }}>{f.l}</Mono>
                      <input value={logs[b.id]?.[f.k] || ''} onChange={e => setLogs(p => ({ ...p, [b.id]: { ...p[b.id], [f.k]: e.target.value } }))}
                        placeholder={f.ph || '—'} style={{ width: '100%', padding: '7px 9px', borderRadius: 7, border: `1px solid ${C.creamDark}`, background: C.white, fontSize: 13, color: C.sageDark, fontFamily: MONO, outline: 'none', boxSizing: 'border-box' }} />
                    </div>
                  ))}
                </div>
                <input value={logs[b.id]?.notes || ''} onChange={e => setLogs(p => ({ ...p, [b.id]: { ...p[b.id], notes: e.target.value } }))}
                  placeholder="Notes..." style={{ width: '100%', marginTop: 8, padding: '7px 9px', borderRadius: 7, border: `1px solid ${C.creamDark}`, background: C.white, fontSize: 12, color: C.sageDark, fontFamily: MONO, outline: 'none', boxSizing: 'border-box' }} />
              </Card>
            )))}
          </div>
        ))}
        <button onClick={submit} disabled={saving} style={{ width: '100%', padding: 16, background: C.sage, color: C.white, border: 'none', borderRadius: 12, fontSize: 13, fontFamily: MONO, letterSpacing: '2px', textTransform: 'uppercase', cursor: 'pointer', marginTop: 8 }}>
          {saving ? 'Saving...' : 'Save Session to Progression'}
        </button>
      </div>
      {toast && <Toast msg={toast} />}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// PROGRESS sub-tab — per-client progression view
// (replaces former standalone "Progression" tab — lives inside client now)
// ═══════════════════════════════════════════════════════════════════
function ProgressSubTab({ client }) {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedExercise, setSelectedExercise] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ exercise_name: '', date: today(), sets: '', reps: '', weight: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)
  const showToast = msg => { setToast(msg); setTimeout(() => setToast(null), 2200) }

  useEffect(() => { load() }, [client.id])

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('exercise_logs')
      .select('*').eq('client_id', client.id).order('date', { ascending: true })
    setLogs(data || [])
    setLoading(false)
  }

  const exercises = useMemo(() => [...new Set(logs.map(l => l.exercise_name))].sort(), [logs])
  useEffect(() => {
    if (!selectedExercise && exercises.length > 0) setSelectedExercise(exercises[0])
  }, [exercises, selectedExercise])

  const exerciseLogs = logs.filter(l => l.exercise_name === selectedExercise)
  const chartData = exerciseLogs.map(l => ({
    date: l.date,
    weight: parseFloat(l.weight) || 0,
    label: `${l.weight || '?'} · ${l.reps || '?'} reps`,
  }))

  const addLog = async () => {
    if (!form.exercise_name || !form.date) return
    setSaving(true)
    const { error } = await supabase.from('exercise_logs').insert([{
      client_id: client.id, exercise_name: form.exercise_name,
      date: form.date, sets: form.sets, reps: form.reps,
      weight: form.weight, notes: form.notes,
    }])
    if (!error) {
      await load()
      setShowAdd(false)
      setForm({ exercise_name: '', date: today(), sets: '', reps: '', weight: '', notes: '' })
      showToast('Logged ✓')
    }
    setSaving(false)
  }

  // best-lift summary
  const personalBests = useMemo(() => {
    const map = {}
    logs.forEach(l => {
      const w = parseFloat(l.weight) || 0
      if (!map[l.exercise_name] || w > map[l.exercise_name].weight) {
        map[l.exercise_name] = { weight: w, date: l.date, reps: l.reps }
      }
    })
    return Object.entries(map).filter(([, v]) => v.weight > 0)
      .sort((a, b) => b[1].weight - a[1].weight).slice(0, 4)
  }, [logs])

  return (
    <div style={{ padding: '0 14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Mono style={{ fontSize: 9, color: C.sageMid, letterSpacing: '2px', textTransform: 'uppercase' }}>
          Progression · {logs.length} log{logs.length !== 1 ? 's' : ''}
        </Mono>
        <button onClick={() => setShowAdd(true)} style={{ background: C.sage, border: 'none', borderRadius: 8, padding: '6px 12px', color: C.white, fontFamily: MONO, fontSize: 10, letterSpacing: '1px', cursor: 'pointer' }}>+ Log</button>
      </div>

      {loading ? <Spinner /> : (
        <>
          {personalBests.length > 0 && (
            <Card style={{ marginBottom: 12 }}>
              <Mono style={{ fontSize: 9, color: C.sageMid, letterSpacing: '2px', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>Top Lifts</Mono>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                {personalBests.map(([name, v]) => (
                  <div key={name} style={{ padding: 8, background: C.creamLight, borderRadius: 8 }}>
                    <Mono style={{ fontSize: 9, color: C.sageMid, display: 'block', marginBottom: 2 }}>{name}</Mono>
                    <span style={{ fontSize: 17, color: C.sageDark, fontFamily: SERIF }}>{v.weight}</span>
                    <Mono style={{ fontSize: 9, color: C.sageMid, marginLeft: 6 }}>× {v.reps || '?'}</Mono>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {exercises.length > 0 ? (
            <>
              <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 12, paddingBottom: 4, scrollbarWidth: 'none' }}>
                {exercises.map(ex => (
                  <button key={ex} onClick={() => setSelectedExercise(ex)} style={{
                    padding: '6px 12px', borderRadius: 99, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                    background: selectedExercise === ex ? C.sage : C.white,
                    color: selectedExercise === ex ? C.white : C.sageDark,
                    fontSize: 10, fontFamily: MONO, boxShadow: '0 1px 3px rgba(0,0,0,.06)',
                  }}>{ex}</button>
                ))}
              </div>

              {selectedExercise && exerciseLogs.length > 0 && (
                <>
                  {chartData.some(d => d.weight > 0) && (
                    <Card style={{ marginBottom: 12 }}>
                      <Mono style={{ fontSize: 9, color: C.sageMid, letterSpacing: '2px', textTransform: 'uppercase', display: 'block', marginBottom: 10 }}>{selectedExercise}</Mono>
                      <ResponsiveContainer width="100%" height={130}>
                        <LineChart data={chartData}>
                          <XAxis dataKey="date" tick={{ fontSize: 8, fontFamily: MONO, fill: C.sageMid }} tickLine={false} axisLine={false} />
                          <YAxis tick={{ fontSize: 8, fontFamily: MONO, fill: C.sageMid }} tickLine={false} axisLine={false} width={30} />
                          <Tooltip contentStyle={{ fontFamily: MONO, fontSize: 11, background: C.sageDark, border: 'none', borderRadius: 8, color: C.cream }} />
                          <Line type="monotone" dataKey="weight" stroke={C.sage} strokeWidth={2} dot={{ fill: C.sage, r: 4 }} activeDot={{ r: 6 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </Card>
                  )}

                  <Mono style={{ fontSize: 9, letterSpacing: '2px', color: C.sageMid, textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>
                    History · {exerciseLogs.length} entr{exerciseLogs.length !== 1 ? 'ies' : 'y'}
                  </Mono>
                  {[...exerciseLogs].reverse().map((l, i) => (
                    <Card key={l.id || i} style={{ marginBottom: 6, padding: 11 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <span style={{ fontSize: 18, color: C.sageDark, fontFamily: SERIF, display: 'block', lineHeight: 1 }}>{l.weight || '—'}</span>
                          <Mono style={{ fontSize: 10, color: C.sageMid, marginTop: 3 }}>{l.sets || '?'} × {l.reps || '?'}</Mono>
                          {l.notes && <Mono style={{ fontSize: 10, color: C.sageMid, display: 'block', marginTop: 3, fontStyle: 'italic' }}>{l.notes}</Mono>}
                        </div>
                        <Mono style={{ fontSize: 10, color: C.sageMid }}>{l.date}</Mono>
                      </div>
                    </Card>
                  ))}
                </>
              )}
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: 30 }}>
              <p style={{ fontFamily: MONO, color: C.sageMid, fontSize: 12 }}>No progression data yet.</p>
              <p style={{ fontFamily: MONO, color: C.sageMid, fontSize: 11, marginTop: 8 }}>Tap + Log to add, or run a session from Programs.</p>
            </div>
          )}
        </>
      )}

      <Sheet open={showAdd} onClose={() => setShowAdd(false)} title="Log Exercise">
        <Input label="Exercise Name" value={form.exercise_name} onChange={v => setForm(p => ({ ...p, exercise_name: v }))} placeholder="e.g. Back Squat" />
        <Input label="Date" value={form.date} onChange={v => setForm(p => ({ ...p, date: v }))} placeholder="14 May 2026" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <Input label="Sets" value={form.sets} onChange={v => setForm(p => ({ ...p, sets: v }))} placeholder="3" />
          <Input label="Reps" value={form.reps} onChange={v => setForm(p => ({ ...p, reps: v }))} placeholder="10" />
          <Input label="Weight" value={form.weight} onChange={v => setForm(p => ({ ...p, weight: v }))} placeholder="50KG" />
        </div>
        <Input label="Notes" value={form.notes} onChange={v => setForm(p => ({ ...p, notes: v }))} placeholder="felt strong, good depth" />
        <Btn onClick={addLog} color={C.sage} style={{ width: '100%', marginTop: 8 }}>{saving ? 'Saving...' : 'Save Log'}</Btn>
      </Sheet>

      {toast && <Toast msg={toast} />}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// GOALS sub-tab — per-client goals
// Uses client_goals table (see migration-v2.sql)
// ═══════════════════════════════════════════════════════════════════
const GOAL_TYPES = [
  { value: 'fat_loss',         label: 'Fat Loss',          color: C.amber },
  { value: 'hypertrophy',      label: 'Hypertrophy',       color: C.sage },
  { value: 'strength',         label: 'Strength',          color: C.sageDark },
  { value: 'power',            label: 'Power',             color: C.plum },
  { value: 'mobility',         label: 'Mobility',          color: '#6b9080' },
  { value: 'rehab',            label: 'Rehab',             color: C.rose },
  { value: 'prehab',           label: 'Prehab',            color: '#a8c5b0' },
  { value: 'postpartum',       label: 'Postpartum',        color: '#d4a5a5' },
  { value: 'hyrox',            label: 'Hyrox',             color: '#b08968' },
  { value: 'sport_specific',   label: 'Sport Specific',    color: '#7d8b69' },
  { value: 'conditioning',     label: 'Conditioning',      color: '#c8956d' },
  { value: 'general_fitness',  label: 'General Fitness',   color: C.sageMid },
  { value: 'custom',           label: 'Custom',            color: C.sageMid },
]

function GoalsSubTab({ client }) {
  const [goals, setGoals] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ goal_type: 'hypertrophy', goal_text: '', priority: '1', target_date: '', status: 'active' })
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)
  const [confirmDel, setConfirmDel] = useState(null)
  const showToast = msg => { setToast(msg); setTimeout(() => setToast(null), 2200) }

  useEffect(() => { load() }, [client.id])

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('client_goals')
      .select('*').eq('client_id', client.id).order('priority', { ascending: true })
    setGoals(data || [])
    setLoading(false)
  }

  const save = async () => {
    if (!form.goal_text.trim()) return
    setSaving(true)
    const payload = {
      client_id: client.id,
      goal_type: form.goal_type,
      goal_text: form.goal_text.trim(),
      priority: parseInt(form.priority) || 1,
      target_date: form.target_date || null,
      status: form.status,
    }
    if (editing) {
      await supabase.from('client_goals').update(payload).eq('id', editing.id)
    } else {
      await supabase.from('client_goals').insert([payload])
    }
    await load()
    setShowAdd(false); setEditing(null)
    setForm({ goal_type: 'hypertrophy', goal_text: '', priority: '1', target_date: '', status: 'active' })
    showToast(editing ? 'Goal updated ✓' : 'Goal added ✓')
    setSaving(false)
  }

  const openEdit = (g) => {
    setEditing(g)
    setForm({ goal_type: g.goal_type || 'custom', goal_text: g.goal_text || '', priority: String(g.priority || 1), target_date: g.target_date || '', status: g.status || 'active' })
    setShowAdd(true)
  }

  const del = async () => {
    if (!confirmDel) return
    await supabase.from('client_goals').delete().eq('id', confirmDel.id)
    setConfirmDel(null)
    await load()
    showToast('Goal removed')
  }

  const setStatus = async (g, status) => {
    await supabase.from('client_goals').update({ status }).eq('id', g.id)
    await load()
    showToast(status === 'achieved' ? '🎯 Achieved!' : 'Updated')
  }

  const active = goals.filter(g => g.status === 'active')
  const achieved = goals.filter(g => g.status === 'achieved')
  const paused = goals.filter(g => g.status === 'paused')

  return (
    <div style={{ padding: '0 14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Mono style={{ fontSize: 9, color: C.sageMid, letterSpacing: '2px', textTransform: 'uppercase' }}>
          Goals · {active.length} active
        </Mono>
        <button onClick={() => { setEditing(null); setForm({ goal_type: 'hypertrophy', goal_text: '', priority: '1', target_date: '', status: 'active' }); setShowAdd(true) }} style={{ background: C.sage, border: 'none', borderRadius: 8, padding: '6px 12px', color: C.white, fontFamily: MONO, fontSize: 10, letterSpacing: '1px', cursor: 'pointer' }}>+ Goal</button>
      </div>

      {loading ? <Spinner /> : goals.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 30 }}>
          <p style={{ fontFamily: MONO, color: C.sageMid, fontSize: 12 }}>No goals set yet.</p>
          <p style={{ fontFamily: MONO, color: C.sageMid, fontSize: 11, marginTop: 8 }}>Goals feed Smart Coach: program quality + relevance ratings depend on them.</p>
        </div>
      ) : (
        <>
          {active.length > 0 && (
            <>
              <Mono style={{ fontSize: 9, color: C.sage, letterSpacing: '2px', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>Active</Mono>
              {active.sort((a, b) => (a.priority || 99) - (b.priority || 99)).map(g => (
                <GoalCard key={g.id} goal={g} onEdit={() => openEdit(g)} onAchieve={() => setStatus(g, 'achieved')} onPause={() => setStatus(g, 'paused')} onDelete={() => setConfirmDel(g)} />
              ))}
            </>
          )}
          {paused.length > 0 && (
            <>
              <Mono style={{ fontSize: 9, color: C.amber, letterSpacing: '2px', textTransform: 'uppercase', display: 'block', marginBottom: 8, marginTop: 14 }}>Paused</Mono>
              {paused.map(g => (
                <GoalCard key={g.id} goal={g} onEdit={() => openEdit(g)} onAchieve={() => setStatus(g, 'achieved')} onPause={() => setStatus(g, 'active')} pauseLabel="Resume" onDelete={() => setConfirmDel(g)} />
              ))}
            </>
          )}
          {achieved.length > 0 && (
            <>
              <Mono style={{ fontSize: 9, color: C.sageMid, letterSpacing: '2px', textTransform: 'uppercase', display: 'block', marginBottom: 8, marginTop: 14 }}>Achieved · {achieved.length}</Mono>
              {achieved.map(g => (
                <GoalCard key={g.id} goal={g} muted onEdit={() => openEdit(g)} onAchieve={() => setStatus(g, 'active')} achievedLabel="Reactivate" onDelete={() => setConfirmDel(g)} />
              ))}
            </>
          )}
        </>
      )}

      <Sheet open={showAdd} onClose={() => { setShowAdd(false); setEditing(null) }} title={editing ? 'Edit Goal' : 'Add Goal'}>
        <Select label="Type" value={form.goal_type} onChange={v => setForm(p => ({ ...p, goal_type: v }))}
          options={GOAL_TYPES.map(t => ({ value: t.value, label: t.label }))} />
        <Textarea label="Description" value={form.goal_text} onChange={v => setForm(p => ({ ...p, goal_text: v }))} placeholder="e.g. Bodyweight pull-up by Aug" rows={2} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
          <Select label="Priority" value={form.priority} onChange={v => setForm(p => ({ ...p, priority: v }))}
            options={[{ value: '1', label: '1 (top)' }, { value: '2', label: '2' }, { value: '3', label: '3' }, { value: '4', label: '4' }, { value: '5', label: '5' }]} />
          <Input label="Target Date (optional)" value={form.target_date} onChange={v => setForm(p => ({ ...p, target_date: v }))} placeholder="e.g. 31 Aug 2026" />
        </div>
        <Btn onClick={save} color={C.sage} style={{ width: '100%', marginTop: 8 }}>{saving ? 'Saving...' : (editing ? 'Update Goal' : 'Add Goal')}</Btn>
      </Sheet>

      {confirmDel && (
        <ConfirmDialog title="Delete goal?" body={confirmDel.goal_text} confirmLabel="Delete" confirmColor={C.danger} onCancel={() => setConfirmDel(null)} onConfirm={del} />
      )}

      {toast && <Toast msg={toast} />}
    </div>
  )
}

function GoalCard({ goal, onEdit, onAchieve, onPause, onDelete, pauseLabel, achievedLabel, muted }) {
  const t = GOAL_TYPES.find(x => x.value === goal.goal_type) || GOAL_TYPES[GOAL_TYPES.length - 1]
  return (
    <Card style={{ marginBottom: 8, opacity: muted ? 0.7 : 1, borderLeft: `3px solid ${t.color}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <Pill bg={`${t.color}20`} fg={t.color}>{t.label}</Pill>
            {goal.priority && goal.priority <= 2 && <Mono style={{ fontSize: 9, color: C.amber }}>P{goal.priority}</Mono>}
          </div>
          <p style={{ fontSize: 14, color: C.sageDark, fontFamily: SERIF, margin: 0, lineHeight: 1.4 }}>{goal.goal_text}</p>
          {goal.target_date && <Mono style={{ fontSize: 9, color: C.sageMid, marginTop: 4, display: 'block' }}>→ {goal.target_date}</Mono>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <button onClick={onEdit} style={{ padding: '4px 10px', background: C.white, border: `1px solid ${C.creamDark}`, borderRadius: 6, fontSize: 9, fontFamily: MONO, color: C.sageDark, cursor: 'pointer', letterSpacing: '1px' }}>EDIT</button>
          {onAchieve && <button onClick={onAchieve} style={{ padding: '4px 10px', background: C.ok, border: 'none', borderRadius: 6, fontSize: 9, fontFamily: MONO, color: C.white, cursor: 'pointer', letterSpacing: '1px' }}>{achievedLabel || '✓'}</button>}
          {onPause && <button onClick={onPause} style={{ padding: '4px 10px', background: C.white, border: `1px solid ${C.amber}`, borderRadius: 6, fontSize: 9, fontFamily: MONO, color: C.amber, cursor: 'pointer', letterSpacing: '1px' }}>{pauseLabel || 'PAUSE'}</button>}
          {onDelete && <button onClick={onDelete} style={{ padding: '4px 10px', background: C.white, border: `1px solid ${C.danger}40`, borderRadius: 6, fontSize: 9, fontFamily: MONO, color: C.danger, cursor: 'pointer', letterSpacing: '1px' }}>✕</button>}
        </div>
      </div>
    </Card>
  )
}

// ═══════════════════════════════════════════════════════════════════
// NOTES sub-tab — per-client notes / measurements / milestones
// Uses client_notes table (see migration-v2.sql)
// ═══════════════════════════════════════════════════════════════════
const NOTE_TYPES = [
  { value: 'general',     label: 'General',     color: C.sageMid },
  { value: 'injury',      label: 'Injury',      color: C.rose },
  { value: 'measurement', label: 'Measurement', color: C.plum },
  { value: 'photo',       label: 'Photo',       color: '#b08968' },
  { value: 'milestone',   label: 'Milestone',   color: C.amber },
  { value: 'adherence',   label: 'Adherence',   color: C.sage },
  { value: 'recovery',    label: 'Recovery',    color: '#6b9080' },
]

function NotesSubTab({ client }) {
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ note_type: 'general', body: '' })
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)
  const [confirmDel, setConfirmDel] = useState(null)
  const [filter, setFilter] = useState('all')
  const showToast = msg => { setToast(msg); setTimeout(() => setToast(null), 2200) }

  useEffect(() => { load() }, [client.id])

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('client_notes')
      .select('*').eq('client_id', client.id).order('created_at', { ascending: false })
    setNotes(data || [])
    setLoading(false)
  }

  const save = async () => {
    if (!form.body.trim()) return
    setSaving(true)
    if (editing) {
      await supabase.from('client_notes').update({ note_type: form.note_type, body: form.body.trim() }).eq('id', editing.id)
    } else {
      await supabase.from('client_notes').insert([{ client_id: client.id, note_type: form.note_type, body: form.body.trim() }])
    }
    await load()
    setShowAdd(false); setEditing(null)
    setForm({ note_type: 'general', body: '' })
    showToast(editing ? 'Note updated ✓' : 'Note added ✓')
    setSaving(false)
  }

  const openEdit = (n) => { setEditing(n); setForm({ note_type: n.note_type || 'general', body: n.body || '' }); setShowAdd(true) }
  const del = async () => { if (!confirmDel) return; await supabase.from('client_notes').delete().eq('id', confirmDel.id); setConfirmDel(null); await load(); showToast('Note deleted') }

  const filtered = filter === 'all' ? notes : notes.filter(n => n.note_type === filter)
  const counts = NOTE_TYPES.reduce((m, t) => { m[t.value] = notes.filter(n => n.note_type === t.value).length; return m }, {})

  return (
    <div style={{ padding: '0 14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <Mono style={{ fontSize: 9, color: C.sageMid, letterSpacing: '2px', textTransform: 'uppercase' }}>
          Notes · {notes.length}
        </Mono>
        <button onClick={() => { setEditing(null); setForm({ note_type: 'general', body: '' }); setShowAdd(true) }} style={{ background: C.sage, border: 'none', borderRadius: 8, padding: '6px 12px', color: C.white, fontFamily: MONO, fontSize: 10, letterSpacing: '1px', cursor: 'pointer' }}>+ Note</button>
      </div>

      {/* Type filter pills */}
      <div style={{ display: 'flex', gap: 5, overflowX: 'auto', marginBottom: 12, paddingBottom: 4, scrollbarWidth: 'none' }}>
        <button onClick={() => setFilter('all')} style={{
          padding: '5px 11px', borderRadius: 99, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
          background: filter === 'all' ? C.sageDark : C.white, color: filter === 'all' ? C.white : C.sageMid,
          fontSize: 9, fontFamily: MONO, letterSpacing: '1px',
        }}>ALL · {notes.length}</button>
        {NOTE_TYPES.filter(t => counts[t.value] > 0).map(t => (
          <button key={t.value} onClick={() => setFilter(t.value)} style={{
            padding: '5px 11px', borderRadius: 99, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
            background: filter === t.value ? t.color : C.white, color: filter === t.value ? C.white : C.sageMid,
            fontSize: 9, fontFamily: MONO, letterSpacing: '1px',
          }}>{t.label.toUpperCase()} · {counts[t.value]}</button>
        ))}
      </div>

      {loading ? <Spinner /> : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 30 }}>
          <p style={{ fontFamily: MONO, color: C.sageMid, fontSize: 12 }}>No notes yet.</p>
          <p style={{ fontFamily: MONO, color: C.sageMid, fontSize: 11, marginTop: 8 }}>Track injuries, measurements, milestones, photos, adherence.</p>
        </div>
      ) : (
        filtered.map(n => {
          const t = NOTE_TYPES.find(x => x.value === n.note_type) || NOTE_TYPES[0]
          const created = n.created_at ? new Date(n.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
          return (
            <Card key={n.id} style={{ marginBottom: 8, borderLeft: `3px solid ${t.color}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                <Pill bg={`${t.color}20`} fg={t.color}>{t.label}</Pill>
                <Mono style={{ fontSize: 9, color: C.sageMid }}>{created}</Mono>
              </div>
              <p style={{ fontSize: 13, color: C.sageDark, fontFamily: SERIF, margin: '4px 0 8px', lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{n.body}</p>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button onClick={() => openEdit(n)} style={{ padding: '4px 10px', background: C.white, border: `1px solid ${C.creamDark}`, borderRadius: 6, fontSize: 9, fontFamily: MONO, color: C.sageDark, cursor: 'pointer', letterSpacing: '1px' }}>EDIT</button>
                <button onClick={() => setConfirmDel(n)} style={{ padding: '4px 10px', background: C.white, border: `1px solid ${C.danger}40`, borderRadius: 6, fontSize: 9, fontFamily: MONO, color: C.danger, cursor: 'pointer', letterSpacing: '1px' }}>DELETE</button>
              </div>
            </Card>
          )
        })
      )}

      <Sheet open={showAdd} onClose={() => { setShowAdd(false); setEditing(null) }} title={editing ? 'Edit Note' : 'Add Note'}>
        <Select label="Type" value={form.note_type} onChange={v => setForm(p => ({ ...p, note_type: v }))}
          options={NOTE_TYPES.map(t => ({ value: t.value, label: t.label }))} />
        <Textarea label="Note" value={form.body} onChange={v => setForm(p => ({ ...p, body: v }))} placeholder="What happened, observations, measurements..." rows={5} />
        <Btn onClick={save} color={C.sage} style={{ width: '100%', marginTop: 8 }}>{saving ? 'Saving...' : (editing ? 'Update' : 'Add Note')}</Btn>
      </Sheet>

      {confirmDel && (
        <ConfirmDialog title="Delete note?" body={confirmDel.body?.slice(0, 80) + (confirmDel.body?.length > 80 ? '...' : '')} confirmLabel="Delete" confirmColor={C.danger} onCancel={() => setConfirmDel(null)} onConfirm={del} />
      )}

      {toast && <Toast msg={toast} />}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// LIBRARY TAB — global programs library (foundation; PDFs land here later)
// ═══════════════════════════════════════════════════════════════════
const LIBRARY_CATEGORIES = [
  { id: 'strength',     label: 'Strength & Hypertrophy', desc: 'Functional Strength, Strength Conditioning, Pull-up progressions' },
  { id: 'conditioning', label: 'Conditioning',           desc: 'AirBike protocols, intervals, Hyrox preparation' },
  { id: 'weightlift',   label: 'Olympic & Power',        desc: 'Snatch / Clean & Jerk, complexes, contrast' },
  { id: 'mobility',     label: 'Mobility & Recovery',    desc: 'Joint-by-joint mobility, recovery flows' },
  { id: 'rehab',        label: 'Rehab & Prehab',         desc: 'Shoulder, knee, lower-back, postpartum' },
  { id: 'beginner',     label: 'Beginner Templates',     desc: 'Onboarding, foundations, learning to lift' },
  { id: 'sport',        label: 'Sport-Specific',         desc: 'Tennis, padel, running, multi-sport' },
]

function LibraryTab({ onProgramOpen }) {
  const [category, setCategory] = useState('strength')
  const [search, setSearch] = useState('')

  return (
    <div style={{ minHeight: '100vh', background: C.creamLight, paddingBottom: 90 }}>
      <Header title="Library" subtitle="Global programs · templates · systems" />

      <div style={{ padding: '14px 16px 0' }}>
        <div style={{ background: C.sage + '15', border: `1px dashed ${C.sage}60`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
          <Mono style={{ fontSize: 9, color: C.sageDark, letterSpacing: '2px', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>⚡ Coming Soon</Mono>
          <p style={{ fontFamily: SERIF, fontSize: 14, color: C.sageDark, margin: 0, lineHeight: 1.5 }}>
            30+ programs from your PDF library are queued for ingestion: Functional Strength, Beginner Pull-up, AirBike, Weightlifting complexes, Sport-Specific. Each will become a clonable template you can assign to any client with one tap.
          </p>
        </div>

        <Input label="Search" value={search} onChange={setSearch} placeholder="e.g. pull-up, hyrox, mobility" />

        <Mono style={{ fontSize: 9, color: C.sageMid, letterSpacing: '2px', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>Categories</Mono>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8, marginBottom: 16 }}>
          {LIBRARY_CATEGORIES.filter(c => !search || c.label.toLowerCase().includes(search.toLowerCase()) || c.desc.toLowerCase().includes(search.toLowerCase())).map(c => (
            <Card key={c.id} onClick={() => setCategory(c.id)} style={{ cursor: 'pointer', borderLeft: `3px solid ${category === c.id ? C.sage : C.creamDark}`, marginBottom: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={{ fontSize: 16, color: C.sageDark, fontFamily: SERIF, display: 'block' }}>{c.label}</span>
                  <Mono style={{ fontSize: 10, color: C.sageMid, marginTop: 3, display: 'block' }}>{c.desc}</Mono>
                </div>
                <Mono style={{ fontSize: 9, color: C.sageMid, letterSpacing: '1px' }}>SOON</Mono>
              </div>
            </Card>
          ))}
        </div>

        <Mono style={{ fontSize: 9, color: C.sageMid, letterSpacing: '2px', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>What this becomes</Mono>
        <Card>
          <ul style={{ margin: 0, padding: '0 0 0 18px', fontFamily: SERIF, fontSize: 13, color: C.sageDark, lineHeight: 1.7 }}>
            <li>Browse + preview templates by category</li>
            <li>One-tap clone into any client's Programs</li>
            <li>Smart Coach pre-rates each template against client goal/level/equipment</li>
            <li>Filter by movement category, equipment, level, duration</li>
            <li>Tag favourites, recently used, custom-built</li>
          </ul>
        </Card>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// REVENUE TAB — with lifecycle awareness
// ═══════════════════════════════════════════════════════════════════
function RevenueTab({ clients }) {
  // Exclude archived from totals; show separately if any
  const live = clients.filter(c => c.status !== 'archived')
  const archived = clients.filter(c => c.status === 'archived')

  const totalEarned = live.reduce((a, c) => a + (c.completed_packages * c.rate), 0)
  const totalIP = live.reduce((a, c) => a + Math.round((c.sessions_completed / c.package_size) * c.rate), 0)
  const totalSessions = live.reduce((a, c) => a + c.sessions_completed, 0)
  const totalCancels = live.reduce((a, c) => a + c.cancellations, 0)

  const exportAll = async () => {
    const { data } = await supabase.from('sessions').select('*, clients(name)').order('created_at', { ascending: true })
    const rows = [['Client', 'Date', 'Package', 'Location', 'Note', 'Type']]
    ;(data || []).forEach(s => rows.push([s.clients?.name || '', s.date, `Package ${s.pkg}`, s.location, cleanLegacyNote(s.note || '', s.cancelled), s.cancelled ? 'Cancelled' : 'Session']))
    const csv = rows.map(r => r.map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = 'she-skulpts-all-sessions.csv'
    a.click()
  }

  return (
    <div style={{ minHeight: '100vh', background: C.creamLight, paddingBottom: 90 }}>
      <Header title="Revenue" />
      <div style={{ padding: '14px 16px 0' }}>
        <div style={{ background: C.sageDark, borderRadius: 14, padding: '18px 20px', marginBottom: 10 }}>
          <Mono style={{ fontSize: 9, letterSpacing: '3px', color: C.sageLight, textTransform: 'uppercase', display: 'block' }}>Confirmed Earned</Mono>
          <div style={{ fontSize: 40, fontWeight: 400, color: C.creamLight, fontFamily: SERIF, marginTop: 4, lineHeight: 1 }}>{fmt(totalEarned)}</div>
          <div style={{ display: 'flex', gap: 24, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.sageMid}60` }}>
            <div>
              <Mono style={{ fontSize: 8, letterSpacing: '2px', color: C.sageLight, textTransform: 'uppercase', display: 'block' }}>In Progress</Mono>
              <span style={{ fontSize: 16, color: C.amber, fontFamily: SERIF }}>{fmt(totalIP)}</span>
            </div>
            <div>
              <Mono style={{ fontSize: 8, letterSpacing: '2px', color: C.sageLight, textTransform: 'uppercase', display: 'block' }}>All-Time Est.</Mono>
              <span style={{ fontSize: 16, color: C.creamLight, fontFamily: SERIF }}>{fmt(totalEarned + totalIP)}</span>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
          {[{ label: 'Sessions', value: totalSessions }, { label: 'Cancels', value: totalCancels }, { label: 'Clients', value: live.length }].map(s => (
            <Card key={s.label} style={{ padding: 11, textAlign: 'center', marginBottom: 0 }}>
              <Mono style={{ fontSize: 8, color: C.sageMid, letterSpacing: '1.5px', textTransform: 'uppercase', display: 'block' }}>{s.label}</Mono>
              <span style={{ fontSize: 22, color: C.sageDark, marginTop: 3, display: 'block', fontFamily: SERIF }}>{s.value}</span>
            </Card>
          ))}
        </div>

        <Mono style={{ fontSize: 9, letterSpacing: '2px', color: C.sageMid, textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>Per Client</Mono>
        {[...live].sort((a, b) => (b.completed_packages * b.rate) - (a.completed_packages * a.rate)).map(c => {
          const earned = c.completed_packages * c.rate
          const ip = Math.round((c.sessions_completed / c.package_size) * c.rate)
          const pct = totalEarned > 0 ? Math.round((earned / totalEarned) * 100) : 0
          const lc = LIFECYCLE[c.status] || LIFECYCLE.active
          return (
            <Card key={c.id} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div>
                  <span style={{ fontSize: 17, color: C.sageDark, fontFamily: SERIF }}>{c.name}</span>
                  <Mono style={{ fontSize: 10, color: C.sageMid, marginLeft: 8 }}>{c.completed_packages} pkg{c.completed_packages !== 1 ? 's' : ''}</Mono>
                  <Pill bg={lc.bg} fg={lc.fg} style={{ marginLeft: 6 }}>{lc.label}</Pill>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: 16, color: C.sageDark, fontFamily: SERIF, display: 'block' }}>{fmt(earned)}</span>
                  {ip > 0 && <Mono style={{ fontSize: 10, color: C.amber }}>+{fmt(ip)} in prog.</Mono>}
                </div>
              </div>
              <div style={{ height: 4, background: `${C.creamDark}40`, borderRadius: 99, overflow: 'hidden', marginBottom: 5 }}>
                <div style={{ height: '100%', width: `${pct}%`, background: c.status === 'active' ? C.sage : C.sageMid, borderRadius: 99 }} />
              </div>
              <Mono style={{ fontSize: 9, color: C.sageMid }}>{pct}% of total earned</Mono>
            </Card>
          )
        })}

        {archived.length > 0 && (
          <Mono style={{ fontSize: 9, color: C.sageMid, letterSpacing: '2px', textTransform: 'uppercase', display: 'block', marginTop: 12 }}>
            {archived.length} archived client{archived.length !== 1 ? 's' : ''} excluded from totals
          </Mono>
        )}

        <button onClick={exportAll} style={{ width: '100%', padding: 14, background: C.sageDark, color: C.cream, border: 'none', borderRadius: 10, fontSize: 12, fontFamily: MONO, letterSpacing: '2px', textTransform: 'uppercase', cursor: 'pointer', marginTop: 8 }}>
          ↓ Export All Session Logs
        </button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// ROOT APP
// ─────────────────────────────────────────────────────────────────────
// Architecture notes:
//
// NUMBERING — never stored. Session #N is derived at render-time from
//   position within (pkg, non-cancelled, date+created_at sorted) — see
//   sessionLabel() + sortSessions(). Legacy "Session #N —" prefixes are
//   stripped via cleanLegacyNote() on display. This is the philosophy
//   throughout: structure and intelligence are DERIVED, not baked into
//   text fields.
//
// WORKOUT GROUPS — exercise_blocks now carry (section_type, block_type,
//   group_label A/B/C, group_position 1/2/3, category). Supersets,
//   trisets, giants, circuits, contrast, complex, prefatigue all share
//   the same group_label so they render visually as one block. Reorder
//   = swap block_order/group_position. Move group = swap block_order
//   ranges. See groupBlocks() and ProgramBuilder.
//
// SMART COACH — analyzeDay(blocks) runs entirely client-side over the
//   block list and surfaces flags (volume, redundancy, balance,
//   sequencing). Hooks into Goals later for goal-relevance ratings.
//
// MEDIA PLAN (deferred — architecture-ready):
//   1. Supabase Storage buckets: exercise-gifs, exercise-videos,
//      exercise-thumbs (CDN-backed, public-read, signed-upload).
//   2. New 'exercises' master table: id, name, category, primary_region,
//      gif_url, video_url, thumb_url, cues_text, equipment[].
//   3. exercise_blocks.exercise_id FK -> exercises.id (nullable; legacy
//      text-only blocks still work).
//   4. Loading strategy:
//        - thumb_url eager on every visible block (~5KB)
//        - gif_url lazy, only when block is expanded
//        - video_url streamed on tap (HTML5 <video> + Storage range req)
//   5. Mobile perf: prefer .webp thumbs + .webm video where supported,
//      fall back to .jpg/.mp4; cap autoplay GIFs at 3 simultaneous.
//   6. Migration path: keep exercises text-free for now, add
//      exercise_id later without breaking existing blocks.
//
// DRAG-AND-DROP — deferred. Current build uses up/down arrows + long-
//   press menu (zero new dependencies, works on every device). Upgrade
//   path: @dnd-kit/core + sortable (~45KB gz). Hook points are already
//   in place — moveBlockUp/Down, moveGroupUp/Down are isolated handlers
//   that a DnD reducer can call directly.
// ═══════════════════════════════════════════════════════════════════
export default function App() {
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('clients')
  const [selectedClient, setSelectedClient] = useState(null)

  useEffect(() => { loadClients() }, [])

  const loadClients = async () => {
    const { data } = await supabase.from('clients').select('*').order('name')
    setClients(data || [])
    setLoading(false)
  }

  // Keep selectedClient in sync with clients list (after edits)
  useEffect(() => {
    if (selectedClient) {
      const fresh = clients.find(c => c.id === selectedClient.id)
      if (fresh && fresh !== selectedClient) setSelectedClient(fresh)
    }
  }, [clients])

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: C.sageDark, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
        <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '4px', color: C.sageLight, textTransform: 'uppercase', marginBottom: 8 }}>She Skulpts</div>
        <div style={{ fontFamily: SERIF, fontSize: 22, color: C.creamLight, marginBottom: 30 }}>Loading...</div>
        <Spinner />
      </div>
    )
  }

  const navTo = (t) => {
    setTab(t)
    setSelectedClient(null)
  }

  // If a client is selected, show their detail view (overlays clients tab)
  if (selectedClient) {
    return (
      <ClientDetail
        client={selectedClient}
        clients={clients}
        setClients={setClients}
        setSelectedClient={setSelectedClient}
        onBack={() => setSelectedClient(null)}
      />
    )
  }

  return (
    <div>
      {tab === 'clients' && (
        <ClientsTab
          clients={clients}
          setClients={setClients}
          onOpen={c => setSelectedClient(c)}
        />
      )}
      {tab === 'library' && <LibraryTab />}
      {tab === 'revenue' && <RevenueTab clients={clients} />}

      <BottomNav tab={tab} setTab={navTo} />
    </div>
  )
}
