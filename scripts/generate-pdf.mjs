const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  const htmlPath = path.resolve(__dirname, 'docs/COMPREHENSIVE_CODE_Q&A.html');
  await page.goto('file://' + htmlPath, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.pdf({
    path: path.resolve(__dirname, 'docs/COMPREHENSIVE_CODE_Q&A.pdf'),
    format: 'A4',
    printBackground: true,
    margin: { top: '1.5cm', bottom: '1.5cm', left: '1.5cm', right: '1.5cm' },
  });
  await browser.close();
  console.log('PDF generated successfully!');
})().catch(err => { console.error(err); process.exit(1); });