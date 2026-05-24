import { useState, useEffect, useCallback } from 'react'
import { supabase } from './supabase.js'
import { prettifyLabel } from './lib/prettifyLabel.js'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

// ─── Brand tokens ──────────────────────────────────────────────────────────
const C = {
  sage: '#8CA199', sageDark: '#575C59', sageMid: '#737B76',
  sageLight: '#C8D6CE', sageXLight: '#ABB7B0',
  cream: '#EFE6DA', creamLight: '#F8F4EE', creamDark: '#BBB9AE',
  white: '#FFFFFF', amber: '#B8732A',
}
const MONO = "'DM Mono', monospace"
const IMPACT = "Impact, 'Arial Narrow', sans-serif"
const INCISED = "'Trebuchet MS', 'DM Sans', sans-serif"
const SERIF = "'Libre Baskerville', Georgia, serif"

// ─── Chevron component (your brand arrows) ─────────────────────────────────
const Chevron = ({ open = false, size = 14, color = '#8CA199' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{
    transition: 'transform .25s ease', transform: open ? 'rotate(90deg)' : 'rotate(0deg)', flexShrink: 0,
  }}>
    <path d="M9 6l6 6-6 6" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

// ─── Helpers ───────────────────────────────────────────────────────────────
const fmt = n => `AED ${Number(n || 0).toLocaleString()}`
const today = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

// ─── Small UI components ───────────────────────────────────────────────────
const Mono = ({ children, style = {} }) => (
  <span style={{ fontFamily: MONO, ...style }}>{children}</span>
)

const Badge = ({ status }) => (
  <span style={{
    fontSize: 8, fontFamily: MONO, letterSpacing: '2px', textTransform: 'uppercase',
    padding: '3px 9px', borderRadius: 99,
    background: status === 'active' ? `${C.sage}30` : `${C.sageMid}18`,
    color: status === 'active' ? C.sageDark : C.sageMid,
    border: `1px solid ${status === 'active' ? C.sage + '60' : C.sageLight + '60'}`,
    fontWeight: 600,
  }}>{status === 'active' ? 'Active' : 'Pkg Done'}</span>
)

const ProgressBar = ({ done, total }) => {
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
      <div style={{ height: 5, background: `${C.creamDark}50`, borderRadius: 99, overflow: 'hidden' }}>
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
    <div style={{ width: 28, height: 28, border: `2px solid ${C.sageLight}`, borderTopColor: C.sage, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
  </div>
)

const Header = ({ title, subtitle, onBack, right }) => (
  <div style={{ background: C.sage, padding: onBack ? '18px 20px 20px' : '26px 20px 18px', position: 'sticky', top: 0, zIndex: 20 }}>
    {onBack && (
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: C.creamLight, fontSize: 12, fontFamily: MONO, padding: 0, marginBottom: 10, cursor: 'pointer' }}>← Back</button>
    )}
    {!onBack && (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <span style={{ fontFamily: IMPACT, fontSize: 15, letterSpacing: '2px', color: C.white, textTransform: 'uppercase', lineHeight: 1 }}>SHE SKULPTS</span>
        <span style={{ color: `${C.creamLight}60`, fontSize: 10 }}>·</span>
        <span style={{ fontFamily: INCISED, fontSize: 9, letterSpacing: '3px', color: C.creamLight, textTransform: 'uppercase', opacity: 0.85 }}>it's you, just sculpted</span>
      </div>
    )}
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
      <div>
        <h1 style={{ margin: 0, fontSize: onBack ? 22 : 24, fontWeight: 700, color: C.white, fontFamily: IMPACT, letterSpacing: '1px', textTransform: 'uppercase', lineHeight: 1.1 }}>{title}</h1>
        {subtitle && <span style={{ fontFamily: INCISED, fontSize: 11, color: C.creamLight, marginTop: 4, display: 'block', letterSpacing: '1px', opacity: 0.9 }}>{subtitle}</span>}
      </div>
      {right}
    </div>
  </div>
)

// ─── ExerciseIntel ─────────────────────────────────────────────────────────
const ExerciseIntel = ({ ex, color }) => {
  if (!ex) return null
  const stressItems = [
    { label: 'Lower Back', val: ex.lower_back_stress },
    { label: 'Shoulder', val: ex.shoulder_stress },
    { label: 'Knee', val: ex.knee_stress },
    { label: 'Wrist', val: ex.wrist_stress },
    { label: 'Neck', val: ex.neck_stress },
    { label: 'Elbow', val: ex.elbow_stress },
  ].filter(s => s.val)
  const stressColor = v => v === 1 ? '#8CA199' : v === 2 ? '#B8732A' : '#C0392B'
  return (
    <div style={{ background: `${color}10`, borderTop: `1px solid ${color}30`, padding: '10px 14px 12px' }}>
      <div style={{ fontFamily: MONO, fontSize: 8, color: color, textTransform: 'uppercase', letterSpacing: '2px', marginBottom: 6 }}>Exercise Intelligence</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
        {ex.movement_pattern && <span style={{ fontFamily: MONO, fontSize: 8, padding: '2px 7px', borderRadius: 99, background: color, color: '#FFF', textTransform: 'uppercase', letterSpacing: '1px' }}>{ex.movement_pattern}</span>}
        {(ex.primary_muscles || []).slice(0, 4).map(m => (
          <span key={m} style={{ fontFamily: MONO, fontSize: 8, padding: '2px 7px', borderRadius: 99, background: '#FFF', color: C.sageDark, border: `1px solid ${color}40` }}>{m.replace(/_/g, ' ')}</span>
        ))}
      </div>
      {stressItems.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
          {stressItems.map(s => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <span style={{ fontFamily: MONO, fontSize: 8, color: C.sageMid }}>{s.label}</span>
              <div style={{ display: 'flex', gap: 1.5 }}>
                {[1, 2, 3].map(i => (
                  <div key={i} style={{ width: 6, height: 6, borderRadius: 1, background: i <= s.val ? stressColor(s.val) : `${C.creamDark}50` }} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {(ex.contraindications || []).length > 0 && (
        <div style={{ marginTop: 8, padding: '6px 8px', background: '#C0392B15', borderRadius: 6, borderLeft: '2px solid #C0392B' }}>
          <span style={{ fontFamily: MONO, fontSize: 8, color: '#C0392B', textTransform: 'uppercase', letterSpacing: '1px', display: 'block' }}>Caution</span>
          <span style={{ fontFamily: MONO, fontSize: 9, color: C.sageDark }}>{(ex.contraindications || []).map(c => c.replace(/_/g, ' ')).join(' · ')}</span>
        </div>
      )}
    </div>
  )
}

const BottomNav = ({ tab, setTab }) => (
  <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: C.sage, display: 'flex', borderTop: `1px solid ${C.sageLight}60`, paddingBottom: 'env(safe-area-inset-bottom, 12px)', zIndex: 50 }}>
    {[
      { id: 'clients', label: 'Clients', icon: '◈' },
      { id: 'programs', label: 'Programs', icon: '◇' },
      { id: 'library', label: 'Library', icon: '⊞' },
      { id: 'progression', label: 'Progress', icon: '↗' },
      { id: 'revenue', label: 'Revenue', icon: '◎' },
    ].map(t => (
      <button key={t.id} onClick={() => setTab(t.id)} style={{ flex: 1, padding: '10px 0 6px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
        <span style={{ fontSize: 16, color: tab === t.id ? C.white : `${C.creamLight}70`, transition: 'color .2s' }}>{t.icon}</span>
        <Mono style={{ fontSize: 8, letterSpacing: '1.5px', textTransform: 'uppercase', color: tab === t.id ? C.white : `${C.creamLight}70`, transition: 'color .2s' }}>{t.label}</Mono>
      </button>
    ))}
  </div>
)

const Input = ({ label, value, onChange, placeholder, type = 'text' }) => (
  <div style={{ marginBottom: 12 }}>
    <Mono style={{ fontSize: 9, letterSpacing: '2px', color: C.sageMid, textTransform: 'uppercase', display: 'block', marginBottom: 5 }}>{label}</Mono>
    <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} type={type}
      style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: `1px solid ${C.creamDark}`, background: C.white, fontSize: 15, color: C.sageDark, fontFamily: SERIF, outline: 'none' }}
    />
  </div>
)

const Select = ({ label, value, onChange, options }) => (
  <div style={{ marginBottom: 12 }}>
    <Mono style={{ fontSize: 9, letterSpacing: '2px', color: C.sageMid, textTransform: 'uppercase', display: 'block', marginBottom: 5 }}>{label}</Mono>
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: `1px solid ${C.creamDark}`, background: C.white, fontSize: 14, color: C.sageDark, fontFamily: MONO, outline: 'none', appearance: 'none' }}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </div>
)

const Btn = ({ children, onClick, color = C.sage, text = C.white, small = false, outline = false }) => (
  <button onClick={onClick} style={{
    padding: small ? '8px 14px' : '14px 20px',
    background: outline ? 'transparent' : color,
    color: outline ? color : text,
    border: outline ? `1px solid ${color}` : 'none',
    borderRadius: 10, fontSize: small ? 11 : 13,
    fontFamily: MONO, letterSpacing: '1.5px', textTransform: 'uppercase',
    cursor: 'pointer', fontWeight: 500,
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

// ═══════════════════════════════════════════════════════════════════
// CLIENTS TAB
// ═══════════════════════════════════════════════════════════════════
function ClientsTab({ clients, setClients, setSelectedClient, setTab }) {
  const [filter, setFilter] = useState('all')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', package_size: '10', rate: '', location: '', stars: '0' })
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)

  const showToast = msg => { setToast(msg); setTimeout(() => setToast(null), 2500) }

  const shown = clients.filter(c => filter === 'all' ? true : filter === 'active' ? c.status === 'active' : c.status === 'completed')
  const nearEnd = clients.filter(c => c.status === 'active' && c.sessions_completed >= c.package_size - 2)

  const addClient = async () => {
    if (!form.name || !form.rate) return
    setSaving(true)
    const id = form.name.toLowerCase().replace(/\s+/g, '_') + '_' + Date.now()
    const newClient = {
      id, name: form.name, package_size: parseInt(form.package_size),
      rate: parseInt(form.rate), stars: parseInt(form.stars),
      current_package: 1, sessions_completed: 0,
      location: form.location, status: 'active',
      cancellations: 0, completed_packages: 0,
    }
    const { error } = await supabase.from('clients').insert([newClient])
    if (!error) {
      setClients(prev => [...prev, newClient])
      setShowAdd(false)
      setForm({ name: '', package_size: '10', rate: '', location: '', stars: '0' })
      showToast('Client added ✓')
    }
    setSaving(false)
  }

  return (
    <div style={{ minHeight: '100vh', background: C.creamLight, paddingBottom: 90 }}>
      <Header
        title="Clients"
        right={
          <button onClick={() => setShowAdd(true)} style={{ background: C.sage, border: 'none', borderRadius: 8, padding: '7px 14px', color: C.white, fontFamily: MONO, fontSize: 11, letterSpacing: '1px', cursor: 'pointer' }}>+ Add</button>
        }
      />

      <div style={{ background: C.sage, padding: '0 20px 14px' }}>
        {nearEnd.length > 0 && (
          <div style={{ background: C.cream, border: `1px solid ${C.amber}60`, borderRadius: 8, padding: '7px 12px', marginBottom: 10 }}>
            <Mono style={{ fontSize: 8, letterSpacing: '2px', color: C.amber, textTransform: 'uppercase', display: 'block' }}>Ending Soon</Mono>
            <span style={{ fontSize: 13, color: C.sageDark, fontFamily: SERIF, marginTop: 2, display: 'block' }}>{nearEnd.map(c => c.name).join('  ·  ')}</span>
          </div>
        )}
        <div style={{ display: 'flex', gap: 6 }}>
          {['all', 'active', 'completed'].map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding: '4px 12px', borderRadius: 99, border: '1px solid',
              borderColor: filter === f ? C.white : `${C.white}60`,
              background: filter === f ? C.white : 'transparent',
              color: filter === f ? C.sageDark : C.white,
              fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', fontFamily: MONO, cursor: 'pointer',
            }}>{f}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: '14px 16px' }}>
        {shown.map((c, i) => (
          <Card key={c.id} onClick={() => { setSelectedClient(c); setTab('client_detail') }}
            accent={c.status === 'active' ? C.sage : C.creamDark}
            style={{ animation: `fadeUp .3s ease ${i * .04}s both` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ fontSize: 19, color: C.sageDark, fontFamily: SERIF }}>{c.name}</span>
                  {c.stars > 0 && <span style={{ fontSize: 10, color: '#C9A84C' }}>{'★'.repeat(c.stars)}{'☆'.repeat(3 - c.stars)}</span>}
                </div>
                <Mono style={{ fontSize: 10, color: C.sageMid, marginTop: 2, display: 'block' }}>
                  Pkg {c.current_package}  ·  {c.package_size} sessions  ·  {fmt(c.rate)}
                </Mono>
              </div>
              <Badge status={c.status} />
            </div>
            <ProgressBar done={c.sessions_completed} total={c.package_size} />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
              <Mono style={{ fontSize: 10, color: C.sageMid }}>📍 {c.location}</Mono>
              {c.cancellations > 0 && <Mono style={{ fontSize: 10, color: C.amber }}>{c.cancellations} cancel{c.cancellations > 1 ? 's' : ''}</Mono>}
            </div>
          </Card>
        ))}
      </div>

      {/* Add Client Modal */}
      {showAdd && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 100, display: 'flex', alignItems: 'flex-end' }}>
          <div style={{ background: C.creamLight, borderRadius: '16px 16px 0 0', padding: '24px 20px 40px', width: '100%', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 22, color: C.sageDark }}>New Client</h2>
              <button onClick={() => setShowAdd(false)} style={{ background: 'none', border: 'none', fontSize: 20, color: C.sageMid, cursor: 'pointer' }}>✕</button>
            </div>
            <Input label="Name" value={form.name} onChange={v => setForm(p => ({ ...p, name: v }))} placeholder="Client name" />
            <Input label="Rate (AED per package)" value={form.rate} onChange={v => setForm(p => ({ ...p, rate: v }))} placeholder="e.g. 3200" type="number" />
            <Input label="Sessions per package" value={form.package_size} onChange={v => setForm(p => ({ ...p, package_size: v }))} placeholder="10" type="number" />
            <Input label="Location" value={form.location} onChange={v => setForm(p => ({ ...p, location: v }))} placeholder="e.g. JVC, Online" />
            <Select label="Stars (retention indicator)" value={form.stars} onChange={v => setForm(p => ({ ...p, stars: v }))}
              options={[{ value: '0', label: '☆☆☆ No rating' }, { value: '1', label: '★☆☆' }, { value: '2', label: '★★☆' }, { value: '3', label: '★★★' }]} />
            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <Btn onClick={() => setShowAdd(false)} color={C.sageMid} outline>Cancel</Btn>
              <Btn onClick={addClient} color={C.sage} style={{ flex: 1 }}>{saving ? 'Saving...' : 'Add Client'}</Btn>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast msg={toast} />}
      <style>{`@keyframes fadeUp { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }`}</style>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// CLIENT DETAIL TAB
// ═══════════════════════════════════════════════════════════════════
function ClientDetail({ client, clients, setClients, setTab, setSelectedClient }) {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [showLog, setShowLog] = useState(false)
  const [logForm, setLogForm] = useState({ date: today(), location: client.location || '', note: '', cancelled: false })
  const [toast, setToast] = useState(null)
  const [saving, setSaving] = useState(false)
  const [editSession, setEditSession] = useState(null) // session being edited
  const [editForm, setEditForm] = useState({ date: '', location: '', note: '', cancelled: false })
  const [confirmDelete, setConfirmDelete] = useState(null) // session id to delete

  const showToast = msg => { setToast(msg); setTimeout(() => setToast(null), 2500) }

  useEffect(() => {
    loadSessions()
  }, [client.id])

  const loadSessions = async () => {
    setLoading(true)
    const { data } = await supabase.from('sessions').select('*').eq('client_id', client.id).order('created_at', { ascending: true })
    setSessions(data || [])
    setLoading(false)
  }

  const deleteSession = async (session) => {
    const { error } = await supabase.from('sessions').delete().eq('id', session.id)
    if (!error) {
      // Update client counts
      const adj = session.cancelled ? 0 : -1
      const adjCancel = session.cancelled ? -1 : 0
      const updates = {
        sessions_completed: Math.max(0, client.sessions_completed + adj),
        cancellations: Math.max(0, client.cancellations + adjCancel),
      }
      await supabase.from('clients').update(updates).eq('id', client.id)
      const updatedClient = { ...client, ...updates, status: 'active' }
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
    const newSession = {
      client_id: client.id,
      date: logForm.date,
      location: logForm.cancelled ? '—' : logForm.location,
      note: logForm.cancelled ? `Cancelled${logForm.note ? ' — ' + logForm.note : ''}` : `Session #${logForm.cancelled ? client.sessions_completed : client.sessions_completed + 1}${logForm.note ? ' — ' + logForm.note : ''}`,
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
        status: (!logForm.cancelled && isDone) ? 'completed' : 'active',
      }
      await supabase.from('clients').update(updates).eq('id', client.id)
      const updatedClient = { ...client, ...updates }
      setClients(prev => prev.map(c => c.id === client.id ? updatedClient : c))
      setSelectedClient(updatedClient)
      await loadSessions()
      setShowLog(false)
      setLogForm({ date: today(), location: client.location || '', note: '', cancelled: false })
      showToast(logForm.cancelled ? 'Cancellation logged' : 'Session logged ✓')
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
    const rows = [['Client', 'Date', 'Package', 'Location', 'Note', 'Type']]
    sessions.forEach(s => rows.push([client.name, s.date, `Package ${s.pkg}`, s.location, s.note, s.cancelled ? 'Cancelled' : 'Session']))
    const csv = rows.map(r => r.map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `${client.name.toLowerCase()}-sessions.csv`
    a.click()
  }

  const isDone = client.sessions_completed >= client.package_size
  const near = client.sessions_completed >= client.package_size - 2
  const earned = client.completed_packages * client.rate
  const pkgs = [...new Set(sessions.map(s => s.pkg))].sort((a, b) => a - b)

  return (
    <div style={{ minHeight: '100vh', background: C.creamLight, paddingBottom: 100 }}>
      <Header title={client.name} subtitle={`${fmt(client.rate)} · ${client.package_size} sessions/pkg`} onBack={() => setTab('clients')} />

      {/* Package progress */}
      <div style={{ background: C.sage, padding: '0 20px 18px' }}>
        <div style={{ background: '#ffffff20', borderRadius: 10, padding: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <Mono style={{ fontSize: 9, letterSpacing: '2px', color: C.creamLight, textTransform: 'uppercase' }}>Package {client.current_package}</Mono>
            <Badge status={client.status} />
          </div>
          <ProgressBar done={client.sessions_completed} total={client.package_size} />
          {near && !isDone && <Mono style={{ marginTop: 8, fontSize: 11, color: C.amber, display: 'block' }}>⚡ {client.package_size - client.sessions_completed} session{client.package_size - client.sessions_completed > 1 ? 's' : ''} left — discuss renewal</Mono>}
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, padding: '12px 16px 0' }}>
        {[{ label: 'Pkgs Done', value: client.completed_packages }, { label: 'Cancels', value: client.cancellations }, { label: 'Earned', value: fmt(earned) }].map(s => (
          <Card key={s.label} style={{ padding: 10, textAlign: 'center', marginBottom: 0 }}>
            <Mono style={{ fontSize: 8, color: C.sageMid, letterSpacing: '1.5px', textTransform: 'uppercase', display: 'block' }}>{s.label}</Mono>
            <span style={{ fontSize: s.label === 'Earned' ? 11 : 20, color: C.sageDark, marginTop: 3, display: 'block', fontFamily: SERIF }}>{s.value}</span>
          </Card>
        ))}
      </div>

      {/* Health Profile */}
      <ClientHealthProfile client={client} />
      {/* Equipment Profile */}
      <ClientEquipmentProfile client={client} setClients={setClients} />

      {/* Quick nav buttons */}
      <div style={{ display: 'flex', gap: 8, padding: '10px 16px 0' }}>
        <button onClick={() => setTab('programs')} style={{ flex: 1, padding: '11px', background: C.white, border: `1px solid ${C.sage}50`, borderRadius: 10, cursor: 'pointer', textAlign: 'center' }}>
          <Mono style={{ fontSize: 9, color: C.sage, letterSpacing: '1.5px', textTransform: 'uppercase', display: 'block' }}>Programs</Mono>
          <span style={{ fontSize: 12, color: C.sageDark, fontFamily: SERIF }}>View / Create</span>
        </button>
        <button onClick={() => setTab('progression')} style={{ flex: 1, padding: '11px', background: C.white, border: `1px solid ${C.sage}50`, borderRadius: 10, cursor: 'pointer', textAlign: 'center' }}>
          <Mono style={{ fontSize: 9, color: C.sage, letterSpacing: '1.5px', textTransform: 'uppercase', display: 'block' }}>Progression</Mono>
          <span style={{ fontSize: 12, color: C.sageDark, fontFamily: SERIF }}>Track weights</span>
        </button>
      </div>

      {/* Session log */}
      <div style={{ padding: '12px 16px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <Mono style={{ fontSize: 9, letterSpacing: '2px', color: C.sageMid, textTransform: 'uppercase' }}>
            Session Log · {sessions.filter(s => !s.cancelled).length} sessions
          </Mono>
          <button onClick={exportCSV} style={{ background: 'none', border: `1px solid ${C.sageLight}`, borderRadius: 7, padding: '3px 10px', fontSize: 9, color: C.sageMid, fontFamily: MONO, cursor: 'pointer' }}>↓ CSV</button>
        </div>
        {loading ? <Spinner /> : pkgs.map(pkg => (
          <div key={pkg} style={{ marginBottom: 14 }}>
            <Mono style={{ fontSize: 9, letterSpacing: '2px', color: C.sage, textTransform: 'uppercase', display: 'block', marginBottom: 5, paddingLeft: 2 }}>— Package {pkg} —</Mono>
            {sessions.filter(s => s.pkg === pkg).map((s, i) => (
              <div key={s.id || i} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '9px 12px', background: C.white, borderRadius: 8, marginBottom: 5,
                opacity: s.cancelled ? 0.55 : 1,
                borderLeft: s.cancelled ? `2px solid ${C.amber}` : '2px solid transparent',
                boxShadow: '0 1px 3px rgba(0,0,0,.04)',
              }}>
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 13, color: C.sageDark, fontFamily: SERIF, display: 'block' }}>{s.note}</span>
                  <Mono style={{ fontSize: 10, color: C.sageMid }}>{s.date} · {s.location}</Mono>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button onClick={() => { setEditSession(s); setEditForm({ date: s.date, location: s.location || '', note: s.note, cancelled: s.cancelled }) }}
                    style={{ background: 'none', border: `1px solid ${C.sageLight}`, borderRadius: 6, padding: '3px 8px', fontSize: 10, color: C.sageMid, fontFamily: MONO, cursor: 'pointer' }}>
                    Edit
                  </button>
                  <button onClick={() => setConfirmDelete(s)}
                    style={{ background: 'none', border: `1px solid ${C.amber}40`, borderRadius: 6, padding: '3px 8px', fontSize: 10, color: C.amber, fontFamily: MONO, cursor: 'pointer' }}>
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Action bar */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, padding: '10px 16px 28px', background: C.creamLight, borderTop: `1px solid ${C.creamDark}50`, display: 'flex', gap: 8 }}>
        <button onClick={() => setShowLog(true)} style={{ flex: 1, padding: 14, background: C.sage, color: C.white, border: 'none', borderRadius: 10, fontSize: 13, fontFamily: MONO, letterSpacing: '1.5px', textTransform: 'uppercase', cursor: 'pointer' }}>
          + Log Session
        </button>
        {isDone && (
          <button onClick={startNewPackage} style={{ flex: 1, padding: 14, background: C.sageMid, color: C.cream, border: 'none', borderRadius: 10, fontSize: 12, fontFamily: MONO, letterSpacing: '1.5px', textTransform: 'uppercase', cursor: 'pointer' }}>
            New Pkg →
          </button>
        )}
      </div>

      {/* Log Session Modal */}
      {showLog && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 100, display: 'flex', alignItems: 'flex-end' }}>
          <div style={{ background: C.creamLight, borderRadius: '16px 16px 0 0', padding: '24px 20px 40px', width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 20, color: C.sageDark }}>Log — {client.name}</h2>
              <button onClick={() => setShowLog(false)} style={{ background: 'none', border: 'none', fontSize: 20, color: C.sageMid, cursor: 'pointer' }}>✕</button>
            </div>
            {/* Cancellation toggle */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: C.white, borderRadius: 10, padding: '14px 16px', marginBottom: 12 }}>
              <span style={{ fontSize: 15, color: C.sageDark, fontFamily: SERIF }}>Mark as Cancellation</span>
              <div onClick={() => setLogForm(f => ({ ...f, cancelled: !f.cancelled }))} style={{ width: 48, height: 26, borderRadius: 13, background: logForm.cancelled ? C.amber : C.creamDark, position: 'relative', cursor: 'pointer', transition: 'background .2s' }}>
                <div style={{ position: 'absolute', top: 3, left: logForm.cancelled ? 25 : 3, width: 20, height: 20, borderRadius: '50%', background: C.white, transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} />
              </div>
            </div>
            <Input label="Date" value={logForm.date} onChange={v => setLogForm(f => ({ ...f, date: v }))} placeholder="e.g. 14 May 2026" />
            {!logForm.cancelled && <Input label="Location" value={logForm.location} onChange={v => setLogForm(f => ({ ...f, location: v }))} placeholder="Online / JVC..." />}
            <Input label="Note (optional)" value={logForm.note} onChange={v => setLogForm(f => ({ ...f, note: v }))} placeholder={logForm.cancelled ? 'e.g. 3 hrs before, counted' : 'e.g. great energy today'} />
            <button onClick={logSession} disabled={saving} style={{ width: '100%', padding: 16, background: logForm.cancelled ? C.amber : C.sage, color: C.white, border: 'none', borderRadius: 12, fontSize: 13, fontFamily: MONO, letterSpacing: '2px', textTransform: 'uppercase', cursor: 'pointer', marginTop: 8 }}>
              {saving ? 'Saving...' : logForm.cancelled ? 'Log Cancellation' : 'Log Session'}
            </button>
          </div>
        </div>
      )}

      {/* Edit Session Modal */}
      {editSession && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 100, display: 'flex', alignItems: 'flex-end' }}>
          <div style={{ background: C.creamLight, borderRadius: '16px 16px 0 0', padding: '24px 20px 40px', width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 20, color: C.sageDark }}>Edit Session</h2>
              <button onClick={() => setEditSession(null)} style={{ background: 'none', border: 'none', fontSize: 20, color: C.sageMid, cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: C.white, borderRadius: 10, padding: '14px 16px', marginBottom: 12 }}>
              <span style={{ fontSize: 15, color: C.sageDark, fontFamily: SERIF }}>Cancellation</span>
              <div onClick={() => setEditForm(f => ({ ...f, cancelled: !f.cancelled }))} style={{ width: 48, height: 26, borderRadius: 13, background: editForm.cancelled ? C.amber : C.creamDark, position: 'relative', cursor: 'pointer', transition: 'background .2s' }}>
                <div style={{ position: 'absolute', top: 3, left: editForm.cancelled ? 25 : 3, width: 20, height: 20, borderRadius: '50%', background: C.white, transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} />
              </div>
            </div>
            <Input label="Date" value={editForm.date} onChange={v => setEditForm(f => ({ ...f, date: v }))} placeholder="e.g. 16 May 2026" />
            <Input label="Location" value={editForm.location} onChange={v => setEditForm(f => ({ ...f, location: v }))} placeholder="Online / JVC..." />
            <Input label="Note" value={editForm.note} onChange={v => setEditForm(f => ({ ...f, note: v }))} placeholder="Session note" />
            <button onClick={saveEdit} disabled={saving} style={{ width: '100%', padding: 16, background: C.sage, color: C.white, border: 'none', borderRadius: 12, fontSize: 13, fontFamily: MONO, letterSpacing: '2px', textTransform: 'uppercase', cursor: 'pointer', marginTop: 8 }}>
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}

      {/* Confirm Delete Modal */}
      {confirmDelete && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 20px' }}>
          <div style={{ background: C.creamLight, borderRadius: 16, padding: '24px 20px', width: '100%', maxWidth: 340 }}>
            <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 20, color: C.sageDark, marginBottom: 8 }}>Delete Session?</h2>
            <p style={{ fontFamily: MONO, fontSize: 12, color: C.sageMid, marginBottom: 6 }}>{confirmDelete.note}</p>
            <p style={{ fontFamily: MONO, fontSize: 11, color: C.sageMid, marginBottom: 20 }}>{confirmDelete.date} · {confirmDelete.location}</p>
            <p style={{ fontFamily: MONO, fontSize: 11, color: C.amber, marginBottom: 20 }}>This cannot be undone.</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setConfirmDelete(null)} style={{ flex: 1, padding: 14, background: 'none', border: `1px solid ${C.creamDark}`, borderRadius: 10, fontSize: 13, fontFamily: MONO, color: C.sageMid, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={() => deleteSession(confirmDelete)} style={{ flex: 1, padding: 14, background: C.amber, border: 'none', borderRadius: 10, fontSize: 13, fontFamily: MONO, color: C.white, cursor: 'pointer' }}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast msg={toast} />}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// PROGRAMS TAB
// ═══════════════════════════════════════════════════════════════════
function ProgramsTab({ clients, selectedClient, setSelectedClient }) {
  const [programs, setPrograms] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('list') // list | program | new_program | new_day | run_day
  const [activeProgram, setActiveProgram] = useState(null)
  const [activeDay, setActiveDay] = useState(null)
  const [activeDayIndex, setActiveDayIndex] = useState(0)
  const [toast, setToast] = useState(null)
  const [newProgForm, setNewProgForm] = useState({ title: '', client_id: '' })
  const [newDayForm, setNewDayForm] = useState({ name: '', theme: '' })
  const [newBlockForm, setNewBlockForm] = useState({ exercise_name: '', sets: '', reps: '', weight: '', focus: '', block_type: 'single', notes: '' })
  const [programDays, setProgramDays] = useState([])
  const [dayBlocks, setDayBlocks] = useState([])
  const [showAddBlock, setShowAddBlock] = useState(false)
  const [showAddDay, setShowAddDay] = useState(false)
  const [saving, setSaving] = useState(false)
  const [runLogs, setRunLogs] = useState({}) // blockId -> { actual_weight, actual_reps, notes }
  // Groups (supersets/trisets) — default OPEN. collapsedGroups = explicitly closed keys
  const [collapsedGroups, setCollapsedGroups] = useState(new Set())
  const [expandedBlocks, setExpandedBlocks] = useState(new Set())
  const [exerciseLib, setExerciseLib] = useState({})
  const toggleGroup = key => setCollapsedGroups(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
  const toggleBlockExpand = id => setExpandedBlocks(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  // Reset collapsed state when changing day
  useEffect(() => { setCollapsedGroups(new Set()); setExpandedBlocks(new Set()) }, [activeDay?.id])
  const [clientFilter2, setClientFilter2] = useState('')
  const [confirmDeleteProgram, setConfirmDeleteProgram] = useState(null)
  // Track which clients are EXPLICITLY collapsed (default: all collapsed)
  const [collapsedClients, setCollapsedClients] = useState('default-all-collapsed')
  const isClientOpen = (name) => collapsedClients !== 'default-all-collapsed' && !collapsedClients.has(name)
  const toggleClient = (name) => {
    setCollapsedClients(prev => {
      if (prev === 'default-all-collapsed') {
        // First click: open this one, keep others closed
        const all = new Set(Object.keys(grouped))
        all.delete(name)
        return all
      }
      const next = new Set(prev)
      if (next.has(name)) next.delete(name); else next.add(name)
      return next
    })
  }

  const showToast = msg => { setToast(msg); setTimeout(() => setToast(null), 2500) }

  const clientForProgram = activeProgram ? clients.find(c => c.id === activeProgram.client_id) : null

  useEffect(() => {
    loadPrograms()
  }, [selectedClient])

  const loadPrograms = async () => {
    setLoading(true)
    let query = supabase.from('programs').select('*').order('created_at', { ascending: false })
    if (selectedClient) query = query.eq('client_id', selectedClient.id)
    const { data } = await query
    setPrograms(data || [])
    setLoading(false)
  }

  // Load exercise library lookup once
  useEffect(() => {
    supabase.from('exercises').select('name, primary_muscles, secondary_muscles, movement_pattern, equipment, lower_back_stress, shoulder_stress, knee_stress, wrist_stress, neck_stress, elbow_stress, spinal_load, contraindications, best_used_for').then(({ data }) => {
      const lib = {}
      ;(data || []).forEach(e => { lib[e.name.toLowerCase()] = e })
      setExerciseLib(lib)
    })
  }, [])

  // Smart fuzzy matcher — handles abbreviations, plurals, variations
  const normalize = (s) => {
    if (!s) return ''
    return s.toLowerCase()
      .replace(/\(.*?\)/g, '')                    // remove parentheses
      .replace(/\bsa\b/g, 'single arm')           // SA → single arm
      .replace(/\bsl\b/g, 'single leg')           // SL → single leg
      .replace(/\bkb\b/g, 'kettlebell')          // KB → kettlebell
      .replace(/\bdb\b/g, 'dumbbell')            // DB → dumbbell
      .replace(/\bbb\b/g, 'barbell')             // BB → barbell
      .replace(/\bohp\b/g, 'overhead press')     // OHP
      .replace(/\brdl\b/g, 'romanian deadlift')  // RDL
      .replace(/\bgm\b/g, 'good morning')        // GM
      .replace(/\brfess\b/g, 'rear foot elevated split squat')
      .replace(/\bbench press\b/g, 'bench press')
      .replace(/\s+→.+$/, '')                    // remove → variations  
      .replace(/\s+to\s+.+$/, '')                // remove "to X"
      .replace(/\s+with\s+.+$/, '')              // remove "with X"
      .replace(/[-—/]/g, ' ')                     // dashes
      .replace(/[+&]/g, ' ')                       // pluses
      .replace(/[.,!?'"]/g, '')                    // punctuation
      .replace(/\bs\b/g, '')                     // bare plural s
      .replace(/(\w+)s\b/g, '$1')                // trailing s on words
      .replace(/\s+/g, ' ')                       // collapse whitespace
      .trim()
  }

  // Build normalized lookup once exerciseLib is loaded
  const normalizedLib = (() => {
    const m = {}
    Object.entries(exerciseLib).forEach(([k, v]) => {
      m[normalize(k)] = v
      // Also index by aliases if present
      ;(v.aliases || []).forEach(a => { m[normalize(a)] = v })
    })
    return m
  })()

  const findEx = (name) => {
    if (!name || Object.keys(exerciseLib).length === 0) return null
    const exact = exerciseLib[name.toLowerCase().trim()]
    if (exact) return exact
    const norm = normalize(name)
    if (normalizedLib[norm]) return normalizedLib[norm]
    // Try removing common prefixes
    const noPrefix = norm.replace(/^(banded|cable|machine|smith)\s+/, '')
    if (normalizedLib[noPrefix]) return normalizedLib[noPrefix]
    // Try with prefix removed but base word retained — best partial match
    const keys = Object.keys(normalizedLib)
    // 1. Exact word-boundary match (norm fully contained in key or vice versa)
    let best = keys.find(k => k === norm)
    if (best) return normalizedLib[best]
    // 2. Norm contained in library key
    best = keys.find(k => k.includes(norm) && Math.abs(k.length - norm.length) < 15)
    if (best) return normalizedLib[best]
    // 3. Library key contained in norm
    best = keys.find(k => norm.includes(k) && k.length >= 4)
    if (best) return normalizedLib[best]
    return null
  }

  // Compute risk flags for a day based on all blocks
  const dayRiskFlags = (blocks) => {
    const flags = []
    let lbHigh = 0, shHigh = 0, kneeHigh = 0
    const patterns = {}
    blocks.forEach(b => {
      const ex = findEx(b.exercise_name)
      if (!ex) return
      if (ex.lower_back_stress === 3) lbHigh++
      if (ex.shoulder_stress === 3) shHigh++
      if (ex.knee_stress === 3) kneeHigh++
      if (ex.movement_pattern) patterns[ex.movement_pattern] = (patterns[ex.movement_pattern] || 0) + 1
    })
    if (lbHigh >= 2) flags.push({ level: 'warning', text: `${lbHigh} exercises with high lower back load — consider redistribution` })
    if (shHigh >= 2) flags.push({ level: 'warning', text: `${shHigh} exercises with high shoulder stress in same session` })
    if (kneeHigh >= 2) flags.push({ level: 'warning', text: `${kneeHigh} exercises with high knee stress — monitor closely` })
    Object.entries(patterns).forEach(([p, count]) => {
      if (count >= 4) flags.push({ level: 'info', text: `${count} ${p} exercises — high movement redundancy` })
    })
    return flags
  }

  const loadProgramDays = async (programId) => {
    const { data } = await supabase.from('program_days').select('*').eq('program_id', programId).order('day_order', { ascending: true })
    setProgramDays(data || [])
    if (data && data.length > 0) {
      setActiveDay(data[0])
      setActiveDayIndex(0)
      const { data: blocks } = await supabase.from('exercise_blocks').select('*').eq('day_id', data[0].id).order('block_order', { ascending: true })
      setDayBlocks(blocks || [])
    }
  }

  const loadDayBlocks = async (dayId) => {
    const { data } = await supabase.from('exercise_blocks').select('*').eq('day_id', dayId).order('block_order', { ascending: true })
    setDayBlocks(data || [])
  }

  const createProgram = async () => {
    if (!newProgForm.title || !newProgForm.client_id) return
    setSaving(true)
    // Archive current active program for this client
    await supabase.from('programs').update({ is_active: false }).eq('client_id', newProgForm.client_id).eq('is_active', true)
    const { data, error } = await supabase.from('programs').insert([{
      client_id: newProgForm.client_id,
      title: newProgForm.title,
      is_active: true,
    }]).select()
    if (!error && data) {
      setPrograms(prev => [data[0], ...prev])
      setActiveProgram(data[0])
      setProgramDays([])
      setView('program')
      setNewProgForm({ title: '', client_id: '' })
      showToast('Program created ✓')
    }
    setSaving(false)
  }

  const addDay = async () => {
    if (!newDayForm.name) return
    setSaving(true)
    const { data, error } = await supabase.from('program_days').insert([{
      program_id: activeProgram.id,
      name: newDayForm.name,
      theme: newDayForm.theme,
      day_order: programDays.length + 1,
    }]).select()
    if (!error && data) {
      setProgramDays(prev => [...prev, data[0]])
      setNewDayForm({ name: '', theme: '' })
      setShowAddDay(false)
      showToast('Day added ✓')
    }
    setSaving(false)
  }

  const addBlock = async () => {
    if (!newBlockForm.exercise_name) return
    setSaving(true)
    const { data, error } = await supabase.from('exercise_blocks').insert([{
      day_id: activeDay.id,
      exercise_name: newBlockForm.exercise_name,
      sets: newBlockForm.sets,
      reps: newBlockForm.reps,
      weight: newBlockForm.weight,
      focus: newBlockForm.focus,
      block_type: newBlockForm.block_type,
      notes: newBlockForm.notes,
      block_order: dayBlocks.length + 1,
    }]).select()
    if (!error && data) {
      setDayBlocks(prev => [...prev, data[0]])
      setNewBlockForm({ exercise_name: '', sets: '', reps: '', weight: '', focus: '', block_type: 'single', notes: '' })
      setShowAddBlock(false)
      showToast('Exercise added ✓')
    }
    setSaving(false)
  }

  const runSession = async () => {
    // Save actual weights/reps as exercise logs
    setSaving(true)
    const logs = Object.entries(runLogs).map(([blockId, log]) => {
      const block = dayBlocks.find(b => b.id === blockId)
      return {
        client_id: activeProgram.client_id,
        exercise_name: block?.exercise_name || '',
        date: today(),
        sets: log.actual_sets || block?.sets || '',
        reps: log.actual_reps || block?.reps || '',
        weight: log.actual_weight || block?.weight || '',
        notes: log.notes || '',
        program_id: activeProgram.id,
        day_id: activeDay.id,
      }
    })
    if (logs.length > 0) {
      await supabase.from('exercise_logs').insert(logs)
    }
    setRunLogs({})
    showToast('Session logged to progression ✓')
    setSaving(false)
    setView('program')
  }

  // ── VIEWS ──────────────────────────────────────────────────────

  if (view === 'new_program') {
    return (
      <div style={{ minHeight: '100vh', background: C.creamLight, paddingBottom: 90 }}>
        <Header title="New Program" onBack={() => setView('list')} />
        <div style={{ padding: '20px 16px' }}>
          <Select label="Client" value={newProgForm.client_id} onChange={v => setNewProgForm(p => ({ ...p, client_id: v }))}
            options={[{ value: '', label: 'Select client...' }, ...clients.map(c => ({ value: c.id, label: c.name }))]} />
          <Input label="Program Title" value={newProgForm.title} onChange={v => setNewProgForm(p => ({ ...p, title: v }))} placeholder="e.g. Dora — May 2026" />
          <Btn onClick={createProgram} color={C.sage} style={{ width: '100%', marginTop: 8 }}>{saving ? 'Creating...' : 'Create Program'}</Btn>
          <p style={{ fontSize: 12, color: C.sageMid, fontFamily: MONO, marginTop: 12, lineHeight: 1.5 }}>
            Creating a new program will automatically archive the current active program for this client. Old programs are never deleted.
          </p>
        </div>
        {toast && <Toast msg={toast} />}
        <BottomNav tab="programs" setTab={() => setView('list')} />
      </div>
    )
  }

  if (view === 'program' && activeProgram) {
    const client = clients.find(c => c.id === activeProgram.client_id)
    return (
      <div style={{ minHeight: '100vh', background: C.creamLight, paddingBottom: 90 }}>
        <Header
          title={activeProgram.title}
          subtitle={`${client?.name || ''} · ${activeProgram.is_active ? 'Active' : 'Archived'}`}
          onBack={() => { setView('list'); loadPrograms() }}
        />
        {/* Day tabs */}
        {programDays.length > 0 && (
          <div style={{ background: C.sage, padding: '0 16px 14px', display: 'flex', gap: 6, overflowX: 'auto' }}>
            {programDays.map((d, i) => (
              <button key={d.id} onClick={() => { setActiveDayIndex(i); setActiveDay(d); loadDayBlocks(d.id) }} style={{
                padding: '6px 14px', borderRadius: 99, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                background: activeDayIndex === i ? C.sage : `${C.cream}20`,
                color: activeDayIndex === i ? C.white : `${C.cream}70`,
                fontSize: 10, fontFamily: MONO, letterSpacing: '1px', textTransform: 'uppercase',
              }}>{d.name}</button>
            ))}
          </div>
        )}
        <div style={{ padding: '14px 16px' }}>
          {/* Add day button */}
          {activeProgram.is_active && (
            <button onClick={() => setShowAddDay(true)} style={{ width: '100%', padding: '11px', background: `${C.sage}15`, border: `1px dashed ${C.sage}60`, borderRadius: 10, color: C.sage, fontFamily: MONO, fontSize: 11, letterSpacing: '1px', cursor: 'pointer', marginBottom: 12 }}>
              + Add Training Day
            </button>
          )}

          {activeDay && (
            <>
              <Card style={{ borderLeft: `3px solid ${C.sage}`, marginBottom: 10 }}>
                <Mono style={{ fontSize: 10, color: C.sage, textTransform: 'uppercase', letterSpacing: '2px', display: 'block', marginBottom: 3 }}>{activeDay.name}</Mono>
                <span style={{ fontSize: 16, color: C.sageDark, fontFamily: SERIF }}>{activeDay.theme}</span>
              </Card>

              {/* Risk Flags */}
              {(() => {
                const flags = dayRiskFlags(dayBlocks)
                if (flags.length === 0) return null
                return (
                  <div style={{ marginBottom: 12 }}>
                    <Mono style={{ fontSize: 9, color: C.amber, textTransform: 'uppercase', letterSpacing: '2px', display: 'block', marginBottom: 6 }}>⚠ Coach AI — Day Analysis</Mono>
                    {flags.map((f, i) => (
                      <div key={i} style={{ background: f.level === 'warning' ? `${C.amber}15` : `${C.sage}15`, border: `1px solid ${f.level === 'warning' ? C.amber : C.sage}40`, borderRadius: 8, padding: '8px 10px', marginBottom: 5, display: 'flex', gap: 8 }}>
                        <span style={{ fontSize: 12, color: f.level === 'warning' ? C.amber : C.sage }}>{f.level === 'warning' ? '⚠' : 'ⓘ'}</span>
                        <span style={{ fontFamily: MONO, fontSize: 10, color: C.sageDark, lineHeight: 1.4 }}>{f.text}</span>
                      </div>
                    ))}
                  </div>
                )
              })()}

              {(() => {
                // Group consecutive blocks that share the same block_type (non-single) and letter prefix
                const groups = []
                let i = 0
                while (i < dayBlocks.length) {
                  const b = dayBlocks[i]
                  const note = b.notes || ''
                  const letterMatch = note.match(/^([A-Z])\d/)
                  const letter = letterMatch ? letterMatch[1] : null
                  if (b.block_type !== 'single' && letter) {
                    // Collect all blocks with same letter prefix
                    const group = [b]
                    let j = i + 1
                    while (j < dayBlocks.length) {
                      const nb = dayBlocks[j]
                      const nm = (nb.notes || '').match(/^([A-Z])\d/)
                      if (nm && nm[1] === letter && nb.block_type === b.block_type) {
                        group.push(nb)
                        j++
                      } else break
                    }
                    groups.push({ type: 'group', blocks: group, blockType: b.block_type, letter })
                    i = j
                  } else {
                    groups.push({ type: 'single', block: b })
                    i++
                  }
                }

                const blockTypeColor = { superset: '#7BA7A0', triset: C.sage, complex: C.amber }
                const blockTypeBg = { superset: '#7BA7A020', triset: `${C.sage}15`, complex: `${C.amber}15` }

                return groups.map((g, gi) => {
                  if (g.type === 'single') {
                    const b = g.block
                    const ex = findEx(b.exercise_name)
                    const isExpanded = expandedBlocks.has(b.id)
                    return (
                      <div key={b.id} style={{ background: C.white, borderRadius: 10, marginBottom: 10, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,.05)' }}>
                        <div onClick={() => ex && toggleBlockExpand(b.id)} style={{ padding: '12px 14px', cursor: ex ? 'pointer' : 'default' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6, gap: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                              {ex && <Chevron open={isExpanded} size={10} color={C.sage} />}
                              <span style={{ fontSize: 14, color: C.sageDark, fontFamily: SERIF }}>{b.exercise_name}</span>
                            </div>
                            <Mono style={{ fontSize: 9, background: `${C.sage}20`, padding: '2px 8px', borderRadius: 99, color: C.sageDark, textTransform: 'uppercase', letterSpacing: '1px' }}>single</Mono>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                            {[{ l: 'Sets', v: b.sets }, { l: 'Reps', v: b.reps }, { l: 'Weight', v: b.weight }].map(x => (
                              <div key={x.l}>
                                <Mono style={{ fontSize: 8, color: C.sageMid, textTransform: 'uppercase', letterSpacing: '1.5px', display: 'block' }}>{x.l}</Mono>
                                <span style={{ fontSize: 13, color: C.sageDark, fontFamily: SERIF }}>{x.v || '—'}</span>
                              </div>
                            ))}
                          </div>
                          {b.focus && <Mono style={{ fontSize: 10, color: C.sage, marginTop: 6, display: 'block' }}>Focus: {b.focus}</Mono>}
                          {b.notes && <Mono style={{ fontSize: 10, color: C.sageMid, marginTop: 3, display: 'block' }}>{b.notes}</Mono>}
                        </div>
                        {isExpanded && ex && <ExerciseIntel ex={ex} color={C.sage} />}
                      </div>
                    )
                  }

                  // Grouped block (superset / triset / complex)
                  const color = blockTypeColor[g.blockType] || C.sage
                  const groupKey = `group-${gi}`
                  const groupOpen = !collapsedGroups.has(groupKey)
                  return (
                    <div key={gi} style={{ marginBottom: 10, borderRadius: 12, overflow: 'hidden', border: `2px solid ${color}40` }}>
                      {/* Group header - clickable */}
                      <div onClick={() => toggleGroup(groupKey)} style={{ background: color, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                        <Chevron open={groupOpen} size={12} color={C.white} />
                        <span style={{ fontFamily: IMPACT, fontSize: 13, color: C.white, letterSpacing: '2px', textTransform: 'uppercase' }}>{g.blockType.toUpperCase()}</span>
                        <span style={{ fontFamily: MONO, fontSize: 9, color: `${C.white}90`, letterSpacing: '2px' }}>Block {g.letter} · {g.blocks.length} ex</span>
                      </div>
                      {/* Exercises */}
                      {groupOpen && g.blocks.map((b, bi) => {
                        const ex = findEx(b.exercise_name)
                        const isExpanded = expandedBlocks.has(b.id)
                        return (
                        <div key={b.id} style={{
                          background: bi % 2 === 0 ? C.white : `${color}08`,
                          borderTop: bi > 0 ? `1px dashed ${color}30` : 'none',
                        }}>
                          <div onClick={() => ex && toggleBlockExpand(b.id)} style={{ padding: '12px 14px', cursor: ex ? 'pointer' : 'default' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                                {ex && <Chevron open={isExpanded} size={10} color={color} />}
                                <span style={{ fontSize: 14, color: C.sageDark, fontFamily: SERIF }}>{b.exercise_name}</span>
                              </div>
                              <Mono style={{ fontSize: 9, color: color, letterSpacing: '1px' }}>{b.notes?.split(' - ')[0] || ''}</Mono>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                              {[{ l: 'Sets', v: b.sets }, { l: 'Reps', v: b.reps }, { l: 'Weight', v: b.weight }].map(x => (
                                <div key={x.l}>
                                  <Mono style={{ fontSize: 8, color: C.sageMid, textTransform: 'uppercase', letterSpacing: '1.5px', display: 'block' }}>{x.l}</Mono>
                                  <span style={{ fontSize: 13, color: C.sageDark, fontFamily: SERIF }}>{x.v || '—'}</span>
                                </div>
                              ))}
                            </div>
                            {b.focus && <Mono style={{ fontSize: 10, color: color, marginTop: 6, display: 'block' }}>Focus: {b.focus}</Mono>}
                            {b.notes && b.notes.includes(' - ') && <Mono style={{ fontSize: 10, color: C.sageMid, marginTop: 2, display: 'block' }}>{b.notes.split(' - ').slice(1).join(' - ')}</Mono>}
                          </div>
                          {/* Exercise Intelligence - shown when expanded */}
                          {isExpanded && ex && <ExerciseIntel ex={ex} color={color} />}
                        </div>
                      )})}
                    </div>
                  )
                })
              })()}

              {activeProgram.is_active && (
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <button onClick={() => setShowAddBlock(true)} style={{ flex: 1, padding: '11px', background: `${C.sage}15`, border: `1px dashed ${C.sage}60`, borderRadius: 10, color: C.sage, fontFamily: MONO, fontSize: 11, letterSpacing: '1px', cursor: 'pointer' }}>
                    + Add Exercise
                  </button>
                  <button onClick={() => { setView('run_day') }} style={{ flex: 1, padding: '11px', background: C.sage, border: 'none', borderRadius: 10, color: C.white, fontFamily: MONO, fontSize: 11, letterSpacing: '1px', cursor: 'pointer' }}>
                    ▶ Run Session
                  </button>
                </div>
              )}
            </>
          )}

          {!activeDay && programDays.length > 0 && (
            <p style={{ textAlign: 'center', color: C.sageMid, fontFamily: MONO, fontSize: 12, padding: 20 }}>Select a day above</p>
          )}
          {programDays.length === 0 && !loading && (
            <p style={{ textAlign: 'center', color: C.sageMid, fontFamily: MONO, fontSize: 12, padding: 20 }}>No days yet — add a training day to get started</p>
          )}
        </div>

        {/* Add Day Modal */}
        {showAddDay && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 100, display: 'flex', alignItems: 'flex-end' }}>
            <div style={{ background: C.creamLight, borderRadius: '16px 16px 0 0', padding: '24px 20px 40px', width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
                <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 20, color: C.sageDark }}>Add Training Day</h2>
                <button onClick={() => setShowAddDay(false)} style={{ background: 'none', border: 'none', fontSize: 20, color: C.sageMid, cursor: 'pointer' }}>✕</button>
              </div>
              <Input label="Day Name" value={newDayForm.name} onChange={v => setNewDayForm(p => ({ ...p, name: v }))} placeholder="e.g. DAY 1" />
              <Input label="Theme / Focus" value={newDayForm.theme} onChange={v => setNewDayForm(p => ({ ...p, theme: v }))} placeholder="e.g. Full Body — Posterior Bias" />
              <Btn onClick={addDay} color={C.sage} style={{ width: '100%', marginTop: 8 }}>{saving ? 'Adding...' : 'Add Day'}</Btn>
            </div>
          </div>
        )}

        {/* Add Block Modal */}
        {showAddBlock && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 100, display: 'flex', alignItems: 'flex-end' }}>
            <div style={{ background: C.creamLight, borderRadius: '16px 16px 0 0', padding: '24px 20px 40px', width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
                <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 20, color: C.sageDark }}>Add Exercise</h2>
                <button onClick={() => setShowAddBlock(false)} style={{ background: 'none', border: 'none', fontSize: 20, color: C.sageMid, cursor: 'pointer' }}>✕</button>
              </div>
              <Input label="Exercise Name" value={newBlockForm.exercise_name} onChange={v => setNewBlockForm(p => ({ ...p, exercise_name: v }))} placeholder="e.g. Back Squat" />
              <Select label="Block Type" value={newBlockForm.block_type} onChange={v => setNewBlockForm(p => ({ ...p, block_type: v }))}
                options={[{ value: 'single', label: 'Single' }, { value: 'superset', label: 'Superset' }, { value: 'triset', label: 'Triset' }, { value: 'complex', label: 'Complex' }]} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                <Input label="Sets" value={newBlockForm.sets} onChange={v => setNewBlockForm(p => ({ ...p, sets: v }))} placeholder="3" />
                <Input label="Reps" value={newBlockForm.reps} onChange={v => setNewBlockForm(p => ({ ...p, reps: v }))} placeholder="10–12" />
                <Input label="Weight" value={newBlockForm.weight} onChange={v => setNewBlockForm(p => ({ ...p, weight: v }))} placeholder="20KG" />
              </div>
              <Input label="Focus Area" value={newBlockForm.focus} onChange={v => setNewBlockForm(p => ({ ...p, focus: v }))} placeholder="e.g. Glutes + Quads" />
              <Input label="Notes" value={newBlockForm.notes} onChange={v => setNewBlockForm(p => ({ ...p, notes: v }))} placeholder="e.g. Controlled tempo, RPE 8" />
              <Btn onClick={addBlock} color={C.sage} style={{ width: '100%', marginTop: 8 }}>{saving ? 'Adding...' : 'Add Exercise'}</Btn>
            </div>
          </div>
        )}

        {toast && <Toast msg={toast} />}
        <BottomNav tab="programs" setTab={() => { setView('list'); loadPrograms() }} />
      </div>
    )
  }

  // Run Day view
  if (view === 'run_day' && activeDay) {
    return (
      <div style={{ minHeight: '100vh', background: C.creamLight, paddingBottom: 90 }}>
        <Header title={`Run — ${activeDay.name}`} subtitle={activeDay.theme} onBack={() => setView('program')} />
        <div style={{ padding: '14px 16px' }}>
          <p style={{ fontFamily: MONO, fontSize: 11, color: C.sageMid, marginBottom: 14, lineHeight: 1.6 }}>
            Log actual weights and reps for today. These auto-save to each exercise's progression history.
          </p>
          {dayBlocks.map(b => (
            <Card key={b.id} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 15, color: C.sageDark, fontFamily: SERIF }}>{b.exercise_name}</span>
                <Mono style={{ fontSize: 9, color: C.sageMid }}>Target: {b.sets}×{b.reps} @ {b.weight || '—'}</Mono>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                {[{ l: 'Sets done', k: 'actual_sets', ph: b.sets }, { l: 'Reps done', k: 'actual_reps', ph: b.reps }, { l: 'Weight used', k: 'actual_weight', ph: b.weight }].map(f => (
                  <div key={f.k}>
                    <Mono style={{ fontSize: 8, color: C.sageMid, textTransform: 'uppercase', letterSpacing: '1px', display: 'block', marginBottom: 4 }}>{f.l}</Mono>
                    <input value={runLogs[b.id]?.[f.k] || ''} onChange={e => setRunLogs(p => ({ ...p, [b.id]: { ...p[b.id], [f.k]: e.target.value } }))}
                      placeholder={f.ph || '—'} style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.creamDark}`, background: C.white, fontSize: 13, color: C.sageDark, fontFamily: MONO, outline: 'none' }} />
                  </div>
                ))}
              </div>
              <input value={runLogs[b.id]?.notes || ''} onChange={e => setRunLogs(p => ({ ...p, [b.id]: { ...p[b.id], notes: e.target.value } }))}
                placeholder="Notes..." style={{ width: '100%', marginTop: 8, padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.creamDark}`, background: C.white, fontSize: 12, color: C.sageDark, fontFamily: MONO, outline: 'none' }} />
            </Card>
          ))}
          <button onClick={runSession} disabled={saving} style={{ width: '100%', padding: 16, background: C.sage, color: C.white, border: 'none', borderRadius: 12, fontSize: 13, fontFamily: MONO, letterSpacing: '2px', textTransform: 'uppercase', cursor: 'pointer', marginTop: 4 }}>
            {saving ? 'Saving...' : 'Save Session to Progression'}
          </button>
        </div>
        {toast && <Toast msg={toast} />}
        <BottomNav tab="programs" setTab={() => setView('list')} />
      </div>
    )
  }

  // Programs list
  const deleteProgram = async (p) => {
    await supabase.from('programs').delete().eq('id', p.id)
    setPrograms(prev => prev.filter(x => x.id !== p.id))
    setConfirmDeleteProgram(null)
    showToast('Program deleted')
  }

  const filteredPrograms = clientFilter2 ? programs.filter(p => p.client_id === clientFilter2) : programs

  // Group by client
  const grouped = {}
  filteredPrograms.forEach(p => {
    const cName = clients.find(cl => cl.id === p.client_id)?.name || 'Unknown'
    if (!grouped[cName]) grouped[cName] = []
    grouped[cName].push(p)
  })

  return (
    <div style={{ minHeight: '100vh', background: C.creamLight, paddingBottom: 90 }}>
      <Header title="Programs" right={
        <button onClick={() => setView('new_program')} style={{ background: C.white, border: 'none', borderRadius: 8, padding: '6px 13px', color: C.sage, fontFamily: MONO, fontSize: 10, letterSpacing: '1px', cursor: 'pointer' }}>+ New</button>
      } />

      {/* Client filter pills */}
      <div style={{ background: C.sage, padding: '0 16px 12px', display: 'flex', gap: 6, overflowX: 'auto' }}>
        <button onClick={() => setClientFilter2('')} style={{
          padding: '4px 12px', borderRadius: 99, border: '1px solid', whiteSpace: 'nowrap',
          borderColor: clientFilter2 === '' ? C.white : `${C.white}50`,
          background: clientFilter2 === '' ? C.white : 'transparent',
          color: clientFilter2 === '' ? C.sageDark : C.white,
          fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', fontFamily: MONO, cursor: 'pointer',
        }}>All</button>
        {clients.map(c => (
          <button key={c.id} onClick={() => setClientFilter2(c.id)} style={{
            padding: '4px 12px', borderRadius: 99, border: '1px solid', whiteSpace: 'nowrap',
            borderColor: clientFilter2 === c.id ? C.white : `${C.white}50`,
            background: clientFilter2 === c.id ? C.white : 'transparent',
            color: clientFilter2 === c.id ? C.sageDark : C.white,
            fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', fontFamily: MONO, cursor: 'pointer',
          }}>{c.name}</button>
        ))}
      </div>

      <div style={{ padding: '14px 16px' }}>
        {loading ? <Spinner /> : filteredPrograms.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <p style={{ fontFamily: MONO, color: C.sageMid, fontSize: 12 }}>No programs yet.</p>
          </div>
        ) : Object.entries(grouped).map(([clientName, progs]) => {
          const isOpen = isClientOpen(clientName) || clientFilter2 !== ''
          const activeCount = progs.filter(p => p.is_active).length
          return (
          <div key={clientName} style={{ marginBottom: 14 }}>
            {/* Client section header - now clickable to expand */}
            <div onClick={() => toggleClient(clientName)} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: isOpen ? 8 : 0, padding: '10px 12px', background: C.white, borderRadius: 10, cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,.04)', borderLeft: `3px solid ${activeCount > 0 ? C.sage : C.creamDark}` }}>
              <Chevron open={isOpen} size={14} color={C.sage} />
              <span style={{ fontFamily: IMPACT, fontSize: 14, letterSpacing: '2px', color: C.sageDark, textTransform: 'uppercase', flex: 1 }}>{clientName}</span>
              {activeCount > 0 && <Mono style={{ fontSize: 8, padding: '2px 7px', borderRadius: 99, background: `${C.sage}20`, color: C.sage, textTransform: 'uppercase', letterSpacing: '1.5px' }}>{activeCount} active</Mono>}
              <Mono style={{ fontSize: 9, color: C.sageMid }}>{progs.length} prog{progs.length !== 1 ? 's' : ''}</Mono>
            </div>
            {isOpen && progs.map(p => (
              <div key={p.id} style={{
                background: C.white, borderRadius: 10, marginBottom: 7,
                borderLeft: `3px solid ${p.is_active ? C.sage : C.creamDark}`,
                boxShadow: '0 1px 4px rgba(0,0,0,.05)',
                overflow: 'hidden',
              }}>
                <div style={{ display: 'flex', alignItems: 'center' }}
                  onClick={() => { setActiveProgram(p); setActiveDayIndex(0); setActiveDay(null); setProgramDays([]); setDayBlocks([]); loadProgramDays(p.id); setView('program') }}>
                  <div style={{ flex: 1, padding: '11px 14px', cursor: 'pointer' }}>
                    <span style={{ fontFamily: INCISED, fontSize: 13, fontWeight: 600, color: C.sageDark, letterSpacing: '0.5px', display: 'block', lineHeight: 1.3 }}>{p.title}</span>
                    <Mono style={{ fontSize: 9, color: C.sageMid, marginTop: 3 }}>
                      {new Date(p.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </Mono>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingRight: 10 }}>
                    <Mono style={{ fontSize: 7, padding: '2px 7px', borderRadius: 99, background: p.is_active ? `${C.sage}20` : `${C.creamDark}40`, color: p.is_active ? C.sage : C.sageMid, textTransform: 'uppercase', letterSpacing: '1.5px' }}>
                      {p.is_active ? 'Active' : 'Archived'}
                    </Mono>
                    <button onClick={e => { e.stopPropagation(); setConfirmDeleteProgram(p) }} style={{
                      background: 'none', border: `1px solid ${C.amber}40`, borderRadius: 6,
                      padding: '3px 7px', fontSize: 10, color: C.amber, cursor: 'pointer', fontFamily: MONO,
                    }}>✕</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )})}
      </div>

      {/* Confirm Delete Program Modal */}
      {confirmDeleteProgram && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 20px' }}>
          <div style={{ background: C.creamLight, borderRadius: 16, padding: '24px 20px', width: '100%', maxWidth: 340 }}>
            <h2 style={{ fontFamily: INCISED, fontWeight: 600, fontSize: 16, color: C.sageDark, marginBottom: 8 }}>Delete Program?</h2>
            <p style={{ fontFamily: MONO, fontSize: 11, color: C.sageMid, marginBottom: 4 }}>{confirmDeleteProgram.title}</p>
            <p style={{ fontFamily: MONO, fontSize: 11, color: C.amber, marginBottom: 20 }}>This will delete the program and all its days and exercises.</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setConfirmDeleteProgram(null)} style={{ flex: 1, padding: 12, background: 'none', border: `1px solid ${C.creamDark}`, borderRadius: 10, fontSize: 12, fontFamily: MONO, color: C.sageMid, cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => deleteProgram(confirmDeleteProgram)} style={{ flex: 1, padding: 12, background: C.amber, border: 'none', borderRadius: 10, fontSize: 12, fontFamily: MONO, color: C.white, cursor: 'pointer' }}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast msg={toast} />}
      <BottomNav tab="programs" setTab={() => {}} />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// PROGRESSION TAB
// ═══════════════════════════════════════════════════════════════════
function ProgressionTab({ clients, selectedClient, setSelectedClient }) {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [exercises, setExercises] = useState([])
  const [selectedExercise, setSelectedExercise] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [clientFilter, setClientFilter] = useState(selectedClient?.id || '')
  const [form, setForm] = useState({ client_id: selectedClient?.id || '', exercise_name: '', date: today(), sets: '', reps: '', weight: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)

  const showToast = msg => { setToast(msg); setTimeout(() => setToast(null), 2500) }

  useEffect(() => { loadLogs() }, [clientFilter])

  const loadLogs = async () => {
    setLoading(true)
    let query = supabase.from('exercise_logs').select('*').order('date', { ascending: true })
    if (clientFilter) query = query.eq('client_id', clientFilter)
    const { data } = await query
    setLogs(data || [])
    // Get unique exercise names
    const names = [...new Set((data || []).map(l => l.exercise_name))].sort()
    setExercises(names)
    if (names.length > 0 && !selectedExercise) setSelectedExercise(names[0])
    setLoading(false)
  }

  const addLog = async () => {
    if (!form.client_id || !form.exercise_name || !form.date) return
    setSaving(true)
    const { error } = await supabase.from('exercise_logs').insert([{
      client_id: form.client_id,
      exercise_name: form.exercise_name,
      date: form.date,
      sets: form.sets,
      reps: form.reps,
      weight: form.weight,
      notes: form.notes,
    }])
    if (!error) {
      await loadLogs()
      setShowAdd(false)
      setForm(p => ({ ...p, exercise_name: '', sets: '', reps: '', weight: '', notes: '' }))
      showToast('Logged ✓')
    }
    setSaving(false)
  }

  const exerciseLogs = logs.filter(l => l.exercise_name === selectedExercise)
  const chartData = exerciseLogs.map(l => ({
    date: l.date,
    weight: parseFloat(l.weight) || 0,
    label: `${l.weight || '?'} · ${l.reps || '?'} reps`,
  }))

  return (
    <div style={{ minHeight: '100vh', background: C.creamLight, paddingBottom: 90 }}>
      <Header title="Progression" right={
        <button onClick={() => setShowAdd(true)} style={{ background: C.sage, border: 'none', borderRadius: 8, padding: '7px 14px', color: C.white, fontFamily: MONO, fontSize: 11, letterSpacing: '1px', cursor: 'pointer' }}>+ Log</button>
      } />

      <div style={{ padding: '12px 16px 0' }}>
        {/* Client filter */}
        <select value={clientFilter} onChange={e => { setClientFilter(e.target.value); setSelectedExercise(null) }}
          style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: `1px solid ${C.creamDark}`, background: C.white, fontSize: 13, color: C.sageDark, fontFamily: MONO, outline: 'none', marginBottom: 12 }}>
          <option value="">All clients</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        {loading ? <Spinner /> : (
          <>
            {/* Exercise pills */}
            {exercises.length > 0 && (
              <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 14, paddingBottom: 4 }}>
                {exercises.map(ex => (
                  <button key={ex} onClick={() => setSelectedExercise(ex)} style={{
                    padding: '6px 14px', borderRadius: 99, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                    background: selectedExercise === ex ? C.sage : C.white,
                    color: selectedExercise === ex ? C.white : C.sageDark,
                    fontSize: 11, fontFamily: MONO,
                    boxShadow: '0 1px 3px rgba(0,0,0,.08)',
                  }}>{ex}</button>
                ))}
              </div>
            )}

            {selectedExercise && exerciseLogs.length > 0 && (
              <>
                {/* Chart */}
                {chartData.some(d => d.weight > 0) && (
                  <Card style={{ marginBottom: 12 }}>
                    <Mono style={{ fontSize: 9, color: C.sageMid, textTransform: 'uppercase', letterSpacing: '2px', display: 'block', marginBottom: 10 }}>Weight Progression — {selectedExercise}</Mono>
                    <ResponsiveContainer width="100%" height={120}>
                      <LineChart data={chartData}>
                        <XAxis dataKey="date" tick={{ fontSize: 8, fontFamily: MONO, fill: C.sageMid }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fontSize: 8, fontFamily: MONO, fill: C.sageMid }} tickLine={false} axisLine={false} width={30} />
                        <Tooltip contentStyle={{ fontFamily: MONO, fontSize: 11, background: C.sageDark, border: 'none', borderRadius: 8, color: C.cream }} />
                        <Line type="monotone" dataKey="weight" stroke={C.sage} strokeWidth={2} dot={{ fill: C.sage, r: 4 }} activeDot={{ r: 6 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </Card>
                )}

                {/* Log entries */}
                <Mono style={{ fontSize: 9, letterSpacing: '2px', color: C.sageMid, textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>
                  Full History · {exerciseLogs.length} entries
                </Mono>
                {[...exerciseLogs].reverse().map((l, i) => (
                  <Card key={l.id || i} style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <span style={{ fontSize: 20, color: C.sageDark, fontFamily: SERIF, display: 'block', lineHeight: 1 }}>{l.weight || '—'}</span>
                        <Mono style={{ fontSize: 10, color: C.sageMid, marginTop: 3 }}>{l.sets || '?'} sets × {l.reps || '?'} reps</Mono>
                        {l.notes && <Mono style={{ fontSize: 10, color: C.sageMid, display: 'block', marginTop: 3 }}>{l.notes}</Mono>}
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <Mono style={{ fontSize: 10, color: C.sageMid }}>{l.date}</Mono>
                        {clientFilter === '' && <Mono style={{ fontSize: 9, color: C.sage, display: 'block', marginTop: 2 }}>{clients.find(c => c.id === l.client_id)?.name || ''}</Mono>}
                      </div>
                    </div>
                  </Card>
                ))}
              </>
            )}

            {exercises.length === 0 && (
              <div style={{ textAlign: 'center', padding: 40 }}>
                <p style={{ fontFamily: MONO, color: C.sageMid, fontSize: 12 }}>No exercise data yet.</p>
                <p style={{ fontFamily: MONO, color: C.sageMid, fontSize: 11, marginTop: 8 }}>Tap + Log to manually add, or use "Run Session" in Programs to auto-populate.</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Add Log Modal */}
      {showAdd && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 100, display: 'flex', alignItems: 'flex-end' }}>
          <div style={{ background: C.creamLight, borderRadius: '16px 16px 0 0', padding: '24px 20px 40px', width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
              <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 20, color: C.sageDark }}>Log Exercise</h2>
              <button onClick={() => setShowAdd(false)} style={{ background: 'none', border: 'none', fontSize: 20, color: C.sageMid, cursor: 'pointer' }}>✕</button>
            </div>
            <Select label="Client" value={form.client_id} onChange={v => setForm(p => ({ ...p, client_id: v }))}
              options={[{ value: '', label: 'Select client...' }, ...clients.map(c => ({ value: c.id, label: c.name }))]} />
            <Input label="Exercise Name" value={form.exercise_name} onChange={v => setForm(p => ({ ...p, exercise_name: v }))} placeholder="e.g. Back Squat" />
            <Input label="Date" value={form.date} onChange={v => setForm(p => ({ ...p, date: v }))} placeholder="14 May 2026" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <Input label="Sets" value={form.sets} onChange={v => setForm(p => ({ ...p, sets: v }))} placeholder="3" />
              <Input label="Reps" value={form.reps} onChange={v => setForm(p => ({ ...p, reps: v }))} placeholder="10" />
              <Input label="Weight" value={form.weight} onChange={v => setForm(p => ({ ...p, weight: v }))} placeholder="50KG" />
            </div>
            <Input label="Notes" value={form.notes} onChange={v => setForm(p => ({ ...p, notes: v }))} placeholder="e.g. felt strong, good depth" />
            <Btn onClick={addLog} color={C.sage} style={{ width: '100%', marginTop: 8 }}>{saving ? 'Saving...' : 'Save Log'}</Btn>
          </div>
        </div>
      )}

      {toast && <Toast msg={toast} />}
      <BottomNav tab="progression" setTab={() => {}} />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// REVENUE TAB
// ═══════════════════════════════════════════════════════════════════
function RevenueTab({ clients }) {
  const totalEarned = clients.reduce((a, c) => a + (c.completed_packages * c.rate), 0)
  const totalIP = clients.reduce((a, c) => a + Math.round((c.sessions_completed / c.package_size) * c.rate), 0)
  const totalSessions = clients.reduce((a, c) => a + c.sessions_completed, 0)
  const totalCancels = clients.reduce((a, c) => a + c.cancellations, 0)

  const exportAll = async () => {
    const { data } = await supabase.from('sessions').select('*, clients(name)').order('created_at', { ascending: true })
    const rows = [['Client', 'Date', 'Package', 'Location', 'Note', 'Type']]
    ;(data || []).forEach(s => rows.push([s.clients?.name || '', s.date, `Package ${s.pkg}`, s.location, s.note, s.cancelled ? 'Cancelled' : 'Session']))
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
        {/* Big number */}
        <div style={{ background: C.sage, borderRadius: 14, padding: '18px 20px', marginBottom: 10 }}>
          <Mono style={{ fontSize: 9, letterSpacing: '3px', color: C.creamLight, textTransform: 'uppercase', display: 'block' }}>Confirmed Earned</Mono>
          <div style={{ fontSize: 40, fontWeight: 400, color: C.white, fontFamily: SERIF, marginTop: 4, lineHeight: 1 }}>
            {fmt(totalEarned)}
          </div>
          <div style={{ display: 'flex', gap: 24, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.sageLight}60` }}>
            <div>
              <Mono style={{ fontSize: 8, letterSpacing: '2px', color: C.creamLight, textTransform: 'uppercase', display: 'block' }}>In Progress</Mono>
              <span style={{ fontSize: 16, color: C.amber, fontFamily: SERIF }}>{fmt(totalIP)}</span>
            </div>
            <div>
              <Mono style={{ fontSize: 8, letterSpacing: '2px', color: C.creamLight, textTransform: 'uppercase', display: 'block' }}>All-Time Est.</Mono>
              <span style={{ fontSize: 16, color: C.white, fontFamily: SERIF }}>{fmt(totalEarned + totalIP)}</span>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
          {[{ label: 'Sessions', value: totalSessions }, { label: 'Cancels', value: totalCancels }, { label: 'Clients', value: clients.length }].map(s => (
            <Card key={s.label} style={{ padding: 11, textAlign: 'center', marginBottom: 0 }}>
              <Mono style={{ fontSize: 8, color: C.sageMid, letterSpacing: '1.5px', textTransform: 'uppercase', display: 'block' }}>{s.label}</Mono>
              <span style={{ fontSize: 22, color: C.sageDark, marginTop: 3, display: 'block', fontFamily: SERIF }}>{s.value}</span>
            </Card>
          ))}
        </div>

        {/* Per client */}
        <Mono style={{ fontSize: 9, letterSpacing: '2px', color: C.sageMid, textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>Per Client</Mono>
        {[...clients].sort((a, b) => (b.completed_packages * b.rate) - (a.completed_packages * a.rate)).map(c => {
          const earned = c.completed_packages * c.rate
          const ip = Math.round((c.sessions_completed / c.package_size) * c.rate)
          const pct = totalEarned > 0 ? Math.round((earned / totalEarned) * 100) : 0
          return (
            <Card key={c.id} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div>
                  <span style={{ fontSize: 17, color: C.sageDark, fontFamily: SERIF }}>{c.name}</span>
                  <Mono style={{ fontSize: 10, color: C.sageMid, marginLeft: 8 }}>{c.completed_packages} pkg{c.completed_packages !== 1 ? 's' : ''}</Mono>
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

        <button onClick={exportAll} style={{ width: '100%', padding: 14, background: C.sage, color: C.white, border: 'none', borderRadius: 10, fontSize: 12, fontFamily: MONO, letterSpacing: '2px', textTransform: 'uppercase', cursor: 'pointer', marginTop: 4 }}>
          ↓ Export All Session Logs
        </button>
      </div>
      <BottomNav tab="revenue" setTab={() => {}} />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// ROOT APP
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

  const handleSetTab = (t) => {
    setTab(t)
    if (t !== 'client_detail') setSelectedClient(null)
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: C.cream, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
        <div style={{ fontFamily: IMPACT, fontSize: 22, letterSpacing: '3px', color: C.sage, textTransform: 'uppercase', marginBottom: 4 }}>SHE SKULPTS</div>
        <div style={{ fontFamily: SERIF, fontSize: 22, color: C.sageDark, marginBottom: 30 }}>Loading...</div>
        <Spinner />
      </div>
    )
  }

  const navSetTab = (t) => {
    setTab(t)
    if (t === 'clients') setSelectedClient(null)
  }

  return (
    <div>
      {tab === 'clients' && (
        <ClientsTab clients={clients} setClients={setClients} setSelectedClient={c => { setSelectedClient(c); setTab('client_detail') }} setTab={handleSetTab} />
      )}
      {tab === 'client_detail' && selectedClient && (
        <ClientDetail client={selectedClient} clients={clients} setClients={setClients} setTab={navSetTab} setSelectedClient={setSelectedClient} />
      )}
      {tab === 'programs' && (
        <ProgramsTab clients={clients} selectedClient={selectedClient} setSelectedClient={setSelectedClient} />
      )}
      {tab === 'progression' && (
        <ProgressionTab clients={clients} selectedClient={selectedClient} setSelectedClient={setSelectedClient} />
      )}
      {tab === 'revenue' && (
        <RevenueTab clients={clients} />
      )}
      {tab === 'library' && (
        <ExerciseLibraryTab />
      )}

      {tab !== 'client_detail' && (
        <BottomNav tab={tab === 'clients' ? 'clients' : tab} setTab={navSetTab} />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// EXERCISE LIBRARY TAB
// ═══════════════════════════════════════════════════════════════════
function ExerciseLibraryTab() {
  const [exercises, setExercises] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterPattern, setFilterPattern] = useState('')
  const [filterEquip, setFilterEquip] = useState('')
  const [filterMuscle, setFilterMuscle] = useState('')
  const [selected, setSelected] = useState(null)

  useEffect(() => { loadExercises() }, [])

  const loadExercises = async () => {
    setLoading(true)
    const { data } = await supabase.from('exercises').select('*').order('name')
    setExercises(data || [])
    setLoading(false)
  }

  const patterns = [...new Set(exercises.map(e => e.movement_pattern).filter(Boolean))].sort()
  const equipments = [...new Set(exercises.flatMap(e => e.equipment || []))].sort()
  const muscles = [...new Set(exercises.flatMap(e => e.primary_muscles || []))].sort()

  const filtered = exercises.filter(e => {
    const q = search.toLowerCase()
    const matchSearch = !search || e.name.toLowerCase().includes(q) ||
      (e.aliases || []).some(a => a.toLowerCase().includes(q)) ||
      (e.primary_muscles || []).some(m => m.toLowerCase().includes(q))
    const matchPattern = !filterPattern || e.movement_pattern === filterPattern
    const matchEquip = !filterEquip || (e.equipment || []).includes(filterEquip)
    const matchMuscle = !filterMuscle || (e.primary_muscles || []).includes(filterMuscle)
    return matchSearch && matchPattern && matchEquip && matchMuscle
  })

  const stressColor = n => n === 1 ? C.sage : n === 2 ? C.amber : '#C0392B'
  const stressDot = n => (
    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: stressColor(n), marginRight: 2 }} />
  )
  const StressRow = ({ label, val }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: `1px solid ${C.creamDark}30` }}>
      <Mono style={{ fontSize: 9, color: C.sageMid, textTransform: 'uppercase', letterSpacing: '1px' }}>{label}</Mono>
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        {[1,2,3].map(i => (
          <div key={i} style={{ width: 10, height: 10, borderRadius: 2, background: i <= val ? stressColor(val) : `${C.creamDark}50` }} />
        ))}
        <Mono style={{ fontSize: 9, color: stressColor(val), marginLeft: 4 }}>
          {val === 1 ? 'Low' : val === 2 ? 'Med' : 'High'}
        </Mono>
      </div>
    </div>
  )

  if (selected) {
    const e = selected
    return (
      <div style={{ minHeight: '100vh', background: C.creamLight, paddingBottom: 90 }}>
        <Header title={e.name} subtitle={`${e.movement_pattern || ''} · ${e.category || ''}`} onBack={() => setSelected(null)} />
        <div style={{ padding: '14px 16px' }}>

          {/* Difficulty + Type badges */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            {[e.difficulty, e.category, e.movement_pattern].filter(Boolean).map(tag => (
              <span key={tag} style={{ fontFamily: MONO, fontSize: 8, letterSpacing: '1.5px', textTransform: 'uppercase', padding: '3px 9px', borderRadius: 99, background: `${C.sage}20`, color: C.sageDark, border: `1px solid ${C.sage}40` }}>{tag}</span>
            ))}
          </div>

          {/* Muscles */}
          <Card style={{ marginBottom: 10 }}>
            <Mono style={{ fontSize: 9, color: C.sage, textTransform: 'uppercase', letterSpacing: '2px', display: 'block', marginBottom: 8 }}>Muscles</Mono>
            <div style={{ marginBottom: 6 }}>
              <Mono style={{ fontSize: 8, color: C.sageMid, textTransform: 'uppercase' }}>Primary</Mono>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 4 }}>
                {(e.primary_muscles || []).map(m => (
                  <span key={m} style={{ fontFamily: MONO, fontSize: 9, padding: '2px 8px', borderRadius: 99, background: C.sage, color: C.white }}>{prettifyLabel(m)}</span>
                ))}
              </div>
            </div>
            {(e.secondary_muscles || []).length > 0 && (
              <div>
                <Mono style={{ fontSize: 8, color: C.sageMid, textTransform: 'uppercase' }}>Secondary</Mono>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 4 }}>
                  {(e.secondary_muscles || []).map(m => (
                    <span key={m} style={{ fontFamily: MONO, fontSize: 9, padding: '2px 8px', borderRadius: 99, background: `${C.sage}25`, color: C.sageDark }}>{prettifyLabel(m)}</span>
                  ))}
                </div>
              </div>
            )}
          </Card>

          {/* Equipment */}
          <Card style={{ marginBottom: 10 }}>
            <Mono style={{ fontSize: 9, color: C.sage, textTransform: 'uppercase', letterSpacing: '2px', display: 'block', marginBottom: 6 }}>Equipment</Mono>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {(e.equipment || []).map(eq => (
                <span key={eq} style={{ fontFamily: MONO, fontSize: 9, padding: '2px 8px', borderRadius: 99, background: `${C.creamDark}40`, color: C.sageDark }}>{prettifyLabel(eq)}</span>
              ))}
            </div>
          </Card>

          {/* Stress Scores */}
          <Card style={{ marginBottom: 10 }}>
            <Mono style={{ fontSize: 9, color: C.sage, textTransform: 'uppercase', letterSpacing: '2px', display: 'block', marginBottom: 8 }}>Joint & Spinal Load</Mono>
            {[
              { label: 'Spinal Load', val: e.spinal_load },
              { label: 'Lower Back', val: e.lower_back_stress },
              { label: 'Shoulder', val: e.shoulder_stress },
              { label: 'Knee', val: e.knee_stress },
              { label: 'Wrist', val: e.wrist_stress },
              { label: 'Elbow', val: e.elbow_stress },
              { label: 'Neck', val: e.neck_stress },
            ].filter(x => x.val).map(x => <StressRow key={x.label} label={x.label} val={x.val} />)}
          </Card>

          {/* Training Values */}
          <Card style={{ marginBottom: 10 }}>
            <Mono style={{ fontSize: 9, color: C.sage, textTransform: 'uppercase', letterSpacing: '2px', display: 'block', marginBottom: 8 }}>Training Value</Mono>
            {[
              { label: 'Hypertrophy', val: e.hypertrophy_value },
              { label: 'Strength', val: e.strength_value },
              { label: 'Power', val: e.power_value },
            ].filter(x => x.val).map(x => <StressRow key={x.label} label={x.label} val={x.val} />)}
            {e.rehab_suitability && (
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 6 }}>
                <Mono style={{ fontSize: 9, color: C.sageMid, textTransform: 'uppercase' }}>Rehab Suitability</Mono>
                <Mono style={{ fontSize: 9, color: e.rehab_suitability === 'high' ? C.sage : e.rehab_suitability === 'contraindicated' ? '#C0392B' : C.amber, textTransform: 'uppercase' }}>{e.rehab_suitability}</Mono>
              </div>
            )}
          </Card>

          {/* Coaching Cues */}
          {(e.coaching_cues || []).length > 0 && (
            <Card style={{ marginBottom: 10 }}>
              <Mono style={{ fontSize: 9, color: C.sage, textTransform: 'uppercase', letterSpacing: '2px', display: 'block', marginBottom: 8 }}>Coaching Cues</Mono>
              {(e.coaching_cues || []).map((cue, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                  <span style={{ color: C.sage, fontSize: 12, marginTop: 1 }}>→</span>
                  <span style={{ fontFamily: MONO, fontSize: 11, color: C.sageDark, lineHeight: 1.5 }}>{cue}</span>
                </div>
              ))}
            </Card>
          )}

          {/* Common Mistakes */}
          {(e.common_mistakes || []).length > 0 && (
            <Card style={{ marginBottom: 10 }}>
              <Mono style={{ fontSize: 9, color: C.amber, textTransform: 'uppercase', letterSpacing: '2px', display: 'block', marginBottom: 8 }}>Common Mistakes</Mono>
              {(e.common_mistakes || []).map((m, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                  <span style={{ color: C.amber, fontSize: 12, marginTop: 1 }}>⚠</span>
                  <span style={{ fontFamily: MONO, fontSize: 11, color: C.sageDark, lineHeight: 1.5 }}>{m}</span>
                </div>
              ))}
            </Card>
          )}

          {/* Contraindications */}
          {(e.contraindications || []).length > 0 && (
            <Card style={{ marginBottom: 10, borderLeft: `3px solid #C0392B` }}>
              <Mono style={{ fontSize: 9, color: '#C0392B', textTransform: 'uppercase', letterSpacing: '2px', display: 'block', marginBottom: 8 }}>Contraindications</Mono>
              {(e.contraindications || []).map((c, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
                  <span style={{ color: '#C0392B', fontSize: 10 }}>✕</span>
                  <span style={{ fontFamily: MONO, fontSize: 11, color: C.sageDark }}>{prettifyLabel(c)}</span>
                </div>
              ))}
            </Card>
          )}

          {/* Regressions / Progressions / Substitutions */}
          {[(e.regressions||[]).length > 0 && { label: 'Regressions', items: e.regressions, color: C.sageMid },
            (e.progressions||[]).length > 0 && { label: 'Progressions', items: e.progressions, color: C.sage },
            (e.substitutions||[]).length > 0 && { label: 'Substitutions', items: e.substitutions, color: C.sageMid },
          ].filter(Boolean).map(section => (
            <Card key={section.label} style={{ marginBottom: 10 }}>
              <Mono style={{ fontSize: 9, color: section.color, textTransform: 'uppercase', letterSpacing: '2px', display: 'block', marginBottom: 6 }}>{section.label}</Mono>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {section.items.map(item => (
                  <span key={item} onClick={() => { const ex = exercises.find(e => e.name === item); if(ex) setSelected(ex) }}
                    style={{ fontFamily: MONO, fontSize: 10, padding: '3px 10px', borderRadius: 99, background: `${C.sage}15`, color: C.sageDark, border: `1px solid ${C.sage}30`, cursor: 'pointer' }}>{item}</span>
                ))}
              </div>
            </Card>
          ))}

          {/* Best used for / Not ideal for */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
            {(e.best_used_for||[]).length > 0 && (
              <Card style={{ marginBottom: 0 }}>
                <Mono style={{ fontSize: 8, color: C.sage, textTransform: 'uppercase', letterSpacing: '1.5px', display: 'block', marginBottom: 6 }}>Best For</Mono>
                {(e.best_used_for||[]).map(t => <Mono key={t} style={{ fontSize: 9, color: C.sageDark, display: 'block', marginBottom: 2 }}>· {prettifyLabel(t)}</Mono>)}
              </Card>
            )}
            {(e.not_ideal_for||[]).length > 0 && (
              <Card style={{ marginBottom: 0 }}>
                <Mono style={{ fontSize: 8, color: C.amber, textTransform: 'uppercase', letterSpacing: '1.5px', display: 'block', marginBottom: 6 }}>Not Ideal For</Mono>
                {(e.not_ideal_for||[]).map(t => <Mono key={t} style={{ fontSize: 9, color: C.sageDark, display: 'block', marginBottom: 2 }}>· {prettifyLabel(t)}</Mono>)}
              </Card>
            )}
          </div>
        </div>
        <BottomNav tab="library" setTab={() => setSelected(null)} />
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: C.creamLight, paddingBottom: 90 }}>
      <Header title="Exercise Library" />

      {/* Search */}
      <div style={{ background: C.sage, padding: '0 16px 12px' }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search exercises, muscles..."
          style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: 'none', background: C.white, fontSize: 13, color: C.sageDark, fontFamily: MONO, outline: 'none' }} />
      </div>

      {/* Filters */}
      <div style={{ background: `${C.sage}15`, borderBottom: `1px solid ${C.creamDark}40`, padding: '10px 16px', display: 'flex', gap: 6, overflowX: 'auto' }}>
        <select value={filterPattern} onChange={e => setFilterPattern(e.target.value)}
          style={{ padding: '5px 10px', borderRadius: 8, border: `1px solid ${C.creamDark}`, background: C.white, fontSize: 10, color: C.sageDark, fontFamily: MONO, outline: 'none' }}>
          <option value="">All Patterns</option>
          {patterns.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={filterMuscle} onChange={e => setFilterMuscle(e.target.value)}
          style={{ padding: '5px 10px', borderRadius: 8, border: `1px solid ${C.creamDark}`, background: C.white, fontSize: 10, color: C.sageDark, fontFamily: MONO, outline: 'none' }}>
          <option value="">All Muscles</option>
          {muscles.map(m => <option key={m} value={m}>{m.replace(/_/g,' ')}</option>)}
        </select>
        <select value={filterEquip} onChange={e => setFilterEquip(e.target.value)}
          style={{ padding: '5px 10px', borderRadius: 8, border: `1px solid ${C.creamDark}`, background: C.white, fontSize: 10, color: C.sageDark, fontFamily: MONO, outline: 'none' }}>
          <option value="">All Equipment</option>
          {equipments.map(eq => <option key={eq} value={eq}>{eq.replace(/_/g,' ')}</option>)}
        </select>
        {(filterPattern || filterMuscle || filterEquip || search) && (
          <button onClick={() => { setFilterPattern(''); setFilterMuscle(''); setFilterEquip(''); setSearch('') }}
            style={{ padding: '5px 10px', borderRadius: 8, border: `1px solid ${C.amber}`, background: 'none', fontSize: 10, color: C.amber, fontFamily: MONO, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            Clear ✕
          </button>
        )}
      </div>

      <div style={{ padding: '10px 16px' }}>
        <Mono style={{ fontSize: 9, color: C.sageMid, display: 'block', marginBottom: 10, letterSpacing: '1px' }}>
          {filtered.length} exercise{filtered.length !== 1 ? 's' : ''}
        </Mono>

        {loading ? <Spinner /> : filtered.map(e => (
          <div key={e.id} onClick={() => setSelected(e)} style={{
            background: C.white, borderRadius: 10, padding: '11px 14px', marginBottom: 7,
            cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,.05)',
            borderLeft: `3px solid ${e.lower_back_stress === 3 ? '#C0392B' : e.lower_back_stress === 2 ? C.amber : C.sage}`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <span style={{ fontFamily: INCISED, fontSize: 13, fontWeight: 600, color: C.sageDark, display: 'block' }}>{e.name}</span>
                <Mono style={{ fontSize: 9, color: C.sageMid, marginTop: 2 }}>
                  {(e.primary_muscles || []).slice(0,2).map(prettifyLabel).join(' · ')}
                </Mono>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                <Mono style={{ fontSize: 7, padding: '2px 7px', borderRadius: 99, background: `${C.sage}20`, color: C.sage, textTransform: 'uppercase', letterSpacing: '1px' }}>{e.movement_pattern}</Mono>
                <Mono style={{ fontSize: 7, padding: '2px 7px', borderRadius: 99, background: `${C.creamDark}40`, color: C.sageMid, textTransform: 'uppercase', letterSpacing: '1px' }}>{e.difficulty}</Mono>
              </div>
            </div>
            {/* Quick stress indicators */}
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              {[{l:'LB', v:e.lower_back_stress},{l:'SH', v:e.shoulder_stress},{l:'KN', v:e.knee_stress}].map(s => s.v && (
                <div key={s.l} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Mono style={{ fontSize: 7, color: C.sageMid }}>{s.l}</Mono>
                  {[1,2,3].map(i => <div key={i} style={{ width: 5, height: 5, borderRadius: 1, background: i <= s.v ? stressColor(s.v) : `${C.creamDark}50` }} />)}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <BottomNav tab="library" setTab={() => {}} />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// CLIENT HEALTH PROFILE (used inside ClientDetail)
// ═══════════════════════════════════════════════════════════════════
function ClientHealthProfile({ client }) {
  const [health, setHealth] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ category: 'injury', title: '', body_part: '', severity: 'moderate', side: 'n/a', status: 'active', notes: '' })
  const [toast, setToast] = useState(null)

  const showToast = msg => { setToast(msg); setTimeout(() => setToast(null), 2500) }

  useEffect(() => { loadHealth() }, [client.id])

  const loadHealth = async () => {
    setLoading(true)
    const { data } = await supabase.from('client_health').select('*').eq('client_id', client.id).order('created_at', { ascending: false })
    setHealth(data || [])
    setLoading(false)
  }

  const addEntry = async () => {
    if (!form.title) return
    setSaving(true)
    const { error } = await supabase.from('client_health').insert([{ ...form, client_id: client.id }])
    if (!error) {
      await loadHealth()
      setShowAdd(false)
      setForm({ category: 'injury', title: '', body_part: '', severity: 'moderate', side: 'n/a', status: 'active', notes: '' })
      showToast('Added ✓')
    }
    setSaving(false)
  }

  const deleteEntry = async (id) => {
    await supabase.from('client_health').delete().eq('id', id)
    setHealth(prev => prev.filter(h => h.id !== id))
  }

  const catColor = cat => ({ injury:'#C0392B', surgery:'#8E44AD', chronic_pain: C.amber, limitation: C.sageMid, posture: C.sage, history: C.sageMid, note: C.sage }[cat] || C.sageMid)
  const catIcon = cat => ({ injury:'⚡', surgery:'✦', chronic_pain:'⚠', limitation:'◈', posture:'↑', history:'◷', note:'✎' }[cat] || '·')

  return (
    <div style={{ padding: '12px 16px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <Mono style={{ fontSize: 9, letterSpacing: '2px', color: C.sageMid, textTransform: 'uppercase' }}>Health Profile</Mono>
        <button onClick={() => setShowAdd(true)} style={{ background: 'none', border: `1px solid ${C.sage}`, borderRadius: 7, padding: '3px 10px', fontSize: 9, color: C.sage, fontFamily: MONO, cursor: 'pointer' }}>+ Add</button>
      </div>

      {loading ? <Spinner /> : health.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '16px 0', marginBottom: 10 }}>
          <Mono style={{ fontSize: 11, color: C.sageMid }}>No health data yet — tap + Add</Mono>
        </div>
      ) : health.map(h => (
        <div key={h.id} style={{
          background: C.white, borderRadius: 10, padding: '10px 12px', marginBottom: 7,
          borderLeft: `3px solid ${catColor(h.category)}`,
          boxShadow: '0 1px 3px rgba(0,0,0,.05)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <span style={{ fontSize: 12, color: catColor(h.category) }}>{catIcon(h.category)}</span>
                <span style={{ fontFamily: INCISED, fontSize: 12, fontWeight: 600, color: C.sageDark }}>{h.title}</span>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {h.body_part && <Mono style={{ fontSize: 8, padding: '1px 6px', borderRadius: 99, background: `${C.creamDark}40`, color: C.sageMid, textTransform: 'uppercase' }}>{h.body_part.replace(/_/g,' ')}</Mono>}
                {h.severity && h.severity !== 'n/a' && <Mono style={{ fontSize: 8, padding: '1px 6px', borderRadius: 99, background: h.severity === 'severe' ? '#C0392B20' : h.severity === 'resolved' ? `${C.sage}20` : `${C.amber}20`, color: h.severity === 'severe' ? '#C0392B' : h.severity === 'resolved' ? C.sage : C.amber, textTransform: 'uppercase' }}>{h.severity}</Mono>}
                {h.side && h.side !== 'n/a' && <Mono style={{ fontSize: 8, padding: '1px 6px', borderRadius: 99, background: `${C.creamDark}40`, color: C.sageMid, textTransform: 'uppercase' }}>{h.side}</Mono>}
                <Mono style={{ fontSize: 8, padding: '1px 6px', borderRadius: 99, background: h.status === 'active' ? `${C.amber}20` : `${C.sage}20`, color: h.status === 'active' ? C.amber : C.sage, textTransform: 'uppercase' }}>{h.status}</Mono>
              </div>
              {h.notes && <Mono style={{ fontSize: 10, color: C.sageMid, marginTop: 4, display: 'block' }}>{h.notes}</Mono>}
            </div>
            <button onClick={() => deleteEntry(h.id)} style={{ background: 'none', border: 'none', color: `${C.sageMid}60`, fontSize: 14, cursor: 'pointer', padding: '0 0 0 8px' }}>✕</button>
          </div>
        </div>
      ))}

      {showAdd && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 100, display: 'flex', alignItems: 'flex-end' }}>
          <div style={{ background: C.creamLight, borderRadius: '16px 16px 0 0', padding: '24px 20px 40px', width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
              <h2 style={{ fontFamily: IMPACT, fontSize: 18, letterSpacing: '1px', color: C.sageDark, textTransform: 'uppercase' }}>Add Health Entry</h2>
              <button onClick={() => setShowAdd(false)} style={{ background: 'none', border: 'none', fontSize: 20, color: C.sageMid, cursor: 'pointer' }}>✕</button>
            </div>
            <Select label="Category" value={form.category} onChange={v => setForm(p => ({...p, category: v}))}
              options={[{value:'injury',label:'⚡ Injury'},{value:'surgery',label:'✦ Surgery'},{value:'chronic_pain',label:'⚠ Chronic Pain'},{value:'limitation',label:'◈ Limitation'},{value:'posture',label:'↑ Posture Note'},{value:'history',label:'◷ Training History'},{value:'note',label:'✎ General Note'}]} />
            <Input label="Title" value={form.title} onChange={v => setForm(p=>({...p,title:v}))} placeholder="e.g. Lower Back Pain, ACL Surgery" />
            <Select label="Body Part" value={form.body_part} onChange={v => setForm(p=>({...p,body_part:v}))}
              options={[{value:'',label:'Select...'},{value:'lower_back',label:'Lower Back'},{value:'shoulder',label:'Shoulder'},{value:'knee',label:'Knee'},{value:'neck',label:'Neck'},{value:'wrist',label:'Wrist'},{value:'elbow',label:'Elbow'},{value:'hip',label:'Hip'},{value:'ankle',label:'Ankle'},{value:'core',label:'Core / Abdomen'},{value:'full_body',label:'Full Body'}]} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Select label="Severity" value={form.severity} onChange={v => setForm(p=>({...p,severity:v}))}
                options={[{value:'mild',label:'Mild'},{value:'moderate',label:'Moderate'},{value:'severe',label:'Severe'},{value:'resolved',label:'Resolved'},{value:'n/a',label:'N/A'}]} />
              <Select label="Side" value={form.side} onChange={v => setForm(p=>({...p,side:v}))}
                options={[{value:'n/a',label:'N/A'},{value:'left',label:'Left'},{value:'right',label:'Right'},{value:'bilateral',label:'Both'}]} />
            </div>
            <Select label="Status" value={form.status} onChange={v => setForm(p=>({...p,status:v}))}
              options={[{value:'active',label:'Active'},{value:'managing',label:'Managing'},{value:'resolved',label:'Resolved'}]} />
            <Input label="Notes" value={form.notes} onChange={v => setForm(p=>({...p,notes:v}))} placeholder="Any additional context..." />
            <button onClick={addEntry} disabled={saving} style={{ width: '100%', padding: 14, background: C.sage, color: C.white, border: 'none', borderRadius: 12, fontSize: 12, fontFamily: MONO, letterSpacing: '2px', textTransform: 'uppercase', cursor: 'pointer', marginTop: 8 }}>
              {saving ? 'Saving...' : 'Save Entry'}
            </button>
          </div>
        </div>
      )}
      {toast && <Toast msg={toast} />}
    </div>
  )
}


// ═══════════════════════════════════════════════════════════════════
// CLIENT EQUIPMENT PROFILE — dynamic library + custom equipment
// ═══════════════════════════════════════════════════════════════════
function ClientEquipmentProfile({ client, setClients }) {
  const [equipment, setEquipment] = useState(client.equipment || [])
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)
  const [library, setLibrary] = useState([])
  const [search, setSearch] = useState('')
  const [showAddCustom, setShowAddCustom] = useState(false)
  const [customForm, setCustomForm] = useState({ name: '', category: 'custom', description: '' })

  const showToast = msg => { setToast(msg); setTimeout(() => setToast(null), 2500) }

  useEffect(() => { loadLibrary() }, [])
  useEffect(() => { setEquipment(client.equipment || []) }, [client.id])

  const loadLibrary = async () => {
    const { data } = await supabase.from('equipment_library').select('*').order('category').order('name')
    setLibrary(data || [])
  }

  const toggle = (name) => {
    setEquipment(prev => prev.includes(name) ? prev.filter(x => x !== name) : [...prev, name])
  }

  const save = async () => {
    setSaving(true)
    const { error } = await supabase.from('clients').update({ equipment }).eq('id', client.id)
    if (!error) {
      setClients(prev => prev.map(c => c.id === client.id ? { ...c, equipment } : c))
      showToast('Equipment saved ✓')
      setOpen(false)
    }
    setSaving(false)
  }

  const addCustom = async () => {
    if (!customForm.name.trim()) return
    const { data, error } = await supabase.from('equipment_library').insert([{
      name: customForm.name.trim(),
      category: customForm.category,
      description: customForm.description || null,
      is_custom: true,
    }]).select()
    if (!error && data) {
      setLibrary(prev => [...prev, data[0]])
      // Auto-attach to current client
      setEquipment(prev => [...prev, data[0].name])
      setShowAddCustom(false)
      setCustomForm({ name: '', category: 'custom', description: '' })
      showToast(`Added "${data[0].name}" to library ✓`)
    } else if (error?.code === '23505') {
      showToast('Equipment with this name already exists')
    }
  }

  // Group library by category for cleaner display
  const groupedLib = {}
  library
    .filter(eq => !search || eq.name.toLowerCase().includes(search.toLowerCase()) || eq.category.toLowerCase().includes(search.toLowerCase()))
    .forEach(eq => {
      if (!groupedLib[eq.category]) groupedLib[eq.category] = []
      groupedLib[eq.category].push(eq)
    })

  const catLabel = { free_weights: 'Free Weights', machines: 'Machines', cables: 'Cables', bodyweight: 'Bodyweight & Rigs', bands: 'Bands', cardio: 'Cardio', functional: 'Functional', accessories: 'Accessories', recovery: 'Recovery', rehab: 'Rehab', custom: 'Custom' }

  return (
    <div style={{ padding: '8px 16px 0' }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: C.white, borderRadius: 10, cursor: 'pointer', borderLeft: `3px solid ${C.sage}`, boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Chevron open={open} size={12} color={C.sage} />
          <Mono style={{ fontSize: 10, letterSpacing: '2px', color: C.sageDark, textTransform: 'uppercase' }}>Equipment Profile</Mono>
        </div>
        <Mono style={{ fontSize: 9, color: C.sageMid }}>{equipment.length} item{equipment.length !== 1 ? 's' : ''}</Mono>
      </div>
      {open && (
        <div style={{ padding: '10px 0' }}>
          {/* Search bar + add custom */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search equipment..."
              style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.creamDark}`, fontFamily: MONO, fontSize: 11, color: C.sageDark, outline: 'none', background: C.white }} />
            <button onClick={() => setShowAddCustom(true)} style={{ padding: '6px 12px', background: C.sage, border: 'none', borderRadius: 8, color: C.white, fontSize: 10, fontFamily: MONO, letterSpacing: '1px', cursor: 'pointer', whiteSpace: 'nowrap' }}>+ Custom</button>
          </div>

          {/* Equipment by category */}
          {Object.entries(groupedLib).map(([cat, items]) => (
            <div key={cat} style={{ marginBottom: 10 }}>
              <Mono style={{ fontSize: 8, letterSpacing: '2px', color: C.sageMid, textTransform: 'uppercase', display: 'block', marginBottom: 5 }}>{catLabel[cat] || cat}</Mono>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {items.map(eq => (
                  <button key={eq.id} onClick={() => toggle(eq.name)} style={{
                    padding: '5px 10px', borderRadius: 99, border: '1px solid', cursor: 'pointer',
                    borderColor: equipment.includes(eq.name) ? C.sage : C.creamDark,
                    background: equipment.includes(eq.name) ? C.sage : 'transparent',
                    color: equipment.includes(eq.name) ? C.white : C.sageMid,
                    fontSize: 9, letterSpacing: '0.5px', fontFamily: MONO,
                  }}>{eq.name}{eq.is_custom && ' ★'}</button>
                ))}
              </div>
            </div>
          ))}

          <button onClick={save} disabled={saving} style={{ width: '100%', padding: 11, background: C.sage, color: C.white, border: 'none', borderRadius: 8, fontSize: 11, fontFamily: MONO, letterSpacing: '2px', textTransform: 'uppercase', cursor: 'pointer', marginTop: 10 }}>
            {saving ? 'Saving...' : 'Save Equipment Profile'}
          </button>
        </div>
      )}

      {/* Add Custom Equipment Modal */}
      {showAddCustom && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 100, display: 'flex', alignItems: 'flex-end' }}>
          <div style={{ background: C.creamLight, borderRadius: '16px 16px 0 0', padding: '24px 20px 40px', width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
              <h2 style={{ fontFamily: IMPACT, fontSize: 18, letterSpacing: '1px', color: C.sageDark, textTransform: 'uppercase' }}>Add Custom Equipment</h2>
              <button onClick={() => setShowAddCustom(false)} style={{ background: 'none', border: 'none', fontSize: 20, color: C.sageMid, cursor: 'pointer' }}>✕</button>
            </div>
            <Input label="Equipment Name" value={customForm.name} onChange={v => setCustomForm(p => ({ ...p, name: v }))} placeholder="e.g. Vibration Plate, Reformer, etc." />
            <Select label="Category" value={customForm.category} onChange={v => setCustomForm(p => ({ ...p, category: v }))}
              options={[
                { value: 'custom', label: 'Custom' },
                { value: 'free_weights', label: 'Free Weights' },
                { value: 'machines', label: 'Machines' },
                { value: 'cables', label: 'Cables' },
                { value: 'bodyweight', label: 'Bodyweight / Rigs' },
                { value: 'bands', label: 'Bands' },
                { value: 'cardio', label: 'Cardio' },
                { value: 'functional', label: 'Functional' },
                { value: 'accessories', label: 'Accessories' },
                { value: 'recovery', label: 'Recovery' },
                { value: 'rehab', label: 'Rehab' },
              ]} />
            <Input label="Description (optional)" value={customForm.description} onChange={v => setCustomForm(p => ({ ...p, description: v }))} placeholder="What is this used for?" />
            <button onClick={addCustom} style={{ width: '100%', padding: 14, background: C.sage, color: C.white, border: 'none', borderRadius: 12, fontSize: 12, fontFamily: MONO, letterSpacing: '2px', textTransform: 'uppercase', cursor: 'pointer', marginTop: 8 }}>
              Add to Library
            </button>
            <p style={{ fontSize: 10, color: C.sageMid, fontFamily: MONO, marginTop: 10, textAlign: 'center' }}>Saved permanently in your equipment library</p>
          </div>
        </div>
      )}

      {toast && <Toast msg={toast} />}
    </div>
  )
}
