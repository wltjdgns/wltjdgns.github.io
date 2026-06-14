const https = require('https');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.NOTION_TOKEN;
const ARTICLES_DB_ID = process.env.NOTION_ARTICLES_DB_ID;
const BIO_PAGE_ID = process.env.NOTION_BIO_PAGE_ID;
const PROJECTS_DB_ID = process.env.NOTION_PROJECTS_DB_ID;

const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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

function richTextToHtml(richText) {
  return (richText || []).map(span => {
    if (span.type === 'equation') {
      return `<span class="math-inline">\\(${span.equation.expression}\\)</span>`;
    }
    let text = esc(span.plain_text);
    if (!text) return '';
    if (span.annotations.bold) text = `<strong>${text}</strong>`;
    if (span.annotations.italic) text = `<em>${text}</em>`;
    if (span.annotations.code) text = `<code>${text}</code>`;
    if (span.annotations.strikethrough) text = `<s>${text}</s>`;
    if (span.annotations.underline) text = `<u>${text}</u>`;
    if (span.href) text = `<a href="${esc(span.href)}" target="_blank" rel="noopener">${text}</a>`;
    return text;
  }).join('');
}

function blocksToHtml(blocks) {
  let html = '';
  let inUl = false, inOl = false;

  for (const block of blocks) {
    const type = block.type;
    if (type !== 'bulleted_list_item' && inUl) { html += '</ul>\n'; inUl = false; }
    if (type !== 'numbered_list_item' && inOl) { html += '</ol>\n'; inOl = false; }

    switch (type) {
      case 'paragraph': {
        const inner = richTextToHtml(block.paragraph.rich_text);
        html += inner ? `<p>${inner}</p>\n` : '<br>\n';
        break;
      }
      case 'heading_1':
        html += `<h1>${richTextToHtml(block.heading_1.rich_text)}</h1>\n`;
        break;
      case 'heading_2':
        html += `<h2>${richTextToHtml(block.heading_2.rich_text)}</h2>\n`;
        break;
      case 'heading_3':
        html += `<h3>${richTextToHtml(block.heading_3.rich_text)}</h3>\n`;
        break;
      case 'bulleted_list_item':
        if (!inUl) { html += '<ul>\n'; inUl = true; }
        html += `  <li>${richTextToHtml(block.bulleted_list_item.rich_text)}</li>\n`;
        break;
      case 'numbered_list_item':
        if (!inOl) { html += '<ol>\n'; inOl = true; }
        html += `  <li>${richTextToHtml(block.numbered_list_item.rich_text)}</li>\n`;
        break;
      case 'code': {
        const lang = block.code.language || '';
        const code = esc((block.code.rich_text || []).map(r => r.plain_text).join(''));
        html += `<pre><code class="lang-${lang}">${code}</code></pre>\n`;
        break;
      }
      case 'quote':
        html += `<blockquote>${richTextToHtml(block.quote.rich_text)}</blockquote>\n`;
        break;
      case 'callout': {
        const icon = block.callout.icon?.emoji || '💡';
        html += `<div class="callout">${icon} ${richTextToHtml(block.callout.rich_text)}</div>\n`;
        break;
      }
      case 'toggle': {
        const summary = richTextToHtml(block.toggle.rich_text);
        const childHtml = block._children ? blocksToHtml(block._children) : '';
        html += `<details><summary>${summary}</summary><div class="toggle-content">${childHtml}</div></details>\n`;
        break;
      }
      case 'divider':
        html += '<hr>\n';
        break;
      case 'image': {
        const imgUrl = block.image.type === 'external'
          ? block.image.external.url
          : block.image.file.url;
        const caption = (block.image.caption || []).map(r => r.plain_text).join('');
        html += `<figure><img src="${esc(imgUrl)}" alt="${esc(caption)}">`;
        if (caption) html += `<figcaption>${esc(caption)}</figcaption>`;
        html += '</figure>\n';
        break;
      }
      case 'equation': {
        const expr = block.equation.expression || '';
        html += `<div class="math-block">\\[${expr}\\]</div>\n`;
        break;
      }
      case 'table': {
        const hasColHeader = block.table.has_column_header;
        const rows = block._children || [];
        html += '<table>\n';
        rows.forEach((row, rowIdx) => {
          html += '<tr>';
          (row.table_row.cells || []).forEach(cell => {
            const tag = (hasColHeader && rowIdx === 0) ? 'th' : 'td';
            html += `<${tag}>${richTextToHtml(cell)}</${tag}>`;
          });
          html += '</tr>\n';
        });
        html += '</table>\n';
        break;
      }
      case 'table_row':
        break;
      case 'child_page': {
        const title = block.child_page.title || '';
        const childBlocks = block._children || [];
        html += `<details class="child-page"><summary>📄 ${esc(title)}</summary>`;
        if (childBlocks.length) {
          html += `<div class="child-page-content">${blocksToHtml(childBlocks)}</div>`;
        }
        html += `</details>\n`;
        break;
      }
      case 'column_list': {
        const columns = block._children || [];
        html += '<div class="column-list">';
        columns.forEach(col => {
          html += `<div class="column">${blocksToHtml(col._children || [])}</div>`;
        });
        html += '</div>\n';
        break;
      }
      case 'column':
        break;
      default:
        break;
    }
  }
  if (inUl) html += '</ul>\n';
  if (inOl) html += '</ol>\n';
  return html;
}

