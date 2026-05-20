const https = require('https');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.NOTION_TOKEN;
const ARTICLES_DB_ID = process.env.NOTION_ARTICLES_DB_ID;
const BIO_PAGE_ID = process.env.NOTION_BIO_PAGE_ID;
const PROJECTS_DB_ID = process.env.NOTION_PROJECTS_DB_ID;

function notionRequest(endpoint, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.notion.com',
      path: `/v1/${endpoint}`,
      method,
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function fetchArticles() {
  const response = await notionRequest(
    `databases/${ARTICLES_DB_ID}/query`,
    'POST',
    { filter: { property: 'Published', checkbox: { equals: true } } }
  );
  if (response.object === 'error') { console.error('Articles DB error:', response.message); return []; }
  const articles = (response.results || []).map(page => {
    const props = page.properties;
    const getText = (p) => p?.rich_text?.[0]?.plain_text || p?.title?.[0]?.plain_text || '';
    return {
      id: page.id,
      title: getText(props.Name || props.제목),
      description: getText(props.Description || props.설명),
      date: (props.Date || props.날짜)?.date?.start || '',
      tags: ((props.Tags || props.태그)?.multi_select || []).map(t => t.name),
      url: (props.URL || props.링크)?.url || '#'
    };
  });
  return articles.sort((a, b) => (b.date > a.date ? 1 : -1));
}

async function fetchProjects() {
  const response = await notionRequest(`databases/${PROJECTS_DB_ID}/query`, 'POST', {});
  if (response.object === 'error') { console.error('Projects DB error:', response.message); return []; }
  return (response.results || []).map(page => {
    const props = page.properties;
    const getText = (p) => p?.rich_text?.[0]?.plain_text || p?.title?.[0]?.plain_text || '';
    return {
      id: page.id,
      name: getText(props.Name || props.이름),
      description: getText(props.Description || props.설명),
      status: (props.Status || props.상태)?.select?.name || '예정',
      stack: ((props.Stack || props.스택)?.multi_select || []).map(t => t.name),
      url: (props.URL || props.링크)?.url || null
    };
  });
}

async function fetchBioBlocks() {
  const response = await notionRequest(`blocks/${BIO_PAGE_ID}/children`);
  if (response.object === 'error') { console.error('Bio page error:', response.message); return {}; }
  const sections = {};
  let currentKey = null;
  for (const block of (response.results || [])) {
    const type = block.type;
    const getText = (richText) => (richText || []).map(r => r.plain_text).join('');
    if (type === 'heading_2' || type === 'heading_3') {
      currentKey = getText(block[type].rich_text);
      sections[currentKey] = [];
    } else if (currentKey) {
      let text = '';
      if (type === 'bulleted_list_item') text = getText(block.bulleted_list_item.rich_text);
      else if (type === 'paragraph') text = getText(block.paragraph.rich_text);
      if (text) sections[currentKey].push(text);
    }
  }
  return sections;
}

async function main() {
  console.log('Notion에서 데이터 가져오는 중...');
  const [articles, projects, bio] = await Promise.all([fetchArticles(), fetchProjects(), fetchBioBlocks()]);
  const data = { articles, projects, bio, updatedAt: new Date().toISOString() };
  const dir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'content.json'), JSON.stringify(data, null, 2), 'utf8');
  console.log(`✅ 완료 — 아티클 ${articles.length}개, 프로젝트 ${projects.length}개 동기화`);
}

main().catch(err => { console.error(err); process.exit(1); });
