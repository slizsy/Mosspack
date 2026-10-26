// Rebuild the single-file HTML from the original with some parts replaced.
// usage: node pack.mjs ORIGINAL.html OUT.html PARTS.json
//   PARTS.json = { "payloads": { "<script id>": "file.bin" }, "scripts": { "script-3.js": "file.js" },
//                  "head": "html inserted at the start of <head>", "text": [["old", "new"], ...], "brotliQuality": 9 }
// Payload ids ending in -br are Brotli-compressed; all payloads are base64 in lines the loader decodes one by one.
import { readFileSync, writeFileSync } from 'node:fs';
import { brotliCompressSync, constants as Z } from 'node:zlib';
const [src, out, spec] = process.argv.slice(2);
const parts = JSON.parse(readFileSync(spec, 'utf8'));
let html = readFileSync(src, 'utf8');
const LINE = 65536;                                    // characters per base64 line (multiple of 4)
function encode(id, file) {
  let data = readFileSync(file);
  if (/-br$/.test(id)) data = brotliCompressSync(data, { params: { [Z.BROTLI_PARAM_QUALITY]: parts.brotliQuality ?? 9,
    [Z.BROTLI_PARAM_LGWIN]: 24, [Z.BROTLI_PARAM_SIZE_HINT]: data.length } });
  const b64 = data.toString('base64'), lines = [];
  for (let i = 0; i < b64.length; i += LINE) lines.push(b64.slice(i, i + LINE));
  return { size: data.length, body: '\n' + lines.join('\n') + '\n' };
}
let js = 0, replaced = 0;
html = html.replace(/(<script)([^>]*)(>)([\s\S]*?)(<\/script>)/g, (all, open, attrs, gt, body, close) => {
  const id = (attrs.match(/id="([^"]+)"/) || [])[1];
  if (/octet-stream/.test(attrs)) {
    const file = parts.payloads?.[id];
    if (!file) return all;
    const e = encode(id, file); replaced++;
    return open + attrs.replace(/data-size="\d+"/, `data-size="${e.size}"`) + gt + e.body + close;
  }
  const name = `script-${++js}${/module/.test(attrs) ? '.mjs' : '.js'}`;
  const file = parts.scripts?.[name];
  if (!file) return all;
  replaced++;
  return open + attrs + gt + readFileSync(file, 'utf8') + close;
});
for (const [a, b] of parts.text || []) {
  const n = html.split(a).length - 1;
  if (n !== 1) throw new Error(`text ${JSON.stringify(a.slice(0, 60))}: expected 1 match, found ${n}`);
  html = html.replace(a, () => b);
}
if (parts.head) html = html.replace('<head>', () => '<head>\n' + parts.head);
writeFileSync(out, html);
console.log(`${replaced} parts replaced; ${(html.length / 1e6).toFixed(1)} MB written to ${out}`);
