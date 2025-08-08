import { useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8787";

export default function App() {
  const [company, setCompany] = useState({
    name: "",
    description: "",
    tone: "",
    site_url: "",
    logo_url: "",
    socials: "",
    colors: "",
  });
  const [companyId, setCompanyId] = useState(null);
  const [week, setWeek] = useState(new Date().toISOString().slice(0, 10));
  const [platforms, setPlatforms] = useState([
    "facebook",
    "instagram",
    "linkedin",
    "x",
  ]);
  const [log, setLog] = useState([]);

  // NEW: state for plans + posts
  const [plans, setPlans] = useState([]);
  const [selectedPlanId, setSelectedPlanId] = useState(null);
  const [posts, setPosts] = useState([]);

  // NEW: SEO
  const [auditUrl, setAuditUrl] = useState("");
  const [seoRows, setSeoRows] = useState([]);

  const push = (m) => setLog((l) => [m, ...l]);

  async function saveCompany() {
    const payload = {
      ...company,
      socials: safeJson(company.socials),
      colors: safeJson(company.colors),
    };
    const r = await fetch(`${API}/api/company`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await r.json();
    setCompanyId(j.id);
    push(`Company saved: ${j.id}`);
  }

  async function ingest() {
    if (!companyId) return alert("Save company first");
    const r = await fetch(`${API}/api/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company_id: companyId, limit: 20 }),
    });
    const j = await r.json();
    push(`Ingested pages=${j.pages} products=${j.products}`);
  }

  async function plan() {
    if (!companyId) return alert("Save company first");
    const r = await fetch(`${API}/api/plan/week`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company_id: companyId,
        week_start: week,
        platforms,
      }),
    });
    const j = await r.json();
    push(`Plan created id=${j.plan_id} posts=${j.count}`);
  }

  // NEW: fetch plans
  async function loadPlans() {
    if (!companyId) return alert("Save company first");
    const r = await fetch(`${API}/api/plans?company_id=${companyId}`);
    const j = await r.json();
    setPlans(j.plans || []);
    push(`Loaded ${j.plans?.length || 0} plans`);
  }

  // NEW: fetch posts for selected plan
  async function loadPosts(planId) {
    setSelectedPlanId(planId);
    const r = await fetch(`${API}/api/posts?plan_id=${planId}`);
    const j = await r.json();
    setPosts(j.posts || []);
  }

  // NEW: run SEO audit on a single URL
  async function runAudit() {
    if (!companyId) return alert("Save company first");
    if (!auditUrl) return alert("Enter a URL to audit");
    const r = await fetch(
      `${API}/api/seo/audit?company_id=${companyId}&url=${encodeURIComponent(auditUrl)}`
    );
    const j = await r.json();
    push(`Audited: ${auditUrl} (score ${j.score})`);
    await loadSeo(); // refresh table
  }

  // NEW: load audited pages table
  async function loadSeo() {
    if (!companyId) return alert("Save company first");
    const r = await fetch(`${API}/api/seo/pages?company_id=${companyId}`);
    const j = await r.json();
    setSeoRows(j.pages || []);
    push(`Loaded SEO rows: ${j.pages?.length || 0}`);
  }

  return (
    <div className="container">
      <h2>Social Media Planner</h2>
      <p className="muted">Setup → Ingest → Plan → View Plans → SEO.</p>

      {/* Company + Ingest + Plan */}
      <div className="row">
        <div>
          <h3>Company</h3>
          <input
            placeholder="Name"
            value={company.name}
            onChange={(e) => setCompany({ ...company, name: e.target.value })}
          />
          <textarea
            placeholder="Description"
            rows={4}
            value={company.description}
            onChange={(e) =>
              setCompany({ ...company, description: e.target.value })
            }
          />
          <input
            placeholder="Tone (e.g., friendly, direct)"
            value={company.tone}
            onChange={(e) => setCompany({ ...company, tone: e.target.value })}
          />
          <input
            placeholder="Website URL"
            value={company.site_url}
            onChange={(e) => setCompany({ ...company, site_url: e.target.value })}
          />
          <input
            placeholder="Logo URL"
            value={company.logo_url}
            onChange={(e) => setCompany({ ...company, logo_url: e.target.value })}
          />
          <textarea
            placeholder='Socials JSON (e.g., {"facebook":"...","instagram":"..."})'
            rows={3}
            value={company.socials}
            onChange={(e) => setCompany({ ...company, socials: e.target.value })}
          />
          <textarea
            placeholder='Colors JSON (e.g., {"primary":"#e2001a"})'
            rows={2}
            value={company.colors}
            onChange={(e) => setCompany({ ...company, colors: e.target.value })}
          />
          <button onClick={saveCompany}>Save Company</button>
        </div>

        <div>
          <h3>Ingest & Plan</h3>
          <button onClick={ingest}>Ingest Website</button>
          <div style={{ marginTop: 12 }}>
            <label>Week start</label>
            <input
              type="date"
              value={week}
              onChange={(e) => setWeek(e.target.value)}
            />
          </div>
          <div style={{ marginTop: 12 }}>
            <label>Platforms</label>
            <div className="grid">
              {["facebook", "instagram", "linkedin", "x"].map((p) => (
                <label key={p}>
                  <input
                    type="checkbox"
                    checked={platforms.includes(p)}
                    onChange={(e) => {
                      setPlatforms((s) =>
                        e.target.checked ? [...s, p] : s.filter((x) => x !== p)
                      );
                    }}
                  />{" "}
                  {p}
                </label>
              ))}
            </div>
          </div>
          <button onClick={plan} style={{ marginTop: 12 }}>
            Generate Week Plan
          </button>
        </div>
      </div>

      {/* NEW: Plans viewer */}
      <h3 style={{ marginTop: 24 }}>Plans</h3>
      <div className="card">
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={loadPlans}>Load Plans</button>
          {plans.length > 0 && (
            <select
              value={selectedPlanId || ""}
              onChange={(e) => loadPosts(Number(e.target.value))}
              style={{ padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
            >
              <option value="" disabled>
                Select plan
              </option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  #{p.id} — {p.week_start} — {p.status}
                </option>
              ))}
            </select>
          )}
        </div>

        {posts.length > 0 && (
          <div style={{ marginTop: 12, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th align="left">Platform</th>
                  <th align="left">Scheduled (UTC)</th>
                  <th align="left">Caption</th>
                  <th align="left">Hashtags</th>
                  <th align="left">Image Prompt</th>
                  <th align="left">Status</th>
                </tr>
              </thead>
              <tbody>
                {posts.map((r) => (
                  <tr key={r.id}>
                    <td>{r.platform}</td>
                    <td>{r.scheduled_at}</td>
                    <td style={{ maxWidth: 360, whiteSpace: "pre-wrap" }}>
                      {r.caption}
                    </td>
                    <td>{r.hashtags}</td>
                    <td style={{ maxWidth: 260, whiteSpace: "pre-wrap" }}>
                      {r.image_prompt}
                    </td>
                    <td>{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* NEW: SEO table */}
      <h3 style={{ marginTop: 24 }}>SEO</h3>
      <div className="card">
        <div style={{ display: "flex", gap: 8 }}>
          <input
            placeholder="https://example.com/page"
            value={auditUrl}
            onChange={(e) => setAuditUrl(e.target.value)}
          />
          <button onClick={runAudit}>Run Audit</button>
          <button onClick={loadSeo}>Refresh Table</button>
        </div>

        {seoRows.length > 0 && (
          <div style={{ marginTop: 12, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th align="left">Score</th>
                  <th align="left">URL</th>
                  <th align="left">Title</th>
                  <th align="left">H1</th>
                  <th align="left">Issues</th>
                  <th align="left">Checked</th>
                </tr>
              </thead>
              <tbody>
                {seoRows.map((r) => {
                  const issues = (() => {
                    try {
                      const arr = JSON.parse(r.issues_json || "[]");
                      return Array.isArray(arr) ? arr.length : 0;
                    } catch {
                      return 0;
                    }
                  })();
                  const dt = r.last_checked
                    ? new Date(r.last_checked * 1000).toISOString()
                    : "";
                  return (
                    <tr key={r.id}>
                      <td>{r.score}</td>
                      <td style={{ maxWidth: 280, wordBreak: "break-all" }}>
                        <a href={r.url} target="_blank" rel="noreferrer">
                          {r.url}
                        </a>
                      </td>
                      <td style={{ maxWidth: 260, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {r.title}
                      </td>
                      <td style={{ maxWidth: 220, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {r.h1}
                      </td>
                      <td>{issues}</td>
                      <td>{dt}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <h3 style={{ marginTop: 24 }}>Activity</h3>
      <ul>
        {log.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
    </div>
  );
}

function safeJson(x) {
  try {
    return JSON.parse(x);
  } catch {
    return {};
  }
}
