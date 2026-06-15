const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.NOTION_TOKEN;
const LAB_DB_ID = process.env.NOTION_LAB_DB_ID;
const LAB_PASSWORD = process.env.LAB_PASSWORD;

function notionRequest(endpoint, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.notion.com',
      path: `/v1/${endpoint}`,
      method,
      headers: {
        'Authorization': 'Bearer ' + TOKEN,
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

const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function richTextToHtml(richText) {
  return (richText || []).map(span => {
    if (span.type === 'equation') {
      return '<span class="math-inline">\\(' + span.equation.expression + '\\)</span>';
    }
    let text = esc(span.plain_text);
    if (!text) return '';
    if (span.annotations.bold) text = '<strong>' + text + '</strong>';
    if (span.annotations.italic) text = '<em>' + text + '</em>';
    if (span.annotations.code) text = '<code>' + text + '</code>';
    if (span.annotations.strikethrough) text = '<s>' + text + '</s>';
    if (span.annotations.underline) text = '<u>' + text + '</u>';
    if (span.href) text = '<a href="' + esc(span.href) + '" target="_blank" rel="noopener">' + text + '</a>';
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
        html += inner ? '<p>' + inner + '</p>\n' : '<br>\n';
        break;
      }
      case 'heading_1': {
        const hText = richTextToHtml(block.heading_1.rich_text);
        if (block.heading_1.is_toggleable) {
          const childHtml = block._children ? blocksToHtml(block._children) : '';
          html += '<details class="toggle-heading"><summary><h1>' + hText + '</h1></summary>' +
            '<div class="toggle-content">' + childHtml + '</div></details>\n';
        } else {
          html += '<h1>' + hText + '</h1>\n';
        }
        break;
      }
      case 'heading_2': {
        const hText = richTextToHtml(block.heading_2.rich_text);
        if (block.heading_2.is_toggleable) {
          const childHtml = block._children ? blocksToHtml(block._children) : '';
          html += '<details class="toggle-heading"><summary><h2>' + hText + '</h2></summary>' +
            '<div class="toggle-content">' + childHtml + '</div></details>\n';
        } else {
          html += '<h2>' + hText + '</h2>\n';
        }
        break;
      }
      case 'heading_3': {
        const hText = richTextToHtml(block.heading_3.rich_text);
        if (block.heading_3.is_toggleable) {
          const childHtml = block._children ? blocksToHtml(block._children) : '';
          html += '<details class="toggle-heading"><summary><h3>' + hText + '</h3></summary>' +
            '<div class="toggle-content">' + childHtml + '</div></details>\n';
        } else {
          html += '<h3>' + hText + '</h3>\n';
        }
        break;
      }
      case 'bulleted_list_item':
        if (!inUl) { html += '<ul>\n'; inUl = true; }
        html += '  <li>' + richTextToHtml(block.bulleted_list_item.rich_text) + '</li>\n';
        break;
      case 'numbered_list_item':
        if (!inOl) { html += '<ol>\n'; inOl = true; }
        html += '  <li>' + richTextToHtml(block.numbered_list_item.rich_text) + '</li>\n';
        break;
      case 'code': {
        const lang = block.code.language || '';
        const code = esc((block.code.rich_text || []).map(r => r.plain_text).join(''));
        html += '<pre><code class="lang-' + lang + '">' + code + '</code></pre>\n';
        break;
      }
      case 'quote': html += '<blockquote>' + richTextToHtml(block.quote.rich_text) + '</blockquote>\n'; break;
      case 'callout': {
        const icon = block.callout.icon && block.callout.icon.emoji ? block.callout.icon.emoji : '💡';
        html += '<div class="callout">' + icon + ' ' + richTextToHtml(block.callout.rich_text) + '</div>\n';
        break;
      }
      case 'toggle': {
        const summary = richTextToHtml(block.toggle.rich_text);
        const childHtml = block._children ? blocksToHtml(block._children) : '';
        html += '<details><summary>' + summary + '</summary>' +
          '<div class="toggle-content">' + childHtml + '</div></details>\n';
        break;
      }
      case 'divider': html += '<hr>\n'; break;
      case 'image': {
        const imgUrl = block.image.type === 'external'
          ? block.image.external.url : block.image.file.url;
        const caption = (block.image.caption || []).map(r => r.plain_text).join('');
        html += '<figure><img src="' + esc(imgUrl) + '" alt="' + esc(caption) + '">';
        if (caption) html += '<figcaption>' + esc(caption) + '</figcaption>';
        html += '</figure>\n';
        break;
      }
      case 'equation': {
        const expr = block.equation.expression || '';
        html += '<div class="math-block">\\[' + expr + '\\]</div>\n';
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
            html += '<' + tag + '>' + richTextToHtml(cell) + '</' + tag + '>';
          });
          html += '</tr>\n';
        });
        html += '</table>\n';
        break;
      }
      case 'table_row': break;
      case 'child_page': {
        const title = block.child_page.title || '';
        const childBlocks = block._children || [];
        html += '<details class="child-page"><summary>📄 ' + esc(title) + '</summary>';
        if (childBlocks.length) {
          html += '<div class="child-page-content">' + blocksToHtml(childBlocks) + '</div>';
        }
        html += '</details>\n';
        break;
      }
      case 'column_list': {
        const columns = block._children || [];
        html += '<div class="column-list">';
        columns.forEach(col => {
          html += '<div class="column">' + blocksToHtml(col._children || []) + '</div>';
        });
        html += '</div>\n';
        break;
      }
      case 'column': break;
      case 'child_database': {
        const dbTitle = (block.child_database && block.child_database.title) || 'Database';
        const dbRows = block._dbRows || [];
        const dbSchema = block._dbSchema;
        if (!dbRows.length) {
          html += '<div class="callout">📊 ' + esc(dbTitle) + '</div>\n';
          break;
        }
        // 컬럼 순서: title 타입 먼저, 나머지는 스키마 순
        const schema = dbSchema ? dbSchema.properties : {};
        const cols = Object.keys(schema).sort((a, b) => {
          if (schema[a].type === 'title') return -1;
          if (schema[b].type === 'title') return 1;
          return 0;
        });
        const getPropText = (prop) => {
          if (!prop) return '';
          const t = prop.type;
          if (t === 'title') return (prop.title || []).map(r => r.plain_text).join('');
          if (t === 'rich_text') return (prop.rich_text || []).map(r => r.plain_text).join('');
          if (t === 'number') return prop.number !== null ? String(prop.number) : '';
          if (t === 'select') return prop.select ? prop.select.name : '';
          if (t === 'multi_select') return (prop.multi_select || []).map(s => s.name).join(', ');
          if (t === 'checkbox') return prop.checkbox ? '✅' : '❌';
          if (t === 'date') return prop.date ? prop.date.start : '';
          if (t === 'url') return prop.url || '';
          if (t === 'email') return prop.email || '';
          if (t === 'phone_number') return prop.phone_number || '';
          if (t === 'formula') return prop.formula ? String(prop.formula.string || prop.formula.number || '') : '';
          if (t === 'files') return (prop.files || []).map(function(f) { return f.type === 'external' ? f.external.url : (f.file ? f.file.url : ''); }).filter(Boolean).join(', ');
          if (t === 'relation') return '';
          if (t === 'rollup') return prop.rollup ? String(prop.rollup.number || '') : '';
          if (t === 'status') return prop.status ? prop.status.name : '';
          return '';
        };
        html += '<div class="db-title">📊 ' + esc(dbTitle) + '</div>\n';
        html += '<table>\n';
        if (cols.length) {
          html += '<thead><tr>';
          cols.forEach(c => { html += '<th>' + esc(c) + '</th>'; });
          html += '</tr></thead>\n';
        }
        html += '<tbody>\n';
        dbRows.forEach(row => {
          html += '<tr>';
          cols.forEach(c => {
            const cellText = esc(getPropText(row.properties[c]));
            if (schema[c] && schema[c].type === 'title' && row._pagePath && cellText) {
              html += '<td><a href="' + esc(row._pagePath) + '">' + cellText + '</a></td>';
            } else {
              html += '<td>' + cellText + '</td>';
            }
          });
          html += '</tr>\n';
        });
        html += '</tbody></table>\n';
        break;
      }
      default: break;
    }
  }
  if (inUl) html += '</ul>\n';
  if (inOl) html += '</ol>\n';
  return html;
}

