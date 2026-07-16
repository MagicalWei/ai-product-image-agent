import { test, expect } from '@playwright/test';
import path from 'node:path';

const analysisFixture = {
  schema_version: '1.0',
  status: 'draft',
  product: { product_name: '军事士兵人偶玩具', product_category: '玩具/模型', confidence: 0.95 },
  visible_facts: ['绿色制服人偶', '配有头盔与武器造型配件', '白色背景'],
  selling_points: [
    { title: '经典军事造型', description: '完整制服与头盔造型', visual_evidence: '图中可见绿色制服和头盔', confidence: 0.9, verification: 'confirmed_visual' },
    { title: '立体细节刻画', description: '服装口袋和褶皱清晰', visual_evidence: '胸前口袋与衣物纹理可见', confidence: 0.85, verification: 'confirmed_visual' },
    { title: '适合场景搭建', description: '站立姿态便于陈列', visual_evidence: '人偶保持稳定站立姿态', confidence: 0.72, verification: 'likely_visual' },
  ],
  uncertain_claims: ['材质成分与具体尺寸无法仅凭图片确认'],
  image_quality: { subject_complete: true, clarity: 'good', issues: [] },
};

test.describe('new user MVP journey', () => {
  test('registers, uploads a product, confirms selling points, and restores the session', async ({ page, request }) => {
    const timings = {};
    await page.route('**/api/agent/analyze-product-image', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, analysis: analysisFixture }) });
    });

    const firstScreenStarted = Date.now();
    await page.goto('/');
    await expect(page).toHaveTitle(/AI 商品图与广告创意决策系统/);
    const skip = page.getByRole('button', { name: '跳过', exact: true });
    await expect(skip).toBeVisible({ timeout: 10_000 });
    timings.first_screen = Date.now() - firstScreenStarted;
    expect(timings.first_screen).toBeLessThan(3_000);
    await skip.click();
    await expect(page.getByText('图片编辑', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: '登录/注册', exact: true }).click();
    await page.getByRole('button', { name: '免费注册', exact: true }).first().click();

    const email = `e2e-${Date.now()}@example.com`;
    const password = 'E2ePassword123!';
    await page.getByPlaceholder('您的昵称（选填）', { exact: true }).fill('E2E 用户');
    await page.getByPlaceholder('name@example.com', { exact: true }).fill(email);
    await page.getByPlaceholder('输入 6 位及以上密码', { exact: true }).fill(password);
    const verificationStarted = Date.now();
    await page.getByRole('button', { name: '获取验证码', exact: true }).click();
    await expect(page.getByText('验证码已发送到您的邮箱，请查收！', { exact: true })).toBeVisible({ timeout: 15_000 });
    timings.verification_code = Date.now() - verificationStarted;
    expect(timings.verification_code).toBeLessThan(15_000);

    const codeResponse = await request.get(`/api/custom-auth/test-verification-code?email=${encodeURIComponent(email)}`);
    expect(codeResponse.ok()).toBeTruthy();
    const { code } = await codeResponse.json();
    await page.getByPlaceholder('6位验证码', { exact: true }).fill(code);
    const registrationStarted = Date.now();
    await page.getByRole('button', { name: '同意服务条款并注册', exact: true }).click();
    await expect(page.locator('.user-profile')).toBeVisible({ timeout: 15_000 });
    timings.registration = Date.now() - registrationStarted;
    expect(timings.registration).toBeLessThan(15_000);

    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByText('图片编辑', { exact: true }).click();
    const fileChooser = await fileChooserPromise;
    const analysisStarted = Date.now();
    await fileChooser.setFiles(path.resolve('frontend/public/uploads/upload_1784136552020_315.png'));

    await expect(page.locator('.infinite-canvas-svg')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('商品图识别草稿', { exact: true })).toBeVisible({ timeout: 15_000 });
    timings.analysis_card_mocked_model = Date.now() - analysisStarted;
    expect(timings.analysis_card_mocked_model).toBeLessThan(15_000);
    await expect(page.getByRole('button', { name: '确认商品信息（3 条卖点）', exact: true })).toBeVisible();
    const confirmationStarted = Date.now();
    await page.getByRole('button', { name: '确认商品信息（3 条卖点）', exact: true }).click();
    await expect(page.getByText('商品信息已确认', { exact: true })).toBeVisible({ timeout: 15_000 });
    timings.confirmation = Date.now() - confirmationStarted;
    expect(timings.confirmation).toBeLessThan(15_000);

    const restoreStarted = Date.now();
    await page.reload();
    await expect(page.locator('.user-profile')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('商品信息已确认', { exact: true })).toBeVisible({ timeout: 15_000 });
    timings.session_restore = Date.now() - restoreStarted;
    expect(timings.session_restore).toBeLessThan(15_000);
    console.log('E2E timings (ms):', timings);
  });
});
