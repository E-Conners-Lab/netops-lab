import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const baseUrl = process.env.URL ?? 'http://localhost:3000/';
const outputDir = path.resolve('qa');

async function canvasMetrics(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return null;
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    let nonDark = 0;
    let colored = 0;
    let alpha = 0;
    const seen = new Set();
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const a = pixels[i + 3];
      if (r + g + b > 36) nonDark += 1;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 8) colored += 1;
      if (a > 0) alpha += 1;
      if (seen.size < 5000) seen.add(`${r >> 4},${g >> 4},${b >> 4}`);
    }

    return {
      width,
      height,
      nonDarkRatio: nonDark / (width * height),
      coloredRatio: colored / (width * height),
      alphaRatio: alpha / (width * height),
      colorBuckets: seen.size,
      camera: document.querySelector('.room-canvas')?.dataset.camera,
    };
  });
}

async function runTerminalCommand(page, command) {
  const input = page.locator('#terminal-command');
  await input.fill(command);
  await input.press('Enter');
}

async function verifyViewport(browser, name, viewport) {
  const page = await browser.newPage({ viewport });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForSelector('canvas');
  await page.waitForFunction(() => document.querySelector('.room-canvas')?.dataset.ready === 'true');
  await page.waitForTimeout(600);

  const before = await canvasMetrics(page);
  if (!before) throw new Error(`${name}: canvas metrics unavailable`);
  if (before.nonDarkRatio < 0.04 || before.coloredRatio < 0.025 || before.colorBuckets < 16) {
    throw new Error(`${name}: canvas appears blank or under-rendered: ${JSON.stringify(before)}`);
  }

  const startCamera = await page.locator('.room-canvas').evaluate((node) => node.dataset.camera);
  await page.keyboard.down('w');
  await page.waitForTimeout(450);
  await page.keyboard.up('w');
  const movedCamera = await page.locator('.room-canvas').evaluate((node) => node.dataset.camera);
  if (startCamera === movedCamera) throw new Error(`${name}: WASD movement did not change camera position`);

  await page.screenshot({ path: path.join(outputDir, `${name}-room.png`), fullPage: true });
  await page.getByRole('button', { name: /open console/i }).click();
  await page.waitForSelector('.console-shell');
  await page.screenshot({ path: path.join(outputDir, `${name}-console.png`), fullPage: true });

  if (name === 'desktop') {
    await page.getByRole('button', { name: 'BR-SW1' }).click();
    await runTerminalCommand(page, 'sh vlan brief');
    await runTerminalCommand(page, 'conf t');
    await runTerminalCommand(page, 'int fa0/3');
    await runTerminalCommand(page, 'switchport access vlan 20');
    await runTerminalCommand(page, 'end');
    await page.getByRole('button', { name: 'BR-R1' }).click();
    await runTerminalCommand(page, 'conf t');
    await runTerminalCommand(page, 'router ospf 1');
    await runTerminalCommand(page, 'network 192.168.20.0 0.0.0.255 area 0');
    await runTerminalCommand(page, 'end');
    await page.getByRole('button', { name: 'Branch PC' }).click();
    await runTerminalCommand(page, 'ping 10.10.10.10');

    const terminalText = await page.locator('.terminal-output').textContent();
    if (!terminalText?.includes('3 packets transmitted, 3 received')) {
      throw new Error('desktop: terminal mission path did not complete successfully');
    }
  }

  await page.close();
  return { viewport, before, startCamera, movedCamera };
}

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

try {
  const results = [];
  results.push(await verifyViewport(browser, 'desktop', { width: 1440, height: 900 }));
  results.push(await verifyViewport(browser, 'mobile', { width: 390, height: 844 }));
  console.log(JSON.stringify({ ok: true, results }, null, 2));
} finally {
  await browser.close();
}
