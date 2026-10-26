// Split Eaglercraft 26.3 single-file HTML into its parts (base64 blobs, brotli where named *-br).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';
const [src, out] = process.argv.slice(2);
const s = readFileSync(src, 'utf8');
mkdirSync(out, { recursive: true });
const re = /<script([^>]*)>/g; let m, js = 0; const index = [];
while ((m = re.exec(s))) {
  const end = s.indexOf('</script>', re.lastIndex), body = s.slice(re.lastIndex, end), attrs = m[1];
  const id = (attrs.match(/id="([^"]+)"/) || [])[1];
  if (/octet-stream/.test(attrs)) {
    const raw = Buffer.from(body.replace(/\s+/g, ''), 'base64');
    let data = raw, name = id;
    if (/-br$/.test(id)) { data = brotliDecompressSync(raw); name = id.replace(/-br$/, ''); }
    writeFileSync(`${out}/${name}.bin`, data);
    index.push({ id, attrs: attrs.trim(), encoded: body.length, raw: raw.length, decoded: data.length, file: `${name}.bin`, magic: data.subarray(0, 8).toString('hex') });
  } else {
    const f = `script-${++js}${/module/.test(attrs) ? '.mjs' : '.js'}`;
    writeFileSync(`${out}/${f}`, body); index.push({ attrs: attrs.trim(), file: f, length: body.length });
  }
}
// the HTML with every script body removed, to see the shell
writeFileSync(`${out}/shell.html`, s.replace(/(<script[^>]*>)[\s\S]*?(<\/script>)/g, '$1$2'));
writeFileSync(`${out}/index.json`, JSON.stringify(index, null, 1));
console.log(index.map((e) => `${e.file}  ${e.decoded ?? e.length}  ${e.magic ?? ''}`).join('\n'));
