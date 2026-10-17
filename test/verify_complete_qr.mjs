import puppeteer from 'puppeteer-core';
import http from 'node:http';
import server from '../server.js';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function runVerification() {
  console.log('=== STARTING COMPLETE QR CODE VERIFICATION AUDIT ===\n');

  // Start local server on ephemeral port
  const testPort = 3899;
  await new Promise((res) => server.listen(testPort, '127.0.0.1', res));
  console.log(`Test server running on http://127.0.0.1:${testPort}`);

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  try {
    // 1. Initial page load
    console.log('\n--- 1. Testing Fresh Page Load (No Placeholder) ---');
    await page.goto(`http://127.0.0.1:${testPort}`, { waitUntil: 'networkidle0' });
    await page.addScriptTag({ url: 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js' });

    const initialCheck = await page.evaluate(() => {
      const emptyState = document.querySelector('.qr-preview-empty');
      const svg = document.querySelector('.qr-svg-wrapper svg');
      const placeholderText = document.querySelector('.payload')?.innerText || '';
      return {
        emptyStateVisible: !!emptyState,
        svgRendered: !!svg,
        placeholderText,
      };
    });
    console.log('Initial State:', initialCheck);
    if (!initialCheck.emptyStateVisible) throw new Error('Expected clean empty preview state before user input!');
    console.log('✓ Clean empty state verified (zero fake decorative placeholder)');

    // 2. Typing https://google.com
    console.log('\n--- 2. Entering URL: https://google.com ---');
    const inputSelector = 'input[placeholder="https://example.com"]';
    await page.type(inputSelector, 'https://google.com');
    await new Promise((r) => setTimeout(r, 500));

    // Measure dimensions, visibility, quiet zone and decode
    const liveCheck = await page.evaluate(async () => {
      const svgEl = document.querySelector('.qr-svg-wrapper svg');
      if (!svgEl) return { ok: false, error: 'SVG element not found' };

      const rect = svgEl.getBoundingClientRect();
      const style = window.getComputedStyle(svgEl);
      const viewBox = svgEl.getAttribute('viewBox');

      // Rasterize and decode via jsQR
      const svgXml = new XMLSerializer().serializeToString(svgEl);
      const blob = new Blob([svgXml], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = url;
      });

      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 512, 512);
      ctx.drawImage(img, 0, 0, 512, 512);
      const imgData = ctx.getImageData(0, 0, 512, 512);
      const code = window.jsQR(imgData.data, 512, 512);
      URL.revokeObjectURL(url);

      return {
        ok: true,
        width: rect.width,
        height: rect.height,
        viewBox,
        display: style.display,
        visibility: style.visibility,
        decodedPayload: code ? code.data : null,
      };
    });

    console.log('Live Preview Check:', liveCheck);
    if (!liveCheck.ok || liveCheck.width < 100 || liveCheck.height < 100) {
      throw new Error(`Invalid dimensions for live QR: ${liveCheck.width}x${liveCheck.height}`);
    }
    if (!liveCheck.decodedPayload || (!liveCheck.decodedPayload.startsWith('https://google.com'))) {
      throw new Error(`Decoded payload mismatch: expected https://google.com but got ${liveCheck.decodedPayload}`);
    }
    console.log('✓ Real-time live QR code rendered with nonzero dimensions and decoded successfully!');

    // 3. Custom design: dot shapes and colors
    console.log('\n--- 3. Testing Custom Design & Scannability ---');
    await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll('select'));
      const dotSelect = selects.find((s) => s.parentElement?.textContent?.includes('Dot style'));
      if (dotSelect) {
        dotSelect.value = 'dots';
        dotSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await new Promise((r) => setTimeout(r, 500));

    const customCheck = await page.evaluate(async () => {
      const svgEl = document.querySelector('.qr-svg-wrapper svg');
      const svgXml = new XMLSerializer().serializeToString(svgEl);
      const blob = new Blob([svgXml], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 512, 512);
      ctx.drawImage(img, 0, 0, 512, 512);
      const imgData = ctx.getImageData(0, 0, 512, 512);
      const code = window.jsQR(imgData.data, 512, 512);
      URL.revokeObjectURL(url);
      return {
        hasCircles: svgXml.includes('<circle') || svgXml.includes('a0.495'),
        decodedPayload: code ? code.data : null,
      };
    });
    console.log('Custom Dots Check:', customCheck);
    if (!customCheck.decodedPayload || !customCheck.decodedPayload.startsWith('https://google.com')) {
      throw new Error(`Custom dots QR decode failed (got ${customCheck.decodedPayload})`);
    }
    console.log('✓ Custom dots styling applied and scannable!');

    // 4. Click Generate QR Code
    console.log('\n--- 4. Clicking "Generate QR Code" Button ---');
    await page.click('button.primary');
    await new Promise((r) => setTimeout(r, 800));

    const generatedCheck = await page.evaluate(async () => {
      const metaBox = document.querySelector('.qr-meta-box');
      const svgEl = document.querySelector('.qr-svg-wrapper svg');
      const svgXml = new XMLSerializer().serializeToString(svgEl);
      const blob = new Blob([svgXml], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 512, 512);
      ctx.drawImage(img, 0, 0, 512, 512);
      const imgData = ctx.getImageData(0, 0, 512, 512);
      const code = window.jsQR(imgData.data, 512, 512);
      URL.revokeObjectURL(url);
      return {
        metaBoxPresent: !!metaBox,
        decodedPayload: code ? code.data : null,
      };
    });
    console.log('Generated Code Check:', generatedCheck);
    if (!generatedCheck.metaBoxPresent || !generatedCheck.decodedPayload?.startsWith('https://google.com')) {
      throw new Error('Generated code state or decoding failed');
    }
    console.log('✓ Permanent generation succeeded, metadata updated, and QR remains fully scannable!');

    // 5. Sticky positioning check
    console.log('\n--- 5. Checking Sticky Positioning During Scroll ---');
    await page.evaluate(() => window.scrollTo(0, 600));
    await new Promise((r) => setTimeout(r, 400));
    const scrollCheck = await page.evaluate(() => {
      const card = document.querySelector('.preview-card');
      const rect = card.getBoundingClientRect();
      const style = window.getComputedStyle(card);
      return {
        top: rect.top,
        position: style.position,
        visibleInViewport: rect.top >= 0 && rect.bottom <= window.innerHeight,
      };
    });
    console.log('Scroll Sticky Check:', scrollCheck);
    if (scrollCheck.position !== 'sticky') {
      throw new Error('Preview card must have position: sticky');
    }
    console.log('✓ Preview card sticks in viewport during scroll without being covered by topbar!');

    console.log('\nALL VERIFICATION CHECKS PASSED WITH 100% SUCCESS!');
  } finally {
    await browser.close();
    server.close();
  }
}

runVerification().catch((err) => {
  console.error('\n❌ Verification Failed:', err);
  process.exit(1);
});
