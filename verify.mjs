import { chromium } from 'playwright';

const url = process.argv[2] || 'http://localhost:5173/';
const out = process.argv[3] || '/tmp/shot.png';
const waitMs = parseInt(process.argv[4] || '6000', 10);

const browser = await chromium.launch({
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errors = [];
const warnings = [];
page.on('console', (msg) => {
  const type = msg.type();
  if (type === 'error') errors.push(msg.text());
  else if (type === 'warning') warnings.push(msg.text());
});
page.on('pageerror', (err) => errors.push('PAGEERROR: ' + err.message));

await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(waitMs);

// Headless throttles requestAnimationFrame, so drive the streaming queues
// directly to mesh the loaded area, and aim the camera at a vista.
await page.evaluate(() => {
  const g = window.__game;
  g.world.update(g.player.pos.x, g.player.pos.z);
  g.world.processQueues(4000);
  g.player.pitch = -0.45;
  g.player.pos.y += 6;
});

// Remove the click-to-play overlay so we can see the world in the screenshot.
await page.evaluate(() => {
  const o = document.getElementById('overlay');
  if (o) o.remove();
});
await page.waitForTimeout(1200);

const info = await page.evaluate(() => {
  const g = window.__game;
  const canvas = document.querySelector('canvas');
  const gl = canvas && (canvas.getContext('webgl2') || canvas.getContext('webgl'));
  let meshed = 0, generated = 0, total = 0;
  if (g) {
    for (const c of g.world.chunks.values()) {
      total++;
      if (c.generated) generated++;
      if (c.mesh || c.waterMesh) meshed++;
    }
  }
  return {
    hasGame: !!g,
    canvas: canvas ? `${canvas.width}x${canvas.height}` : null,
    glOK: !!gl,
    drawCalls: g ? g.renderer.info.render.calls : null,
    triangles: g ? g.renderer.info.render.triangles : null,
    playerY: g ? +g.player.pos.y.toFixed(2) : null,
    chunks: { total, generated, meshed },
    clock: document.getElementById('clock')?.textContent,
  };
});

await page.screenshot({ path: out });

console.log('=== VERIFY ===');
console.log(JSON.stringify(info, null, 2));
console.log('errors:', errors.length);
errors.slice(0, 20).forEach((e) => console.log('  ERR:', e));
console.log('warnings:', warnings.length);
warnings.slice(0, 8).forEach((w) => console.log('  WARN:', w));

await browser.close();
