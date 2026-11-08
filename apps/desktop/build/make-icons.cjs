// TICKER 아이콘 만들기(여섯 칸 주황 판 + T 타일 입체형 A안, 사용자 결정): icon.svg·icon-small.svg → icon.png(1024, Mac) · icon.ico(Windows) · 화면 favicon.png
// 작은 크기(16·24·32px)는 캔들을 굵게 한 icon-small.svg로 그려요. Playwright(Chromium)가 있는 곳에서 이 폴더에서 실행해요: node make-icons.cjs
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const render = async (file, size) => {
    const svg = fs.readFileSync(file, 'utf8').replace('<svg ', `<svg width="${size}" height="${size}" `);
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
    return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  };
  fs.writeFileSync('icon.png', await render('icon.svg', 1024));
  fs.writeFileSync('../../web/public/favicon.png', await render('icon-small.svg', 64));
  const entries = [];
  for (const s of [16, 24, 32]) entries.push([s, await render('icon-small.svg', s)]);
  for (const s of [48, 64, 128, 256]) entries.push([s, await render('icon.svg', s)]);
  // ICO: 머리(6) + 항목(16×n) + PNG 데이터
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  entries.forEach(([s, png], i) => {
    const o = i * 16;
    dir.writeUInt8(s >= 256 ? 0 : s, o);
    dir.writeUInt8(s >= 256 ? 0 : s, o + 1);
    dir.writeUInt8(0, o + 2);
    dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  fs.writeFileSync('icon.ico', Buffer.concat([head, dir, ...entries.map(([, p]) => p)]));
  await browser.close();
})();
