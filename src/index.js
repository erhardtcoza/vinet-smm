// src/index.js — Social Media Manager API (Cloudflare Workers)

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname, searchParams } = url;

    // CORS preflight
    if (request.method === "OPTIONS") return cors(new Response("ok"));

    try {
      // --- Landing page for root ---
      if (pathname === "/" && request.method === "GET") {
        const html = `<!doctype html>
<html><body style="font-family:system-ui;margin:40px">
  <h2>SMM API</h2>
  <p>API is running.</p>
  <ul>
    <li><a href="/api/health">/api/health</a></li>
    <li>POST /api/company</li>
    <li>GET  /api/company</li>
    <li>POST /api/ingest</li>
    <li>POST /api/plan/week</li>
    <li>POST /api/competitors</li>
    <li>GET  /api/competitors?company_id=1</li>
    <li>GET  /api/seo/audit?company_id=1&url=https://example.com</li>
    <li>POST /api/export/zip</li>
  </ul>
</body></html>`;
        return new Response(html, { headers: { "Content-Type": "text/html" } });
      }

      // --- Health ---
      if (pathname === "/api/health") return ok({ status: "ok" });

      // --- Company: create/update (simple insert for MVP) ---
      if (pathname === "/api/company" && request.method === "POST") {
        const body = await request.json();
        const id = await upsertCompany(env.DB, body);
        return ok({ id });
      }

      // --- Company: get latest (MVP) ---
      if (pathname === "/api/company" && request.method === "GET") {
        const company = await env.DB.prepare(
          "SELECT * FROM company ORDER BY id DESC LIMIT 1"
        ).first();
        return ok({ company });
      }

      // --- Ingest site (sitemap + naive HTML parse) ---
      if (pathname === "/api/ingest" && request.method === "POST") {
        const { company_id, limit = 20 } = await request.json();
        if (!company_id) return bad("company_id required");
        const company = await env.DB.prepare(
          "SELECT * FROM company WHERE id=?"
        )
          .bind(company_id)
          .first();
        if (!company) return bad("company not found");

        const pages = await ingestSite(company.site_url, env, limit);
        const products = extractProducts(pages);

        for (const p of products) {
          await env.DB
            .prepare(
              `INSERT INTO product (company_id, title, url, summary, price, images_json, tags)
               VALUES (?, ?, ?, ?, ?, ?, ?)`
            )
            .bind(
              company_id,
              p.title,
              p.url,
              p.summary,
              p.price ?? null,
              JSON.stringify(p.images || []),
              p.tags?.join(",") || null
            )
            .run();
        }
        return ok({ pages: pages.length, products: products.length });
      }

      // --- Generate weekly plan ---
      if (pathname === "/api/plan/week" && request.method === "POST") {
        const {
          company_id,
          week_start,
          platforms = ["facebook", "instagram", "linkedin", "x"],
        } = await request.json();
        if (!company_id || !week_start)
          return bad("company_id and week_start required");

        const company = await env.DB.prepare(
          "SELECT * FROM company WHERE id=?"
        )
          .bind(company_id)
          .first();
        if (!company) return bad("company not found");

        const prods = await env.DB.prepare(
          "SELECT * FROM product WHERE company_id=? LIMIT 20"
        )
          .bind(company_id)
          .all();

        const planJson = buildWeeklyPlan(
          company,
          prods.results || [],
          platforms
        );

        const { lastInsertRowid } = await env.DB
          .prepare(
            "INSERT INTO content_plan (company_id, week_start, platform, status, json) VALUES (?, ?, ?, ?, ?)"
          )
          .bind(
            company_id,
            week_start,
            "multi",
            "draft",
            JSON.stringify(planJson)
          )
          .run();

        for (const post of planJson.posts) {
          await env.DB
            .prepare(
              "INSERT INTO post (plan_id, platform, caption, hashtags, image_prompt, scheduled_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)"
            )
            .bind(
              lastInsertRowid,
              post.platform,
              post.caption,
              post.hashtags?.join(" "),
              post.image_prompt,
              post.scheduled_at,
              "draft"
            )
            .run();
        }

        return ok({ plan_id: lastInsertRowid, count: planJson.posts.length });
      }

      // --- Competitors add/list ---
      if (pathname === "/api/competitors" && request.method === "POST") {
        const { company_id, competitors = [] } = await request.json();
        if (!company_id) return bad("company_id required");

        for (const c of competitors) {
          await env.DB
            .prepare(
              "INSERT INTO competitor (company_id, name, url, socials_json) VALUES (?, ?, ?, ?)"
            )
            .bind(
              company_id,
              c.name || null,
              c.url,
              JSON.stringify(c.socials || {})
            )
            .run();
        }
        return ok({ added: competitors.length });
      }

      if (pathname === "/api/competitors" && request.method === "GET") {
        const company_id = searchParams.get("company_id");
        if (!company_id) return bad("company_id required");
        const rows = await env.DB.prepare(
          "SELECT * FROM competitor WHERE company_id=?"
        )
          .bind(company_id)
          .all();
        const analysis = await analyzeCompetitors(rows.results || [], env);
        return ok({ competitors: rows.results, analysis });
      }

      // --- SEO audit (on-page quick check) ---
      if (pathname === "/api/seo/audit" && request.method === "GET") {
        const target = searchParams.get("url");
        const company_id = searchParams.get("company_id");
        if (!target || !company_id) return bad("url and company_id required");

        const audit = await auditPage(target);

        await env.DB
          .prepare(
            `INSERT INTO seo_page (company_id, url, title, h1, meta_desc, score, issues_json, last_checked)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(company_id, url) DO UPDATE SET
             title=excluded.title, h1=excluded.h1, meta_desc=excluded.meta_desc, score=excluded.score, issues_json=excluded.issues_json, last_checked=excluded.last_checked`
          )
          .bind(
            company_id,
            target,
            audit.title,
            audit.h1,
            audit.meta_desc,
            audit.score,
            JSON.stringify(audit.issues),
            Math.floor(Date.now() / 1000)
          )
          .run();

        return ok(audit);
      }

      // --- Export CSV to R2 (captions, schedule) ---
      if (pathname === "/api/export/zip" && request.method === "POST") {
        const { plan_id } = await request.json();
        if (!plan_id) return bad("plan_id required");

        const posts = await env.DB.prepare(
          "SELECT * FROM post WHERE plan_id=? ORDER BY scheduled_at"
        )
          .bind(plan_id)
          .all();

        const csv = toCSV(posts.results || []);
        const key = `exports/plan_${plan_id}_${Date.now()}.csv`;
        await env.R2.put(key, csv, {
          httpMetadata: { contentType: "text/csv" },
        });
        return ok({ r2_key: key });
      }
// --- Plans list (latest first) ---
if (pathname === "/api/plans" && request.method === "GET") {
  const company_id = searchParams.get("company_id");
  if (!company_id) return bad("company_id required");
  const rows = await env.DB.prepare(
    "SELECT id, week_start, platform, status FROM content_plan WHERE company_id=? ORDER BY id DESC LIMIT 20"
  ).bind(company_id).all();
  return ok({ plans: rows.results || [] });
}

// --- Posts for a plan ---
if (pathname === "/api/posts" && request.method === "GET") {
  const plan_id = searchParams.get("plan_id");
  if (!plan_id) return bad("plan_id required");
  const rows = await env.DB.prepare(
    "SELECT id, platform, scheduled_at, caption, hashtags, image_prompt, status FROM post WHERE plan_id=? ORDER BY scheduled_at"
  ).bind(plan_id).all();
  return ok({ posts: rows.results || [] });
}

// --- SEO: list audited pages for a company ---
if (pathname === "/api/seo/pages" && request.method === "GET") {
  const company_id = searchParams.get("company_id");
  if (!company_id) return bad("company_id required");
  const rows = await env.DB.prepare(
    "SELECT id, url, title, h1, meta_desc, score, last_checked, issues_json FROM seo_page WHERE company_id=? ORDER BY last_checked DESC NULLS LAST, id DESC LIMIT 100"
  ).bind(company_id).all();
  return ok({ pages: rows.results || [] });
}

      return cors(new Response("Not found", { status: 404 }));
    } catch (e) {
      console.error(e);
      return cors(
        new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        })
      );
    }
  },
};

