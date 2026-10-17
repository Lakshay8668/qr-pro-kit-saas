import { buildQrSvg, svgSize, DEFAULT_DESIGN } from '../src/lib/qrRender.js';
import QRCode from 'qrcode';

async function runAudit() {
  console.log('=== QR SIZE & STORAGE AUDIT MEASUREMENTS ===\n');

  const testPayloads = [
    { name: 'Standard URL', text: 'https://typqr.com/q/demo123' },
    { name: 'Long URL with UTM', text: 'https://typqr.com/q/demo123?utm_source=instagram&utm_medium=qr&utm_campaign=summer_sale&utm_content=banner' },
    { name: 'UPI Payment', text: 'upi://pay?pa=merchant@upi&pn=TypQR%20Store&am=299.00&cu=INR&tn=Order%20Payment' },
    { name: 'vCard Contact', text: 'BEGIN:VCARD\nVERSION:3.0\nN:Soni;Lakshay;;;\nFN:Lakshay Soni\nORG:Engagium Technologies\nEMAIL:support@engagiumtechnologies.com\nTEL:+919876543210\nEND:VCARD' },
  ];

  for (const p of testPayloads) {
    console.log(`\n--- Payload: ${p.name} (${p.text.length} chars) ---`);

    // 1. Default configured SVG (size=512)
    const svgDefault = buildQrSvg(p.text, DEFAULT_DESIGN, { size: 512 });
    const { width: dw, height: dh } = svgSize(svgDefault);
    const vbMatch = svgDefault.match(/viewBox="([^"]+)"/);
    const svgBytes = Buffer.byteLength(svgDefault, 'utf8');

    console.log(`• Default SVG: width=${dw}px, height=${dh}px, viewBox="${vbMatch ? vbMatch[1] : 'none'}"`);
    console.log(`  File size: ${svgBytes} bytes (${(svgBytes / 1024).toFixed(2)} KB)`);

    // 2. Framed SVG
    const svgFramed = buildQrSvg(p.text, { ...DEFAULT_DESIGN, frameStyle: 'bar', frameText: 'Scan me' }, { size: 512 });
    const { width: fw, height: fh } = svgSize(svgFramed);
    const vbFramed = svgFramed.match(/viewBox="([^"]+)"/);
    const framedBytes = Buffer.byteLength(svgFramed, 'utf8');
    console.log(`• Framed SVG: width=${fw}px, height=${fh}px, viewBox="${vbFramed ? vbFramed[1] : 'none'}"`);
    console.log(`  File size: ${framedBytes} bytes (${(framedBytes / 1024).toFixed(2)} KB)`);

    // 3. PNG sizes via QRCode rasterizer at standard sizes
    for (const px of [512, 1024, 2048, 4096]) {
      const pngBuf = await QRCode.toBuffer(p.text, { width: px, margin: 3, errorCorrectionLevel: 'M' });
      console.log(`• PNG ${px}x${px} px: ${pngBuf.length} bytes (${(pngBuf.length / 1024).toFixed(2)} KB)`);
    }
  }

  // 4. Database storage per record analysis
  console.log('\n--- DATABASE STORAGE AUDIT ---');
  const sampleDoc = {
    kind: 'redirect',
    destination: 'https://engagiumtechnologies.com/product/launch',
    payload: null,
    destinations: null,
    bio: null,
    password: null,
    label: 'Launch Campaign Poster',
    type: 'url',
    design: {
      fg: '#111827',
      fg2: '',
      bg: '#ffffff',
      eyeColor: '',
      shape: 'square',
      eye: 'square',
      logo: null,
      logoScale: 0.22,
      frameStyle: 'none',
      frameText: 'Scan me',
    },
    scans: 142,
    active: true,
    expiresAt: null,
    maxScans: null,
    isDraft: false,
    ownerId: 'uid_sample_1234567890',
    createdAt: new Date().toISOString(),
  };

  const jsonStr = JSON.stringify(sampleDoc);
  console.log(`• Compact Firestore metadata document size: ${Buffer.byteLength(jsonStr, 'utf8')} bytes (~${(Buffer.byteLength(jsonStr, 'utf8') / 1024).toFixed(2)} KB)`);
  console.log(`• Redundant raw image stored in DB: 0 bytes (Images are NOT stored in Firestore; they are rendered 100% on-demand from compact vector configuration).`);
}

runAudit();