function generateArticlePage(article, contentHtml) {
  const dateStr = article.date
    ? (() => { const [y,m,d] = article.date.split('-'); return `${y}. ${parseInt(m)}. ${parseInt(d)}`; })()
    : '';
  const tags = article.tags.map(t => `<span class="tag">#${esc(t)}</span>`).join('');

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(article.title)} | wltjdgns</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;800&family=IBM+Plex+Sans+KR:wght@200;400;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js" onload="renderMathInElement(document.body,{delimiters:[{left:'\\\\[',right:'\\\\]',display:true},{left:'\\\\(',right:'\\\\)',display:false}]})"></script>
  <style>
    :root { --bg: #050505; --card-bg: #121212; --text: #f0f0f0; --accent: #00d1ff; --secondary: #ff4d4d; --gray: #666; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: var(--bg); color: var(--text); font-family: 'Inter', 'IBM Plex Sans KR', sans-serif; line-height: 1.8; word-break: keep-all; }
    .container { max-width: 720px; margin: 0 auto; padding: 0 2rem; }
    nav { padding: 2rem 0; border-bottom: 1px solid #222; margin-bottom: 4rem; }
    nav a { color: var(--gray); text-decoration: none; font-size: 0.9rem; transition: color 0.2s; }
    nav a:hover { color: var(--text); }
    .back-arrow { margin-right: 0.4rem; }
    header { margin-bottom: 3rem; }
    .meta { display: flex; align-items: center; gap: 1rem; margin-bottom: 1.2rem; flex-wrap: wrap; }
    .date { font-size: 0.82rem; color: var(--gray); font-family: 'Inter'; }
    .tag { font-size: 0.72rem; padding: 0.15rem 0.6rem; border-radius: 10px; background: #1a1a1a; color: #888; border: 1px solid #2a2a2a; }
    h1.article-title { font-size: clamp(1.8rem, 5vw, 2.8rem); font-weight: 800; line-height: 1.2; letter-spacing: -1.5px; margin-bottom: 1rem; }
    .divider { height: 1px; background: #1e1e1e; margin: 3rem 0; }
    .content p { margin-bottom: 1.4rem; color: #ccc; font-weight: 300; }
    .content h1 { font-size: 1.8rem; font-weight: 700; margin: 2.5rem 0 1rem; letter-spacing: -1px; }
    .content h2 { font-size: 1.4rem; font-weight: 700; margin: 2rem 0 0.8rem; letter-spacing: -0.5px; border-left: 3px solid var(--accent); padding-left: 0.8rem; }
    .content h3 { font-size: 1.1rem; font-weight: 600; margin: 1.5rem 0 0.6rem; color: #ddd; }
    .content ul, .content ol { margin: 0 0 1.4rem 1.5rem; color: #ccc; }
    .content li { margin-bottom: 0.4rem; font-weight: 300; }
    .content pre { background: #0e0e0e; border: 1px solid #222; border-radius: 10px; padding: 1.4rem; overflow-x: auto; margin-bottom: 1.4rem; }
    .content code { font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 0.88rem; color: var(--accent); }
    .content pre code { color: #e0e0e0; }
    .content blockquote { border-left: 3px solid #333; padding-left: 1.2rem; color: #888; font-style: italic; margin-bottom: 1.4rem; }
    .content hr { border: none; border-top: 1px solid #1e1e1e; margin: 2rem 0; }
    .content figure { margin-bottom: 1.4rem; }
    .content img { max-width: 100%; border-radius: 10px; }
    .content figcaption { font-size: 0.8rem; color: var(--gray); text-align: center; margin-top: 0.5rem; }
    .content a { color: var(--accent); text-decoration: none; }
    .content a:hover { text-decoration: underline; }
    .content strong { font-weight: 700; color: var(--text); }
    .content .callout { background: #111; border: 1px solid #2a2a2a; border-radius: 10px; padding: 1rem 1.2rem; margin-bottom: 1.4rem; color: #ccc; }
    .content s { color: var(--gray); }
    .content details { border: 1px solid #2a2a2a; border-radius: 8px; margin-bottom: 1rem; overflow: hidden; }
    .content details summary { padding: 0.8rem 1rem; cursor: pointer; font-weight: 500; color: #ddd; list-style: none; display: flex; align-items: center; gap: 0.5rem; }
    .content details summary::before { content: '▶'; font-size: 0.65rem; color: var(--accent); transition: transform 0.2s; flex-shrink: 0; }
    .content details[open] summary::before { transform: rotate(90deg); }
    .content details summary:hover { background: #111; }
    .content .toggle-content { padding: 0.2rem 1rem 0.8rem 2rem; border-top: 1px solid #1e1e1e; }
    .content table { width: 100%; border-collapse: collapse; margin-bottom: 1.4rem; font-size: 0.9rem; }
    .content th, .content td { border: 1px solid #2a2a2a; padding: 0.6rem 0.8rem; text-align: left; }
    .content th { background: #1a1a1a; font-weight: 600; color: var(--text); }
    .content td { color: #ccc; }
    .content details.child-page { border: 1px solid #2a2a2a; border-radius: 8px; margin-bottom: 1rem; overflow: hidden; }
    .content details.child-page summary { padding: 0.8rem 1rem; cursor: pointer; font-weight: 500; color: #ddd; list-style: none; display: flex; align-items: center; gap: 0.5rem; }
    .content details.child-page summary::before { content: '▶'; font-size: 0.65rem; color: var(--accent); transition: transform 0.2s; flex-shrink: 0; }
    .content details.child-page[open] summary::before { transform: rotate(90deg); }
    .content details.child-page summary:hover { background: #111; }
    .content .child-page-content { padding: 0.2rem 1rem 0.8rem 2rem; border-top: 1px solid #1e1e1e; }
    .content .column-list { display: flex; gap: 1.5rem; margin-bottom: 1.4rem; }
    .content .column { flex: 1; min-width: 0; }
    .content .math-block { overflow-x: auto; margin-bottom: 1.4rem; }
    @media (max-width: 600px) { .content .column-list { flex-direction: column; } }
    footer { padding: 4rem 0; border-top: 1px solid #222; color: #444; font-size: 0.8rem; margin-top: 4rem; }
  </style>
</head>
<body>
  <div class="container">
    <nav>
      <a href="/"><span class="back-arrow">←</span> wltjdgns.log</a>
    </nav>
    <header>
      <div class="meta">
        <span class="date">${dateStr}</span>
        ${tags}
      </div>
      <h1 class="article-title">${esc(article.title)}</h1>
    </header>
    <div class="divider"></div>
    <div class="content">
      ${contentHtml || '<p style="color:#555">내용이 없습니다.</p>'}
    </div>
    <footer>
      <p>&copy; 2026 wltjdgns. Recorded with curiosity.</p>
    </footer>
  </div>
</body>
</html>`;
}

async function fetchBlocksRecursively(blockId) {
  const response = await notionRequest(`blocks/${blockId}/children`);
  if (response.object === 'error') return [];
  const blocks = response.results || [];
  for (const block of blocks) {
    if (block.has_children) {
      block._children = await fetchBlocksRecursively(block.id);
    }
  }
  return blocks;
}

async function fetchArticleBlocks(pageId) {
  return fetchBlocksRecursively(pageId);
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
    const getText = p => p?.rich_text?.[0]?.plain_text || p?.title?.[0]?.plain_text || '';
    const slug = getText(props.Slug || props.slug) || null;
    return {
      id: page.id,
      slug,
      title: getText(props.Name || props.제목),
      description: getText(props.Description || props.설명),
      date: (props.Date || props.날짜)?.date?.start || '',
      tags: ((props.Tags || props.태그)?.multi_select || []).map(t => t.name),
      url: slug ? `/articles/${slug}.html` : '#'
    };
  });
  return articles.sort((a, b) => (b.date > a.date ? 1 : -1));
}

async function fetchProjects() {
  const response = await notionRequest(`databases/${PROJECTS_DB_ID}/query`, 'POST', {});
  if (response.object === 'error') { console.error('Projects DB error:', response.message); return []; }
  return (response.results || []).map(page => {
    const props = page.properties;
    const getText = p => p?.rich_text?.[0]?.plain_text || p?.title?.[0]?.plain_text || '';
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
    const getText = rt => (rt || []).map(r => r.plain_text).join('');
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

  // 아티클 페이지 생성
  const articlesDir = path.join(__dirname, '..', 'articles');
  if (!fs.existsSync(articlesDir)) fs.mkdirSync(articlesDir, { recursive: true });

  let generatedCount = 0;
  for (const article of articles) {
    if (!article.slug) continue;
    const blocks = await fetchArticleBlocks(article.id);
    const contentHtml = blocksToHtml(blocks);
    const html = generateArticlePage(article, contentHtml);
    fs.writeFileSync(path.join(articlesDir, `${article.slug}.html`), html, 'utf8');
    generatedCount++;
    console.log(`  📄 생성: articles/${article.slug}.html`);
  }

  // content.json 저장
  const data = { articles, projects, bio, updatedAt: new Date().toISOString() };
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'content.json'), JSON.stringify(data, null, 2), 'utf8');

  console.log(`✅ 완료 — 아티클 ${articles.length}개 (페이지 ${generatedCount}개 생성), 프로젝트 ${projects.length}개`);
}

main().catch(err => { console.error(err); process.exit(1); });