async function fetchBlocksRecursively(blockId) {
  let allBlocks = [];
  let cursor = null;
  do {
    const endpoint = 'blocks/' + blockId + '/children' +
      (cursor ? '?start_cursor=' + encodeURIComponent(cursor) : '');
    const response = await notionRequest(endpoint);
    if (response.object === 'error') break;
    allBlocks = allBlocks.concat(response.results || []);
    cursor = response.has_more ? response.next_cursor : null;
  } while (cursor);
  for (const block of allBlocks) {
    if (block.type === 'child_database') {
      const schema = await notionRequest('databases/' + block.id);
      if (schema.object !== 'error') block._dbSchema = schema;
      const rows = await notionRequest('databases/' + block.id + '/query', 'POST', {});
      if (rows.object !== 'error') {
        block._dbRows = rows.results || [];
        for (const row of block._dbRows) {
          row._pageBlocks = await fetchBlocksRecursively(row.id);
        }
      }
    } else if (block.has_children) {
      block._children = await fetchBlocksRecursively(block.id);
    }
  }
  return allBlocks;
}

async function fetchLabEntries() {
  if (!LAB_DB_ID) { console.error('NOTION_LAB_DB_ID 환경변수가 없습니다.'); return []; }
  const response = await notionRequest('databases/' + LAB_DB_ID + '/query', 'POST', {
    filter: { property: 'Published', checkbox: { equals: true } },
    sorts: [{ property: 'Date', direction: 'descending' }]
  });
  if (response.object === 'error') { console.error('Lab DB error:', response.message); return []; }

  const entries = [];
  for (const page of (response.results || [])) {
    const props = page.properties;
    const getText = p => p && p.rich_text && p.rich_text[0] ? p.rich_text[0].plain_text
      : (p && p.title && p.title[0] ? p.title[0].plain_text : '');
    const title = getText(props.Name || props['제목']);
    const description = getText(props.Description || props['설명']);
    const date = (props.Date || props['날짜']) && (props.Date || props['날짜']).date
      ? (props.Date || props['날짜']).date.start : '';
    const tags = ((props.Tags || props['태그']) && (props.Tags || props['태그']).multi_select || []).map(t => t.name);
    const slug = getText(props.Slug || props['slug']) || null;

    const blocks = await fetchBlocksRecursively(page.id);

    entries.push({ id: page.id, slug, title, description, date, tags, blocks });
    console.log('  📓 처리: ' + title);
  }
  return entries;
}

