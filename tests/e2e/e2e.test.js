import { test, expect } from '@playwright/test';

test.describe('AI Product Image Agent E2E User Flows', () => {
  test('should complete the entire user journey in Mock mode', async ({ page }) => {
    // 1. Visit Portal
    await page.goto('/');
    await expect(page).toHaveTitle(/AI 商品图与广告创意决策系统/);
    await expect(page.locator('text=和我聊聊，你想设计什么商品图～')).toBeVisible();

    // 2. Auth Registration & Login
    // Click Login/Register button in the top header
    await page.locator('button:has-text("登录/注册")').click();
    
    // Switch to Register tab
    await page.locator('button:has-text("免费注册")').first().click();
    
    const uniqueEmail = `e2e-${Date.now()}@example.com`;
    await page.locator('input[type="email"]').fill(uniqueEmail);
    await page.locator('input[type="password"]').fill('e2epassword123');
    
    // Request code
    await page.locator('button:has-text("获取验证码")').click();
    
    // The mock backend returns the code, and the frontend automatically auto-fills it after 1s
    await page.waitForTimeout(1500);
    const codeValue = await page.locator('input[placeholder="6位验证码"]').inputValue();
    expect(codeValue.length).toBe(6);
    
    // Submit registration
    await page.locator('button:has-text("同意服务条款并注册")').click();
    
    // Verify user profile avatar is visible (login successful)
    await page.waitForTimeout(2000);
    await expect(page.locator('.user-profile')).toBeVisible();



    // 4. Launch Onboarding & Create V1 Design
    // Click "创建设计" card on Portal
    await page.locator('text=创建设计').click();
    await expect(page.locator('text=AI 电商商品图创作向导')).toBeVisible();
    
    // Select built-in product and style
    await page.locator('text=复古蕾丝连衣裙').click();
    await page.locator('text=户外阳光').click();
    
    // Launch generator
    await page.locator('button:has-text("启动 AI 抠图并生成商品图")').click();
    
    // Verify redirection to Workspace (SimpleMode container is visible)
    await expect(page.locator('.simple-mode-container')).toBeVisible();
    
    // Wait for mock generation spinner to close and V1 bullet to load
    await page.waitForTimeout(3000);
    await expect(page.locator('button:has-text("V1")')).toBeVisible();
    
    // 5. Chat Mode & Mask Drawing Inpainting (V2)
    // Verify Simple Mode elements
    await expect(page.locator('text=AI 智能设计顾问')).toBeVisible();
    
    // Toggle brush mask mode
    await page.locator('button:has-text("圈选局部修改")').click();
    await expect(page.locator('text=局部修改模式开启')).toBeVisible();
    
    // Drag on canvas overlay to simulate drawing a mask
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.move(box.x + 100, box.y + 100);
      await page.mouse.down();
      await page.mouse.move(box.x + 200, box.y + 200);
      await page.mouse.up();
    }
    
    // Enter prompt and submit inpainting
    await page.locator('input[placeholder="请描述如何修改您圈选的这部分区域..."]').fill('换背景为沙滩');
    await page.locator('.chat-send-btn').click();
    
    // Wait for inpainting spinner and version commit
    await page.waitForTimeout(3000);
    await expect(page.locator('button:has-text("V2")')).toBeVisible();

    // 6. Cowork Mode (Infinite Canvas)
    // Switch to Cowork Mode
    await page.locator('button:has-text("Cowork Mode")').click();
    await expect(page.locator('.infinite-canvas-svg')).toBeVisible();
    
    // Go back to Chat Mode
    await page.locator('button:has-text("Chat Mode")').click();
    await expect(page.locator('.simple-mode-container')).toBeVisible();

    // 7. Billing & Upgrades
    // Click pricing button in the header
    await page.locator('button:has-text("9.9元开通会员")').click();
    await expect(page.locator('text=升级尊贵会员，释放极致生图力')).toBeVisible();
    
    // Close modal
    await page.locator('.onboarding-modal-close').click();
  });
});
