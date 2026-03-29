import { webkit } from 'playwright';
import fs from 'node:fs/promises';

const BASE = 'http://127.0.0.1:5173';
const MUSIC_PATH = '/Users/macmini-1/Development/OpenClaw/OpenFlow/Resource/Music/天地孤影任我行.mp3';
const OUT = '/Users/macmini-1/.openclaw/workspace/outbound/openflow-step5-music-analysis-modal.png';

async function main() {
  const browser = await webkit.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });

  page.on('console', msg => console.log('PAGE:', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('PAGEERROR:', err.message));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  const selectedTask = page.locator('header select');
  await selectedTask.waitFor({ state: 'visible', timeout: 15000 });

  const options = await selectedTask.locator('option').allTextContents();
  let targetLabel = options.find(t => /RESULT|Step 5|ready/i.test(t) && !/Select Task/i.test(t));
  if (!targetLabel) targetLabel = options.find(t => !/Select Task/i.test(t));
  if (!targetLabel) throw new Error('No task option found');
  await selectedTask.selectOption({ label: targetLabel });
  await page.waitForTimeout(2000);

  const audioInput = page.locator('label:has-text("Audio File Path") input').first();
  await audioInput.fill(MUSIC_PATH);
  await page.waitForTimeout(1000);

  const analysisBtn = page.getByRole('button', { name: /Music Analysis/i }).first();
  await analysisBtn.click();
  await page.waitForTimeout(3000);

  const modal = page.locator('.modal-card').filter({ has: page.getByText('Music Analysis') }).first();
  await modal.waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(3000);

  await fs.mkdir('/Users/macmini-1/.openclaw/workspace/outbound', { recursive: true });
  await modal.screenshot({ path: OUT });
  console.log(OUT);
  await browser.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
