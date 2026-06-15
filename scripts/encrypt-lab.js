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

function slugify(str) {
  return String(str).toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-가-힣]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'untitled';
}

// Notion color → [bg, fg] dark-theme palette
const NOTION_COLORS = {
  default: ['#2d2d2d', '#aaa'],
  gray:    ['#3a3a3a', '#9b9a97'],
  brown:   ['#3d2b1f', '#c4a882'],
  orange:  ['#4a2500', '#e8850a'],
  yellow:  ['#3d3000', '#dfab01'],
  green:   ['#0d2e1e', '#3dba8a'],
  blue:    ['#0a2233', '#4db8d9'],
  purple:  ['#281a4a', '#a882d9'],
  pink:    ['#3d0d2a', '#e05caa'],
  red:     ['#3d1010', '#e06060']
};

function mkBadge(name, color, cls) {
  const pair = NOTION_COLORS[color] || NOTION_COLORS.default;
  return '<span class="' + cls + '" style="background:' + pair[0] + ';color:' + pair[1] +
    ';border-radius:3px;padding:1px 6px;font-size:0.78em;font-weight:500;white-space:nowrap;display:inline-block;line-height:1.6">' +
    esc(name) + '</span>';
}

function getPropText(prop) {
  if (!prop) return '';
  const t = prop.type;
  if (t === 'title') return (prop.title || []).map(r => r.plain_text).join('');
  if (t === 'rich_text') return (prop.rich_text || []).map(r => r.plain_text).join('');
  if (t === 'number') return prop.number !== null && prop.number !== undefined ? String(prop.number) : '';
  if (t === 'select') return prop.select ? prop.select.name : '';
  if (t === 'multi_select') return (prop.multi_select || []).map(s => s.name).join(', ');
  if (t === 'checkbox') return prop.checkbox ? '✅' : '❌';
  if (t === 'date') return prop.date ? prop.date.start : '';
  if (t === 'url') return prop.url || '';
  if (t === 'email') return prop.email || '';
  if (t === 'phone_number') return prop.phone_number || '';
  if (t === 'formula') return prop.formula ? String(prop.formula.string || prop.formula.number || '') : '';
  if (t === 'files') return (prop.files || []).map(f => f.type === 'external' ? f.external.url : (f.file ? f.file.url : '')).filter(Boolean).join(', ');
  if (t === 'relation') return '';
  if (t === 'rollup') return prop.rollup ? String(prop.rollup.number || '') : '';
  if (t === 'status') return prop.status ? prop.status.name : '';
  return '';
}