function encryptData(plaintext, password) {
  const salt = crypto.randomBytes(32);
  const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    data: encrypted.toString('hex'),
    tag: tag.toString('hex')
  };
}

// 개별 연구기록 페이지 HTML 생성 (암호화된 내용 인라인 삽입)
function generateLabEntryPage(entryEncrypted) {
  const encStr = JSON.stringify(entryEncrypted);
  return '<!DOCTYPE html>\n' +
'<html lang="ko">\n' +
'<head>\n' +
'  <meta charset="UTF-8">\n' +
'  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
'  <title>연구기록 | wltjdgns</title>\n' +
'  <meta name="robots" content="noindex, nofollow">\n' +
'  <link rel="preconnect" href="https://fonts.googleapis.com">\n' +
'  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
'  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;800&family=IBM+Plex+Sans+KR:wght@200;400;600&display=swap" rel="stylesheet">\n' +
'  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">\n' +
'  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>\n' +
'  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js" onload="renderMathInElement(document.body,{delimiters:[{left:\'\\\\[\',right:\'\\\\]\',display:true},{left:\'\\\\(\',right:\'\\\\)\',display:false}]})"></script>\n' +
'  <style>\n' +
'    :root { --bg: #050505; --card-bg: #121212; --text: #f0f0f0; --accent: #00d1ff; --secondary: #ff4d4d; --gray: #666; }\n' +
'    * { margin: 0; padding: 0; box-sizing: border-box; }\n' +
'    body { background: var(--bg); color: var(--text); font-family: \'Inter\', \'IBM Plex Sans KR\', sans-serif; line-height: 1.8; word-break: keep-all; }\n' +
'    .container { max-width: 720px; margin: 0 auto; padding: 0 2rem; }\n' +
'    nav { padding: 2rem 0; border-bottom: 1px solid #222; margin-bottom: 4rem; display: flex; gap: 2rem; align-items: center; }\n' +
'    nav a { color: var(--gray); text-decoration: none; font-size: 0.9rem; transition: color 0.2s; }\n' +
'    nav a:hover { color: var(--text); }\n' +
'    #lock-screen { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 60vh; gap: 1.5rem; text-align: center; }\n' +
'    .lock-icon { font-size: 3rem; }\n' +
'    .lock-title { font-size: 1.8rem; font-weight: 800; letter-spacing: -1px; }\n' +
'    .lock-sub { color: var(--gray); font-size: 0.9rem; }\n' +
'    .pw-form { display: flex; gap: 0.5rem; }\n' +
'    #pw-input { background: var(--card-bg); border: 1px solid #333; border-radius: 8px; color: var(--text); font-family: inherit; font-size: 1rem; padding: 0.75rem 1.2rem; outline: none; transition: border-color 0.2s; width: 260px; }\n' +
'    #pw-input:focus { border-color: var(--accent); }\n' +
'    #pw-input.error { border-color: var(--secondary); animation: shake 0.3s ease; }\n' +
'    @keyframes shake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-6px)} 75%{transform:translateX(6px)} }\n' +
'    .btn-unlock { background: var(--accent); color: var(--bg); border: none; padding: 0.75rem 1.4rem; border-radius: 8px; font-weight: 700; font-size: 0.95rem; cursor: pointer; transition: opacity 0.2s; font-family: inherit; }\n' +
'    .btn-unlock:hover { opacity: 0.85; }\n' +
'    .btn-unlock:disabled { opacity: 0.5; cursor: not-allowed; }\n' +
'    #lock-error { color: var(--secondary); font-size: 0.85rem; min-height: 1.2em; }\n' +
'    #article-content { display: none; }\n' +
'    header { margin-bottom: 3rem; }\n' +
'    .meta { display: flex; align-items: center; gap: 1rem; margin-bottom: 1.2rem; flex-wrap: wrap; }\n' +
'    .date { font-size: 0.82rem; color: var(--gray); font-family: \'Inter\'; }\n' +
'    .tag { font-size: 0.72rem; padding: 0.15rem 0.6rem; border-radius: 10px; background: #1a1a1a; color: #888; border: 1px solid #2a2a2a; }\n' +
'    h1.article-title { font-size: clamp(1.8rem, 5vw, 2.8rem); font-weight: 800; line-height: 1.2; letter-spacing: -1.5px; margin-bottom: 1rem; }\n' +
'    .divider { height: 1px; background: #1e1e1e; margin: 3rem 0; }\n' +
'    .content p { margin-bottom: 1.4rem; color: #ccc; font-weight: 300; }\n' +
'    .content h1 { font-size: 1.8rem; font-weight: 700; margin: 2.5rem 0 1rem; letter-spacing: -1px; }\n' +
'    .content h2 { font-size: 1.4rem; font-weight: 700; margin: 2rem 0 0.8rem; border-left: 3px solid var(--accent); padding-left: 0.8rem; }\n' +
'    .content h3 { font-size: 1.1rem; font-weight: 600; margin: 1.5rem 0 0.6rem; color: #ddd; }\n' +
'    .content ul, .content ol { margin: 0 0 1.4rem 1.5rem; color: #ccc; }\n' +
'    .content li { margin-bottom: 0.4rem; font-weight: 300; }\n' +
'    .content pre { background: #0e0e0e; border: 1px solid #222; border-radius: 10px; padding: 1.4rem; overflow-x: auto; margin-bottom: 1.4rem; }\n' +
'    .content code { font-family: \'JetBrains Mono\', \'Fira Code\', monospace; font-size: 0.88rem; color: var(--accent); }\n' +
'    .content pre code { color: #e0e0e0; }\n' +
'    .content blockquote { border-left: 3px solid #333; padding-left: 1.2rem; color: #888; font-style: italic; margin-bottom: 1.4rem; }\n' +
'    .content hr { border: none; border-top: 1px solid #1e1e1e; margin: 2rem 0; }\n' +
'    .content figure { margin-bottom: 1.4rem; }\n' +
'    .content img { max-width: 100%; border-radius: 10px; }\n' +
'    .content figcaption { font-size: 0.8rem; color: var(--gray); text-align: center; margin-top: 0.5rem; }\n' +
'    .content a { color: var(--accent); text-decoration: none; }\n' +
'    .content a:hover { text-decoration: underline; }\n' +
'    .content strong { font-weight: 700; color: var(--text); }\n' +
'    .content .callout { background: #111; border: 1px solid #2a2a2a; border-radius: 10px; padding: 1rem 1.2rem; margin-bottom: 1.4rem; color: #ccc; }\n' +
'    .content .db-title { font-weight: 600; color: #ddd; margin-bottom: 0.5rem; font-size: 0.95rem; }\n' +
'    .content table { width: 100%; border-collapse: collapse; margin-bottom: 1.4rem; font-size: 0.9rem; }\n' +
'    .content th, .content td { border: 1px solid #2a2a2a; padding: 0.6rem 0.8rem; text-align: left; }\n' +
'    .content th { background: #1a1a1a; font-weight: 600; color: var(--text); }\n' +
'    .content td { color: #ccc; }\n' +
'    .content details.toggle-heading { margin-bottom: 1rem; }\n' +
'    .content details.toggle-heading summary { cursor: pointer; list-style: none; display: flex; align-items: center; gap: 0.5rem; }\n' +
'    .content details.toggle-heading summary::before { content: \'▶\'; font-size: 0.65rem; color: var(--accent); transition: transform 0.2s; flex-shrink: 0; }\n' +
'    .content details.toggle-heading[open] summary::before { transform: rotate(90deg); }\n' +
'    .content details.toggle-heading summary h1,\n' +
'    .content details.toggle-heading summary h2,\n' +
'    .content details.toggle-heading summary h3 { margin: 0; display: inline; }\n' +
'    .content details.toggle-heading .toggle-content { padding-left: 1.2rem; border-left: 2px solid #2a2a2a; margin-top: 0.5rem; }\n' +
'    .content details.child-page { border: 1px solid #2a2a2a; border-radius: 8px; margin-bottom: 1rem; overflow: hidden; }\n' +
'    .content details.child-page summary { padding: 0.8rem 1rem; cursor: pointer; font-weight: 500; color: #ddd; list-style: none; display: flex; align-items: center; gap: 0.5rem; }\n' +
'    .content details.child-page summary::before { content: \'▶\'; font-size: 0.65rem; color: var(--accent); transition: transform 0.2s; flex-shrink: 0; }\n' +
'    .content details.child-page[open] summary::before { transform: rotate(90deg); }\n' +
'    .content details.child-page summary:hover { background: #111; }\n' +
'    .content .child-page-content { padding: 0.2rem 1rem 0.8rem 2rem; border-top: 1px solid #1e1e1e; }\n' +
'    .content .column-list { display: flex; gap: 1.5rem; margin-bottom: 1.4rem; }\n' +
'    .content .column { flex: 1; min-width: 0; }\n' +
'    .content .math-block { overflow-x: auto; margin-bottom: 1.4rem; }\n' +
'    @media (max-width: 600px) { .content .column-list { flex-direction: column; } }\n' +
'    footer { padding: 4rem 0; border-top: 1px solid #222; color: #444; font-size: 0.8rem; margin-top: 4rem; }\n' +
'  </style>\n' +
'</head>\n' +
'<body>\n' +
'  <div class="container">\n' +
'    <nav>\n' +
'      <a href="/">← WLTJDGNS.LOG</a>\n' +
'      <a href="/lab/">연구기록</a>\n' +
'    </nav>\n' +
'\n' +
'    <div id="lock-screen">\n' +
'      <div class="lock-icon">🔒</div>\n' +
'      <h1 class="lock-title">연구기록</h1>\n' +
'      <p class="lock-sub">비공개 영역입니다. 비밀번호를 입력하세요.</p>\n' +
'      <div class="pw-form">\n' +
'        <input type="password" id="pw-input" placeholder="비밀번호" autocomplete="current-password">\n' +
'        <button class="btn-unlock" id="btn-unlock" onclick="unlock()">열기</button>\n' +
'      </div>\n' +
'      <p id="lock-error"></p>\n' +
'    </div>\n' +
'\n' +
'    <div id="article-content">\n' +
'      <header>\n' +
'        <div class="meta">\n' +
'          <span class="date" id="entry-date"></span>\n' +
'          <div id="entry-tags"></div>\n' +
'        </div>\n' +
'        <h1 class="article-title" id="entry-title"></h1>\n' +
'      </header>\n' +
'      <div class="divider"></div>\n' +
'      <div class="content" id="entry-body"></div>\n' +
'    </div>\n' +
'\n' +
'    <footer><p>&copy; 2026 wltjdgns. Recorded with curiosity.</p></footer>\n' +
'  </div>\n' +
'\n' +
'  <script>\n' +
'    var ENCRYPTED = ' + encStr + ';\n' +
'\n' +
'    function hexToBytes(hex) {\n' +
'      var arr = new Uint8Array(hex.length / 2);\n' +
'      for (var i = 0; i < hex.length; i += 2) arr[i / 2] = parseInt(hex.slice(i, i + 2), 16);\n' +
'      return arr;\n' +
'    }\n' +
'\n' +
'    function deriveKey(password, salt) {\n' +
'      var enc = new TextEncoder();\n' +
'      return crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"])\n' +
'        .then(function(km) {\n' +
'          return crypto.subtle.deriveKey(\n' +
'            { name: "PBKDF2", salt: salt, iterations: 100000, hash: "SHA-256" },\n' +
'            km,\n' +
'            { name: "AES-GCM", length: 256 },\n' +
'            false, ["decrypt"]\n' +
'          );\n' +
'        });\n' +
'    }\n' +
'\n' +
'    function decryptData(encObj, password) {\n' +
'      var salt = hexToBytes(encObj.salt);\n' +
'      var iv = hexToBytes(encObj.iv);\n' +
'      var data = hexToBytes(encObj.data);\n' +
'      var tag = hexToBytes(encObj.tag);\n' +
'      var combined = new Uint8Array(data.length + tag.length);\n' +
'      combined.set(data); combined.set(tag, data.length);\n' +
'      return deriveKey(password, salt).then(function(key) {\n' +
'        return crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, key, combined);\n' +
'      }).then(function(dec) {\n' +
'        return new TextDecoder().decode(dec);\n' +
'      });\n' +
'    }\n' +
'\n' +
'    function formatDate(d) {\n' +
'      if (!d) return "";\n' +
'      var parts = d.split("-");\n' +
'      return parts[0] + ". " + parseInt(parts[1]) + ". " + parseInt(parts[2]);\n' +
'    }\n' +
'\n' +
'    function renderEntry(entry) {\n' +
'      document.getElementById("entry-date").textContent = formatDate(entry.date);\n' +
'      document.getElementById("entry-tags").innerHTML = entry.tags.map(function(t) { return \'<span class="tag">#\' + t + "</span>"; }).join("");\n' +
'      document.getElementById("entry-title").textContent = entry.title;\n' +
'      document.getElementById("entry-body").innerHTML = entry.contentHtml || \'<p style="color:#555">내용이 없습니다.</p>\';\n' +
'      document.getElementById("lock-screen").style.display = "none";\n' +
'      document.getElementById("article-content").style.display = "block";\n' +
'    }\n' +
'\n' +
'    function unlock() {\n' +
'      var pw = document.getElementById("pw-input").value;\n' +
'      var errEl = document.getElementById("lock-error");\n' +
'      var btn = document.getElementById("btn-unlock");\n' +
'      var input = document.getElementById("pw-input");\n' +
'      if (!pw) return;\n' +
'      btn.disabled = true;\n' +
'      btn.textContent = "복호화 중...";\n' +
'      errEl.textContent = "";\n' +
'      input.classList.remove("error");\n' +
'      decryptData(ENCRYPTED, pw).then(function(plaintext) {\n' +
'        var entry = JSON.parse(plaintext);\n' +
'        renderEntry(entry);\n' +
'        sessionStorage.setItem("lab_pw", pw);\n' +
'      }).catch(function() {\n' +
'        input.classList.add("error");\n' +
'        errEl.textContent = "비밀번호가 올바르지 않습니다.";\n' +
'        btn.disabled = false;\n' +
'        btn.textContent = "열기";\n' +
'        input.value = "";\n' +
'        input.focus();\n' +
'      });\n' +
'    }\n' +
'\n' +
'    document.getElementById("pw-input").addEventListener("keydown", function(e) {\n' +
'      if (e.key === "Enter") unlock();\n' +
'    });\n' +
'\n' +
'    var saved = sessionStorage.getItem("lab_pw");\n' +
'    if (saved) { document.getElementById("pw-input").value = saved; unlock(); }\n' +
'  </script>\n' +
'</body>\n' +
'</html>';
}

