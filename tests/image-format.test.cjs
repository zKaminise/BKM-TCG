const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {detectImageFormat}=require('../server/image-format.cjs');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jIiwAAAAASUVORK5CYII=','base64');
test('format detector recognizes real PNG/WebP containers and ignores a misleading filename',()=>{
 assert.deepEqual(detectImageFormat(png),{mime:'image/png',extension:'png'});
 for(const name of['pack.webp','pikachu.webp','pokemon-back.webp'])assert.deepEqual(detectImageFormat(fs.readFileSync(path.join(__dirname,'../assets',name))),{mime:'image/webp',extension:'webp'});
});
test('format detector rejects executable text, truncated containers and forged signatures',()=>{
 const webp=fs.readFileSync(path.join(__dirname,'../assets/pack.webp'));
 for(const bytes of[Buffer.from('<svg onload="alert(1)"/>'),Buffer.from('<html><script>alert(1)</script></html>'),png.subarray(0,24),Buffer.concat([png,Buffer.from('trailing')]),webp.subarray(0,webp.length-2),Buffer.from('RIFF1234WEBP<script>'),Buffer.from([255,216,255,1,2,255,217])])assert.equal(detectImageFormat(bytes),null);
});
