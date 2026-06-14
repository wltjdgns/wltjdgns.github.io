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

const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function richTextToHtml(richText) {
  return (richText || []).map(span => {
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
      case 'heading_1': html += `<h1>${richTextToHtml(block.heading_1.rich_text)}</h1>\n`; break;
      case 'heading_2': html += `<h2>${richTextToHtml(block.heading_2.rich_text)}</h2>\n`; break;
      case 'heading_3': html += `<h3>${richTextToHtml(block.heading_3.rich_text)}</h3>\n`; break;
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
      case 'quote': html += `<blockquote>${richTextToHtml(block.quote.rich_text)}</blockquote>\n`; break;
      case 'callout': {
        const icon = block.callout.icon?.emoji || '💡';
        html += `<div class="callout">${icon} ${richTextToHtml(block.callout.rich_text)}</div>\n`;
        break;
      }
      case 'divider': html += '<hr>\n'; break;
      case 'image': {
        const imgUrl = block.image.type === 'external'
          ? block.image.external.url : block.image.file.url;
        const caption = (block.image.caption || []).map(r => r.plain_text).join('');
        html += `<figure><img src="${esc(imgUrl)}" alt="${esc(caption)}">`;
        if (caption) html += `<figcaption>${esc(caption)}</figcaption>`;
        html += '</figure>\n';
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

async function fetchLabEntries() {
  if (!LAB_DB_ID) { console.error('NOTION_LAB_DB_ID 환경변수가 없습니다.'); return []; }
  const response = await notionRequest(`databases/${LAB_DB_ID}/query`, 'POST', {
    sorts: [{ property: 'Date', direction: 'descending' }]
  });
  if (response.object === 'error') { console.error('Lab DB error:', response.message); return []; }

  const entries = [];
  for (const page of (response.results || [])) {
    const props = page.properties;
    const getText = p => p?.rich_text?.[0]?.plain_text || p?.title?.[0]?.plain_text || '';
    const title = getText(props.Name || props.제목);
    const date = (props.Date || props.날짜)?.date?.start || '';
    const summary = getText(props.Summary || props.요약);
    const tags = ((props.Tags || props.태그)?.multi_select || []).map(t => t.name);

    const blocks = await fetchBlocksRecursively(page.id);
    const contentHtml = blocksToHtml(blocks);

    entries.push({ id: page.id, title, date, summary, tags, contentHtml });
    console.log(`  📓 처리: ${title}`);
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

async function main() {
  if (!LAB_PASSWORD) { console.error('LAB_PASSWORD 환경변수가 없습니다.'); process.exit(1); }
  console.log('실험일지 데이터 가져오는 중...');
  const entries = await fetchLabEntries();
  const plaintext = JSON.stringify(entries);
  const encrypted = encryptData(plaintext, LAB_PASSWORD);

  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'lab-encrypted.json'), JSON.stringify(encrypted), 'utf8');

  console.log(`✅ 실험일지 암호화 완료 — ${entries.length}개 항목`);
}

main().catch(err => { console.error(err); process.exit(1); });