async function main() {
  if (!LAB_PASSWORD) { console.error('LAB_PASSWORD 환경변수가 없습니다.'); process.exit(1); }
  console.log('연구기록 데이터 가져오는 중...');
  const entries = await fetchLabEntries();

  const labDir = path.join(__dirname, '..', 'lab');
  if (!fs.existsSync(labDir)) fs.mkdirSync(labDir, { recursive: true });

  const metaList = [];
  // DB 행 title 추출 헬퍼
  function getRowTitle(properties) {
    for (const prop of Object.values(properties || {})) {
      if (prop.type === 'title') return (prop.title || []).map(r => r.plain_text).join('');
    }
    return 'Untitled';
  }
  // child_database 블록 내 모든 DB 행 수집 (재귀)
  function collectDbRows(blocks) {
    const rows = [];
    for (const b of (blocks || [])) {
      if (b.type === 'child_database' && b._dbRows) rows.push(...b._dbRows);
      if (b._children) rows.push(...collectDbRows(b._children));
    }
    return rows;
  }

  for (const entry of entries) {
    if (!entry.slug) {
      console.log('  ⚠️  Slug 없음, 스킵: ' + entry.title);
      continue;
    }
    // DB 행마다 _pagePath 먼저 설정 → blocksToHtml 호출 전에
    const allDbRows = collectDbRows(entry.blocks);
    for (const row of allDbRows) {
      const rowId = row.id.replace(/-/g, '');
      row._pagePath = '/lab/' + rowId + '.html';
    }
    // contentHtml 생성 (이제 _pagePath 사용)
    const contentHtml = blocksToHtml(entry.blocks);
    // 개별 페이지용 암호화 (전체 내용 포함)
    const entryData = {
      title: entry.title,
      description: entry.description,
      date: entry.date,
      tags: entry.tags,
      contentHtml: contentHtml
    };
    const entryEncrypted = encryptData(JSON.stringify(entryData), LAB_PASSWORD);
    const html = generateLabEntryPage(entryEncrypted);
    fs.writeFileSync(path.join(labDir, entry.slug + '.html'), html, 'utf8');
    console.log('  📄 생성: lab/' + entry.slug + '.html');
    // DB 행 세부 페이지 생성
    for (const row of allDbRows) {
      const rowTitle = getRowTitle(row.properties);
      const rowContentHtml = blocksToHtml(row._pageBlocks || []);
      const rowData = { title: rowTitle, description: '', date: '', tags: [], contentHtml: rowContentHtml };
      const rowEncrypted = encryptData(JSON.stringify(rowData), LAB_PASSWORD);
      const rowHtmlPage = generateLabEntryPage(rowEncrypted);
      const rowId = row.id.replace(/-/g, '');
      fs.writeFileSync(path.join(labDir, rowId + '.html'), rowHtmlPage, 'utf8');
      console.log('    🗂️  DB행: ' + rowTitle);
    }

    // 인덱스용 메타데이터 (내용 제외)
    metaList.push({
      slug: entry.slug,
      title: entry.title,
      description: entry.description,
      date: entry.date,
      tags: entry.tags,
      url: '/lab/' + entry.slug + '.html'
    });
  }

  // 인덱스 암호화 → data/lab-encrypted.json
  const indexEncrypted = encryptData(JSON.stringify(metaList), LAB_PASSWORD);
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'lab-encrypted.json'), JSON.stringify(indexEncrypted), 'utf8');

  console.log('✅ 연구기록 완료 — ' + metaList.length + '개 페이지 생성');
}

main().catch(err => { console.error(err); process.exit(1); });
