- Companies & Brand
CREATE TABLE IF NOT EXISTS company (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  tone TEXT,
  site_url TEXT NOT NULL,
  socials_json TEXT,
  logo_url TEXT,
  colors_json TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);

-- Products crawled or added
CREATE TABLE IF NOT EXISTS product (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  title TEXT,
  url TEXT,
  summary TEXT,
  price TEXT,
  images_json TEXT,
  tags TEXT,
  FOREIGN KEY(company_id) REFERENCES company(id)
);

-- Simple page store for SEO audits
CREATE TABLE IF NOT EXISTS seo_page (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  title TEXT,
  h1 TEXT,
  meta_desc TEXT,
  score INTEGER,
  issues_json TEXT,
  last_checked INTEGER,
  UNIQUE(company_id, url)
);

-- Content plans
CREATE TABLE IF NOT EXISTS content_plan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  week_start TEXT NOT NULL,
  platform TEXT NOT NULL,
  status TEXT DEFAULT 'draft',
  json TEXT NOT NULL
);

-- Individual posts
CREATE TABLE IF NOT EXISTS post (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL,
  platform TEXT NOT NULL,
  caption TEXT,
  hashtags TEXT,
  image_prompt TEXT,
  image_r2_key TEXT,
  scheduled_at TEXT,
  status TEXT DEFAULT 'draft',
  FOREIGN KEY(plan_id) REFERENCES content_plan(id)
);

-- Competitors
CREATE TABLE IF NOT EXISTS competitor (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  name TEXT,
  url TEXT NOT NULL,
  socials_json TEXT
);

-- Event log
CREATE TABLE IF NOT EXISTS event_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER,
  type TEXT,
  payload_json TEXT,
  ts INTEGER DEFAULT (unixepoch())
);