// ---------- Helpers ----------
function cors(resp) {
  resp.headers.set("Access-Control-Allow-Origin", "*");
  resp.headers.set("Access-Control-Allow-Headers", "*");
  resp.headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  return resp;
}
function ok(json) {
  return cors(
    new Response(JSON.stringify(json), {
      headers: { "Content-Type": "application/json" },
    })
  );
}
function bad(msg) {
  return cors(
    new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  );
}

async function upsertCompany(DB, body) {
  const { name, description, tone, site_url, socials, logo_url, colors } = body;
  const res = await DB
    .prepare(
      `INSERT INTO company (name, description, tone, site_url, socials_json, logo_url, colors_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      name,
      description || null,
      tone || null,
      site_url,
      JSON.stringify(socials || {}),
      logo_url || null,
      JSON.stringify(colors || {})
    )
    .run();
  return res.lastInsertRowid;
}

async function ingestSite(baseUrl, env, limit) {
  const key = `sitemap:${baseUrl}`;
  const cached = await env.CACHE.get(key);
  let urls = [];
  if (cached) {
    urls = JSON.parse(cached);
  } else {
    try {
      const sm = await fetch(new URL("/sitemap.xml", baseUrl));
      if (sm.ok) {
        const xml = await sm.text();
        urls = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)]
          .map((m) => m[1])
          .slice(0, limit);
      }
    } catch {}
    if (!urls.length) urls = [baseUrl];
    await env.CACHE.put(key, JSON.stringify(urls), { expirationTtl: 3600 });
  }

  const pages = [];
  for (const u of urls.slice(0, limit)) {
    try {
      const res = await fetch(u, { headers: { "User-Agent": "SMM/1.0" } });
      if (!res.ok) continue;
      const html = await res.text();
      pages.push({ url: u, html });
    } catch {}
  }
  return pages;
}

function extractProducts(pages) {
  const items = [];
  for (const p of pages) {
    // naive: look for product-like blocks (cards with h2/h3 and links)
    const titles = [...p.html.matchAll(/<(h2|h3)[^>]*>(.*?)<\/\1>/gi)].map((m) =>
      strip(m[2])
    );
    const prices = [...p.html.matchAll(/R\s?\d+[\d\.,]*/gi)].map((m) => m[0]);
    const imgs = [
      ...p.html.matchAll(/<img[^>]*src=["']([^"']+)["']/gi),
    ].map((m) => m[1]);

    if (titles.length) {
      items.push({
        title: titles[0],
        url: p.url,
        summary: summarizeFromHtml(p.html),
        price: prices[0],
        images: imgs.slice(0, 3),
        tags: guessTags(p.html),
      });
    }
  }
  return dedupeBy(items, (x) => `${x.title}|${x.url}`);
}

function buildWeeklyPlan(company, products, platforms) {
  const posts = [];
  const now = new Date();
  for (let d = 0; d < 7; d++) {
    const day = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + d
    )
      .toISOString()
      .slice(0, 10);
    const prod =
      products[d % Math.max(1, products.length)] || {
        title: company.name,
        summary: company.description,
      };
    for (const platform of platforms) {
      posts.push({
        platform,
        scheduled_at: `${day}T09:00:00Z`,
        caption: captionTemplate(platform, prod, company.tone),
        hashtags: baseHashtags(company.name, prod),
        image_prompt: imagePrompt(prod, company),
      });
    }
  }
  return { posts };
}

function captionTemplate(platform, prod, tone) {
  const line = `${prod.title || "Our services"} — ${truncate(
    prod.summary || "",
    140
  )}`;
  const cta = "Chat to us: 021 007 0200 | sales@vinet.co.za";
  return `${line}\n${cta}`.trim();
}

function baseHashtags(name, prod) {
  const tags = ["#Vinet", "#Internet", "#Connectivity", "#Fibre", "#Wireless"];
  if (prod?.tags?.length)
    tags.push(...prod.tags.slice(0, 3).map((t) => `#${t.replace(/\s+/g, "")}`));
  return dedupeBy(tags, (x) => x);
}

function imagePrompt(prod, company) {
  // company.colors_json may be a JSON string; keep generic here
  return `Minimal ad tile for ${company.name}. Headline: ${prod.title}. Colors: brand palette if available. Include logo if available.`;
}

async function analyzeCompetitors(list, env) {
  // Placeholder: returns domain title + crude cadence/topic guesses
  const out = [];
  for (const c of list) {
    try {
      const res = await fetch(c.url);
      const html = await res.text();
      const title = (html.match(/<title>(.*?)<\/title>/i) || [])[1] || "";
      out.push({
        id: c.id,
        url: c.url,
        title,
        cadence_guess: "weekly",
        topic_guess: ["pricing", "coverage", "support"],
      });
    } catch {
      out.push({ id: c.id, url: c.url, error: "fetch_failed" });
    }
  }
  return out;
}

async function auditPage(url) {
  const res = await fetch(url);
  if (!res.ok)
    return { url, score: 0, issues: [{ id: "fetch", msg: `HTTP ${res.status}` }] };

  const html = await res.text();
  const title = (html.match(/<title>(.*?)<\/title>/i) || [])[1] || "";
  const h1 = (html.match(/<h1[^>]*>(.*?)<\/h1>/i) || [])[1] || "";
  const meta_desc =
    (
      html.match(
        /<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i
      ) || []
    )[1] || "";
  const imgAltsMissing = (html.match(/<img\b(?![^>]*alt=)[^>]*>/gi) || []).length;
  const links = (html.match(/<a\b[^>]*href=/gi) || []).length;

  const issues = [];
  if (!title) issues.push({ id: "title", msg: "Missing <title>" });
  if (!h1) issues.push({ id: "h1", msg: "Missing <h1>" });
  if (!meta_desc) issues.push({ id: "meta", msg: "Missing meta description" });
  if (imgAltsMissing > 0)
    issues.push({ id: "img_alt", msg: `${imgAltsMissing} images missing alt` });
  if (links < 5) issues.push({ id: "links", msg: "Low internal link count" });

  const score = Math.max(0, 100 - issues.length * 12);
  return {
    url,
    title: strip(title),
    h1: strip(h1),
    meta_desc: strip(meta_desc),
    score,
    issues,
  };
}

function toCSV(rows) {
  if (!rows.length) return "platform,scheduled_at,caption,hashtags\n";
  const header = Object.keys(rows[0]).join(",");
  const esc = (v) => (v == null ? "" : String(v).replaceAll('"', '""'));
  const lines = rows.map((r) =>
    Object.keys(r)
      .map((k) => `"${esc(r[k])}"`)
      .join(",")
  );
  return header + "\n" + lines.join("\n");
}

// ---- tiny utils ----
function strip(s) {
  return s?.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}
function truncate(s, n) {
  return (s || "").length > n ? s.slice(0, n - 1) + "…" : s || "";
}
function guessTags(html) {
  const tags = [];
  if (/fibre|fiber/i.test(html)) tags.push("fibre");
  if (/wireless|wifi/i.test(html)) tags.push("wireless");
  if (/voip/i.test(html)) tags.push("voip");
  if (/hosting|domain/i.test(html)) tags.push("hosting");
  return tags;
}
function dedupeBy(arr, keyer) {
  const m = new Map();
  for (const x of arr) {
    const k = keyer(x);
    if (!m.has(k)) m.set(k, x);
  }
  return [...m.values()];
}
function summarizeFromHtml(html) {
  // Very naive summary: take first 30–40 words of visible text
  const text = strip(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
  );
  const words = text.split(/\s+/).slice(0, 40).join(" ");
  return words;
}
