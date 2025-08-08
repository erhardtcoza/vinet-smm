import { useState } from 'react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8787'

export default function App(){
  const [company, setCompany] = useState({ name:'', description:'', tone:'', site_url:'', logo_url:'', socials:'', colors:'' })
  const [companyId, setCompanyId] = useState(null)
  const [week, setWeek] = useState(new Date().toISOString().slice(0,10))
  const [platforms, setPlatforms] = useState(['facebook','instagram','linkedin','x'])
  const [log, setLog] = useState([])

  const push = (m)=>setLog(l=>[m,...l])

  async function saveCompany(){
    const payload = {
      ...company,
      socials: safeJson(company.socials),
      colors: safeJson(company.colors)
    }
    const r = await fetch(`${API}/api/company`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) })
    const j = await r.json()
    setCompanyId(j.id)
    push(`Company saved: ${j.id}`)
  }

  async function ingest(){
    if(!companyId) return alert('Save company first')
    const r = await fetch(`${API}/api/ingest`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ company_id: companyId, limit: 20 }) })
    const j = await r.json(); push(`Ingested pages=${j.pages} products=${j.products}`)
  }

  async function plan(){
    if(!companyId) return alert('Save company first')
    const r = await fetch(`${API}/api/plan/week`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ company_id: companyId, week_start: week, platforms }) })
    const j = await r.json(); push(`Plan created id=${j.plan_id} posts=${j.count}`)
  }

  return (
    <div className="container">
      <h2>Social Media Planner</h2>
      <p className="muted">MVP: company setup → ingest site → generate weekly plan.</p>

      <div className="row">
        <div>
          <h3>Company</h3>
          <input placeholder="Name" value={company.name} onChange={e=>setCompany({...company,name:e.target.value})} />
          <textarea placeholder="Description" rows={4} value={company.description} onChange={e=>setCompany({...company,description:e.target.value})} />
          <input placeholder="Tone (e.g., friendly, direct)" value={company.tone} onChange={e=>setCompany({...company,tone:e.target.value})} />
          <input placeholder="Website URL" value={company.site_url} onChange={e=>setCompany({...company,site_url:e.target.value})} />
          <input placeholder="Logo URL" value={company.logo_url} onChange={e=>setCompany({...company,logo_url:e.target.value})} />
          <textarea placeholder='Socials JSON (e.g., {"facebook":"...","instagram":"..."})' rows={3} value={company.socials} onChange={e=>setCompany({...company,socials:e.target.value})} />
          <textarea placeholder='Colors JSON (e.g., {"primary":"#e2001a"})' rows={2} value={company.colors} onChange={e=>setCompany({...company,colors:e.target.value})} />
          <button onClick={saveCompany}>Save Company</button>
        </div>

        <div>
          <h3>Ingest & Plan</h3>
          <button onClick={ingest}>Ingest Website</button>
          <div style={{marginTop:12}}>
            <label>Week start</label>
            <input type="date" value={week} onChange={e=>setWeek(e.target.value)} />
          </div>
          <div style={{marginTop:12}}>
            <label>Platforms</label>
            <div className="grid">
              {['facebook','instagram','linkedin','x'].map(p=> (
                <label key={p}><input type="checkbox" checked={platforms.includes(p)} onChange={e=>{
                  setPlatforms(s=> e.target.checked ? [...s,p] : s.filter(x=>x!==p))
                }} /> {p}</label>
              ))}
            </div>
          </div>
          <button onClick={plan} style={{marginTop:12}}>Generate Week Plan</button>
        </div>
      </div>

      <h3 style={{marginTop:24}}>Activity</h3>
      <ul>
        {log.map((l,i)=>(<li key={i}>{l}</li>))}
      </ul>
    </div>
  )
}

function safeJson(x){ try{ return JSON.parse(x) }catch{ return {} } }