function getPropHtml(prop) {
  if (!prop) return '';
  const t = prop.type;
  if (t === 'select' && prop.select)
    return mkBadge(prop.select.name, prop.select.color || 'default', 'n-select');
  if (t === 'multi_select')
    return (prop.multi_select || []).map(s => mkBadge(s.name, s.color || 'default', 'n-select')).join(' ');
  if (t === 'status' && prop.status)
    return mkBadge(prop.status.name, prop.status.color || 'default', 'n-status');
  return esc(getPropText(prop));
}

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
        if (block.heading_1.is_toggleable) {
          const childHtml = block._children ? blocksToHtml(block._children) : '';
          html += '<details class="toggle-heading"><summary><h1>' + richTextToHtml(block.heading_1.rich_text) + '</h1></summary><div class="toggle-content">' + childHtml + '</div></details>\n';
        } else {
          html += '<h1>' + richTextToHtml(block.heading_1.rich_text) + '</h1>\n';
        }
        break;
      }
      case 'heading_2': {
        if (block.heading_2.is_toggleable) {
          const childHtml = block._children ? blocksToHtml(block._children) : '';
          html += '<details class="toggle-heading"><summary><h2>' + richTextToHtml(block.heading_2.rich_text) + '</h2></summary><div class="toggle-content">' + childHtml + '</div></details>\n';
        } else {
          html += '<h2>' + richTextToHtml(block.heading_2.rich_text) + '</h2>\n';
        }
        break;
      }
      case 'heading_3': {
        if (block.heading_3.is_toggleable) {
          const childHtml = block._children ? blocksToHtml(block._children) : '';
          html += '<details class="toggle-heading"><summary><h3>' + richTextToHtml(block.heading_3.rich_text) + '</h3></summary><div class="toggle-content">' + childHtml + '</div></details>\n';
        } else {
          html += '<h3>' + richTextToHtml(block.heading_3.rich_text) + '</h3>\n';
        }
        break;
      }
      case 'bulleted_list_item':
        if (!inUl) { html += '<ul>\n'; inUl = true; }
        html += '  <li>' + richTextToHtml(block.bulleted_list_item.rich_text) + (block._children ? blocksToHtml(block._children) : '') + '</li>\n';
        break;
      case 'numbered_list_item':
        if (!inOl) { html += '<ol>\n'; inOl = true; }
        html += '  <li>' + richTextToHtml(block.numbered_list_item.rich_text) + (block._children ? blocksToHtml(block._children) : '') + '</li>\n';
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
        html += '<details><summary>' + summary + '</summary><div class="toggle-content">' + childHtml + '</div></details>\n';
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
        const cpTitle = block.child_page.title || '';
        const cpBlocks = block._children || [];
        html += '<details class="child-page"><summary>📄 ' + esc(cpTitle) + '</summary>';
        if (cpBlocks.length) {
          html += '<div class="child-page-content">' + blocksToHtml(cpBlocks) + '</div>';
        }
        html += '</details>\n';
        break;
      }
      case 'child_database': {
        const dbTitle = (block.child_database && block.child_database.title) || 'Database';
        const schema = block._dbSchema || {};
        const rows = block._dbRows || [];
        // Determine column order: title first, skip formula/rollup/relation
        const SKIP_TYPES = ['formula', 'rollup', 'relation', 'files'];
        let columns = Object.keys(schema).filter(c => !SKIP_TYPES.includes(schema[c].type));
        columns.sort((a, b) => {
          if (schema[a].type === 'title') return -1;
          if (schema[b].type === 'title') return 1;
          return 0;
        });
        html += '<div class="db-title">📊 ' + esc(dbTitle) + '</div>\n';
        if (columns.length && rows.length) {
          html += '<div class="db-table-wrap"><table class="db-table">\n<thead><tr>';
          columns.forEach(c => { html += '<th>' + esc(c) + '</th>'; });
          html += '</tr></thead>\n<tbody>';
          rows.forEach(row => {
            html += '<tr>';
            columns.forEach(c => {
              if (schema[c] && schema[c].type === 'title') {
                const cellText = esc(getPropText(row.properties[c]));
                html += '<td>' + (row._pagePath && cellText
                  ? '<a href="' + esc(row._pagePath) + '">' + cellText + '</a>'
                  : cellText) + '</td>';
              } else {
                html += '<td>' + getPropHtml(row.properties[c]) + '</td>';
              }
            });
            html += '</tr>\n';
          });
          html += '</tbody>\n</table></div>\n';
        } else {
          html += '<p><em>데이터 없음</em></p>\n';
        }
        break;
      }
      case 'column_list': {
        const cols = block._children || [];
        html += '<div class="column-list">';
        cols.forEach(col => {
          html += '<div class="column">' + blocksToHtml(col._children || []) + '</div>';
        });
        html += '</div>\n';
        break;
      }
      case 'column': break;
      default: break;
    }
  }
  if (inUl) html += '</ul>\n';
  if (inOl) html += '</ol>\n';
  return html;
}

// 페이지네이션 지원 — Notion API는 블록을 최대 100개씩 반환
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
      // Fetch schema
      const dbResp = await notionRequest('databases/' + block.id);
      block._dbSchema = (dbResp.object === 'error') ? {} : (dbResp.properties || {});
      // Fetch rows
      let rowCursor = null;
      block._dbRows = [];
      do {
        const rowBody = rowCursor ? { start_cursor: rowCursor } : {};
        const rowsResp = await notionRequest('databases/' + block.id + '/query', 'POST', rowBody);
        if (rowsResp.object === 'error') break;
        block._dbRows = block._dbRows.concat(rowsResp.results || []);
        rowCursor = rowsResp.has_more ? rowsResp.next_cursor : null;
      } while (rowCursor);
      // Fetch children for each row page
      for (const row of block._dbRows) {
        row._children = await fetchBlocksRecursively(row.id);
      }
    } else if (block.has_children) {
      block._children = await fetchBlocksRecursively(block.id);
    }
  }
  return allBlocks;
}

