import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

test('debug portal upload', async ({ page }) => {
  page.on('console', msg => {
    console.log(`[BROWSER CONSOLE] ${msg.type()}: ${msg.text()}`);
  });

  page.on('pageerror', err => {
    console.error(`[BROWSER ERROR] Unhandled Exception: ${err.message}`);
    console.error(err.stack);
  });

  console.log("Navigating to / ...");
  await page.goto('/');

  // Create a dummy image to upload
  const dummyImgPath = path.resolve('scratch_test_image.png');
  const dummyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  fs.writeFileSync(dummyImgPath, Buffer.from(dummyPngBase64, 'base64'));

  console.log("Dummy image created at:", dummyImgPath);

  // Click on the tool card containing "图片编辑"
  console.log("Triggering file chooser...");
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.locator('text=图片编辑').first().click();
  const fileChooser = await fileChooserPromise;
  console.log("Uploading file...");
  await fileChooser.setFiles(dummyImgPath);

  console.log("File uploaded, waiting 5 seconds for transition...");
  await page.waitForTimeout(5000);

  // Check the current url and view state if possible
  const html = await page.content();
  console.log("--- RENDERED HTML SNIPPET ---");
  // Print some key parts of the HTML to verify if canvas is visible or not
  if (html.includes('infinite-canvas-svg')) {
    console.log("SUCCESS: infinite-canvas-svg is rendered!");
  } else if (html.includes('portal-container')) {
    console.log("STAYED: portal-container is still rendered!");
  } else {
    console.log("HTML length:", html.length);
    console.log("Body attributes:", await page.locator('body').evaluate(el => el.innerHTML));
  }
  console.log("----------------------------");

  await page.screenshot({ path: 'tests/e2e/debug_upload_screenshot.png' });
  console.log("Screenshot taken at tests/e2e/debug_upload_screenshot.png");

  // Clean up image file
  try {
    fs.unlinkSync(dummyImgPath);
  } catch (e) {}

  console.log("Finished page state check.");
});