// DB 행에서 제목(title 타입 property) 추출
function getRowTitle(row) {
  for (const key of Object.keys(row.properties || {})) {
    const prop = row.properties[key];
    if (prop.type === 'title') {
      return (prop.title || []).map(r => r.plain_text).join('').trim();
    }
  }
  return '';
}

// 블록 트리에서 child_database 행들을 찾아 _pagePath 할당
function collectDbRows(blocks, entrySlug) {
  const rows = [];
  for (const block of blocks) {
    if (block.type === 'child_database') {
      for (const row of (block._dbRows || [])) {
        const title = getRowTitle(row);
        const titleSlug = slugify(title) || row.id;
        row._pagePath = '/lab/' + entrySlug + '/' + titleSlug + '.html';
        rows.push(row);
      }
    }
    // Recurse into block children (not DB rows)
    if (block._children && block.type !== 'child_database') {
      rows.push(...collectDbRows(block._children, entrySlug));
    }
  }
  return rows;
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
    const title = getText(props.Name || props['\uc81c\ubaa9']);
    const description = getText(props.Description || props['\uc124\uba85']);
    const date = (props.Date || props['\ub0a0\uc9dc']) && (props.Date || props['\ub0a0\uc9dc']).date
      ? (props.Date || props['\ub0a0\uc9dc']).date.start : '';
    const tags = ((props.Tags || props['\ud0dc\uadf8']) && (props.Tags || props['\ud0dc\uadf8']).multi_select || []).map(t => t.name);
    const slug = getText(props.Slug || props['slug']) || null;

    const blocks = await fetchBlocksRecursively(page.id);
    entries.push({ id: page.id, slug, title, description, date, tags, blocks });
    console.log('  \ud83d\udcd3 \ucc98\ub9ac: ' + title + ' (' + blocks.length + '\uac1c \ube14\ub85d)');
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

function generateLabEntryPage(entryEncrypted) {
  const encStr = JSON.stringify(entryEncrypted);
  return '<!DOCTYPE html>\n' +
'<html lang="ko">\n' +
'<head>\n' +
'  <meta charset="UTF-8">\n' +
'  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
'  <title>\uc5f0\uad6c\uae30\ub85d | wltjdgns</title>\n' +
'  <meta name="robots" content="noindex, nofollow">\n' +
'  <link rel="preconnect" href="https://fonts.googleapis.com">\n' +
'  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
'  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;800&family=IBM+Plex+Sans+KR:wght@200;400;600&display=swap" rel="stylesheet">\n' +
'  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">\n' +
'  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>\n' +
'  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"></script>\n' +
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
'    .content table { width: 100%; border-collapse: collapse; margin-bottom: 1.4rem; font-size: 0.9rem; }\n' +
'    .content th, .content td { border: 1px solid #2a2a2a; padding: 0.6rem 0.8rem; text-align: left; vertical-align: middle; }\n' +
'    .content th { background: #1a1a1a; font-weight: 600; color: var(--text); }\n' +
'    .content td { color: #ccc; }\n' +
'    .content details { border: 1px solid #2a2a2a; border-radius: 8px; margin-bottom: 1rem; overflow: hidden; }\n' +
'    .content details summary { padding: 0.8rem 1rem; cursor: pointer; font-weight: 500; color: #ddd; list-style: none; display: flex; align-items: center; gap: 0.5rem; }\n' +
'    .content details summary::-webkit-details-marker { display: none; }\n' +
'    .content details summary::before { content: "\\25B6"; font-size: 0.65rem; color: var(--accent); transition: transform 0.2s; flex-shrink: 0; }\n' +
'    .content details[open] summary::before { transform: rotate(90deg); }\n' +
'    .content details summary:hover { background: #111; }\n' +
'    .content .toggle-content { padding: 0.2rem 1rem 0.8rem 2rem; border-top: 1px solid #1e1e1e; }\n' +
'    .content details.toggle-heading summary h1, .content details.toggle-heading summary h2, .content details.toggle-heading summary h3 { margin: 0; display: inline; }\n' +
'    .content .column-list { display: flex; gap: 1.5rem; margin-bottom: 1.4rem; }\n' +
'    .content .column { flex: 1; min-width: 0; }\n' +
'    .content .math-block { overflow-x: auto; margin-bottom: 1.4rem; }\n' +
'    .content .db-title { font-weight: 700; font-size: 1rem; color: var(--accent); margin: 2rem 0 0.6rem; display: flex; align-items: center; gap: 0.4rem; }\n' +
'    .content .db-table-wrap { overflow-x: auto; margin-bottom: 1.4rem; }\n' +
'    .content .db-table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }\n' +
'    .content .db-table th, .content .db-table td { border: 1px solid #2a2a2a; padding: 0.5rem 0.8rem; text-align: left; vertical-align: middle; white-space: nowrap; }\n' +
'    .content .db-table th { background: #161616; font-weight: 600; color: #aaa; font-size: 0.78rem; letter-spacing: 0.03em; }\n' +
'    .content .db-table td { color: #ccc; }\n' +
'    .content .db-table td:first-child { white-space: normal; }\n' +
'    .content .n-select, .content .n-status { display: inline-block; border-radius: 3px; padding: 1px 6px; font-size: 0.78em; font-weight: 500; white-space: nowrap; line-height: 1.6; }\n' +
'    @media (max-width: 600px) { .content .column-list { flex-direction: column; } }\n' +
'    footer { padding: 4rem 0; border-top: 1px solid #222; color: #444; font-size: 0.8rem; margin-top: 4rem; }\n' +
'  </style>\n' +
'</head>\n' +
'<body>\n' +
'  <div class="container">\n' +
'    <nav>\n' +
'      <a href="/">\u2190 WLTJDGNS.LOG</a>\n' +
'      <a href="/lab/">\uc5f0\uad6c\uae30\ub85d</a>\n' +
'    </nav>\n' +
'\n' +
'    <div id="lock-screen">\n' +
'      <div class="lock-icon">\ud83d\udd12</div>\n' +
'      <h1 class="lock-title">\uc5f0\uad6c\uae30\ub85d</h1>\n' +
'      <p class="lock-sub">\ube44\uacf5\uac1c \uc601\uc5ed\uc785\ub2c8\ub2e4. \ube44\ubc00\ubc88\ud638\ub97c \uc785\ub825\ud558\uc138\uc694.</p>\n' +
'      <div class="pw-form">\n' +
'        <input type="password" id="pw-input" placeholder="\ube44\ubc00\ubc88\ud638" autocomplete="current-password">\n' +
'        <button class="btn-unlock" id="btn-unlock" onclick="unlock()">\uc5f4\uae30</button>\n' +
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
'      document.getElementById("entry-tags").innerHTML = (entry.tags || []).map(function(t) { return \'<span class="tag">#\' + t + "</span>"; }).join("");\n' +
'      document.getElementById("entry-title").textContent = entry.title || "";\n' +
'      document.getElementById("entry-body").innerHTML = entry.contentHtml || \'<p style="color:#555">\ub0b4\uc6a9\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.</p>\';\n' +
'      document.getElementById("lock-screen").style.display = "none";\n' +
'      document.getElementById("article-content").style.display = "block";\n' +
'      if (window.renderMathInElement) {\n' +
'        renderMathInElement(document.getElementById("entry-body"), {\n' +
'          delimiters: [{left:"\\\\[",right:"\\\\]",display:true},{left:"\\\\(",right:"\\\\)",display:false}]\n' +
'        });\n' +
'      }\n' +
'    }\n' +
'\n' +
'    function unlock() {\n' +
'      var pw = document.getElementById("pw-input").value;\n' +
'      var errEl = document.getElementById("lock-error");\n' +
'      var btn = document.getElementById("btn-unlock");\n' +
'      var input = document.getElementById("pw-input");\n' +
'      if (!pw) return;\n' +
'      btn.disabled = true;\n' +
'      btn.textContent = "\ubcf5\ud638\ud654 \uc911...";\n' +
'      errEl.textContent = "";\n' +
'      input.classList.remove("error");\n' +
'      decryptData(ENCRYPTED, pw).then(function(plaintext) {\n' +
'        var entry = JSON.parse(plaintext);\n' +
'        renderEntry(entry);\n' +
'        sessionStorage.setItem("lab_pw", pw);\n' +
'      }).catch(function() {\n' +
'        input.classList.add("error");\n' +
'        errEl.textContent = "\ube44\ubc00\ubc88\ud638\uac00 \uc62c\ubc14\ub974\uc9c0 \uc54a\uc2b5\ub2c8\ub2e4.";\n' +
'        btn.disabled = false;\n' +
'        btn.textContent = "\uc5f4\uae30";\n' +
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
  if (!LAB_PASSWORD) { console.error('LAB_PASSWORD \ud658\uacbd\ubcc0\uc218\uac00 \uc5c6\uc2b5\ub2c8\ub2e4.'); process.exit(1); }
  console.log('\uc5f0\uad6c\uae30\ub85d \ub370\uc774\ud130 \uac00\uc838\uc624\ub294 \uc911...');
  const entries = await fetchLabEntries();

  const labDir = path.join(__dirname, '..', 'lab');
  if (!fs.existsSync(labDir)) fs.mkdirSync(labDir, { recursive: true });

  const metaList = [];
  for (const entry of entries) {
    if (!entry.slug) {
      console.log('  \u26a0\ufe0f  Slug \uc5c6\uc74c, \uc2a4\ud82b: ' + entry.title);
      continue;
    }

    // Assign _pagePath to all DB rows: /lab/{entrySLug}/{rowTitleSlug}.html
    const dbRows = collectDbRows(entry.blocks, entry.slug);

    // Convert blocks to HTML (after _pagePath is assigned)
    const contentHtml = blocksToHtml(entry.blocks);

    // Generate sub-pages for each DB row
    const entrySubDir = path.join(labDir, entry.slug);
    if (dbRows.length && !fs.existsSync(entrySubDir)) {
      fs.mkdirSync(entrySubDir, { recursive: true });
    }
    for (const row of dbRows) {
      const rowTitle = getRowTitle(row);
      const rowContentHtml = blocksToHtml(row._children || []);
      const rowData = {
        title: rowTitle || entry.title,
        description: '',
        date: entry.date,
        tags: entry.tags,
        contentHtml: rowContentHtml
      };
      const rowEncrypted = encryptData(JSON.stringify(rowData), LAB_PASSWORD);
      const rowHtml = generateLabEntryPage(rowEncrypted);
      const rowTitleSlug = slugify(rowTitle) || row.id;
      fs.writeFileSync(path.join(entrySubDir, rowTitleSlug + '.html'), rowHtml, 'utf8');
      console.log('    \ud83d\udcc4 \uc11c\ube0c\ud398\uc774\uc9c0: lab/' + entry.slug + '/' + rowTitleSlug + '.html');
    }

    // Generate main entry page
    const entryData = {
      title: entry.title,
      description: entry.description,
      date: entry.date,
      tags: entry.tags,
      contentHtml
    };
    const entryEncrypted = encryptData(JSON.stringify(entryData), LAB_PASSWORD);
    const html = generateLabEntryPage(entryEncrypted);
    fs.writeFileSync(path.join(labDir, entry.slug + '.html'), html, 'utf8');
    console.log('  \ud83d\udcd4 \uc0dd\uc131: lab/' + entry.slug + '.html');

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

  console.log('\u2705 \uc5f0\uad6c\uae30\ub85d \uc644\ub8cc \u2014 ' + metaList.length + '\uac1c \ud398\uc774\uc9c0 \uc0dd\uc131');
}

main().catch(err => { console.error(err); process.exit(1); });
