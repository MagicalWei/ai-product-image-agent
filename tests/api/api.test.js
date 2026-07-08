import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;
let serverProcess = null;
const testEmail = `test-${Date.now()}@example.com`;
const testPassword = 'testpassword123';
let testUid = null;
let verificationCode = null;
let testOrderId = null;
let dbUrl = null;
let jwtToken = null; // JWT token saved from registration / login

beforeAll(async () => {
  // Temporarily rename .env to bypass loading real API keys on startup
  const envFile = path.join(process.cwd(), '.env');
  const envBackup = path.join(process.cwd(), '.env.testbak');

  const envVars = {};
  const targetEnvFile = fs.existsSync(envFile) ? envFile : (fs.existsSync(envBackup) ? envBackup : null);
  if (targetEnvFile) {
    try {
      const envContent = fs.readFileSync(targetEnvFile, 'utf8');
      envContent.split(/\r?\n/).forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const index = trimmed.indexOf('=');
          if (index !== -1) {
            const key = trimmed.substring(0, index).trim();
            const val = trimmed.substring(index + 1).trim();
            if (key) {
              envVars[key] = val.replace(/^["']|["']$/g, '');
            }
          }
        }
      });
      dbUrl = envVars.DATABASE_URL;
    } catch (err) {
      console.error('Failed to parse env file in test config helper:', err);
    }
  }

  if (fs.existsSync(envFile)) {
    fs.renameSync(envFile, envBackup);
  }

  // Spawn the server process
  await new Promise((resolve) => {
    serverProcess = spawn('node', ['server.js'], {
      cwd: path.join(process.cwd(), 'backend'),
      env: {
        ...process.env,
        ...envVars,
        NODE_ENV: 'test',
        EMAILJS_SERVICE_ID: 'your_service_id', // force mock mode for EmailJS
        BYPASS_IP_RATE_LIMIT: 'true', // ensure rate limit is bypassed for fast API tests
      },
    });

    let resolved = false;

    serverProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(`[Server Stdout]: ${output}`);
      // Capture verification code from mock mode log
      const codeMatch = output.match(/Generated verification code (\d{6})/);
      if (codeMatch) {
        verificationCode = codeMatch[1];
      }
      if (output.includes('Node.js Backend Server running') && !resolved) {
        resolved = true;
        resolve();
      }
    });

    serverProcess.stderr.on('data', (data) => {
      console.error(`[Server Stderr]: ${data}`);
    });

    // Fallback timeout of 6 seconds in case it fails to start or outputs differently
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    }, 6000);
  });
});

afterAll(async () => {
  // Terminate the server process
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
  }

  // Restore .env
  const envFile = path.join(process.cwd(), '.env');
  const envBackup = path.join(process.cwd(), '.env.testbak');
  if (fs.existsSync(envBackup)) {
    fs.renameSync(envBackup, envFile);
  }
});

describe('AI Product Image Agent API Tests', () => {
  // 1. Send Code
  it('POST /api/auth/send-code - should send a mock verification code', async () => {
    const response = await fetch(`${BASE_URL}/api/auth/send-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail }),
    });

    const data = await response.json();
    console.log("SEND CODE DATA IN TEST:", JSON.stringify(data));
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    // In test mode, verification code is logged to stdout by the server.
    // We need to read it from server stdout for the register step.
    // For now, capture it from the mock mode log output.
    verificationCode = data.code || verificationCode;
  });

  // 2. Register
  it('POST /api/auth/register - should fail with invalid verification code', async () => {
    const response = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
        code: '000000',
      }),
    });

    const data = await response.json();
    expect(response.status).toBe(400);
    expect(data.error).toContain('验证码不正确');
  });

  it('POST /api/auth/register - should succeed with correct verification code', async () => {
    const response = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
        code: verificationCode,
      }),
    });

    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.user.email).toBe(testEmail.toLowerCase());
    expect(data.user.remaining_credits).toBe(10);
    expect(data.user.membership_type).toBe('free');
    testUid = data.user.uid;
    jwtToken = data.token; // Save token
  });

  // 3. Login
  it('POST /api/auth/login - should fail with wrong credentials', async () => {
    const response = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: 'wrongpassword',
      }),
    });

    const data = await response.json();
    expect(response.status).toBe(400);
    expect(data.error).toContain('邮箱或密码错误');
  });

  it('POST /api/auth/login - should succeed with correct credentials', async () => {
    const response = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
      }),
    });

    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.user.uid).toBe(testUid);
    jwtToken = data.token; // Save token
  });

  // 4. Profile
  it('GET /api/auth/profile/:uid - should fetch profile details', async () => {
    const response = await fetch(`${BASE_URL}/api/auth/profile/${testUid}`, {
      headers: {
        'Authorization': `Bearer ${jwtToken}`
      }
    });
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.user.email).toBe(testEmail.toLowerCase());
  });

  // 5. Sync API Keys
  it('POST /api/auth/sync-keys - should update keys in database', async () => {
    const response = await fetch(`${BASE_URL}/api/auth/sync-keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwtToken}`
      },
      body: JSON.stringify({
        uid: testUid,
        mimoKey: 'mimo_key_xyz',
        geminiKey: 'gemini_key_123',
        qwenKey: '',
        customProxy: 'http://proxy.local',
      }),
    });

    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.user.mimo_key).toBe('mimo_key_xyz');
    expect(data.user.gemini_key).toBe('gemini_key_123');
    expect(data.user.custom_proxy).toBe('http://proxy.local');
  });

  // 6. Credit Deduction (Free User)
  it('POST /api/payment/deduct - should deduct 1 credit from free user', async () => {
    const response = await fetch(`${BASE_URL}/api/payment/deduct`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwtToken}`
      },
      body: JSON.stringify({ uid: testUid }),
    });

    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.remainingCredits).toBe(9);
    expect(data.membershipType).toBe('free');
  });

  // 7. Order & Payment Upgrades
  it('POST /api/payment/create-order - should initiate pending order', async () => {
    const response = await fetch(`${BASE_URL}/api/payment/create-order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwtToken}`
      },
      body: JSON.stringify({
        userId: testUid,
        planId: 'pro_monthly',
      }),
    });

    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.order.orderId).toBeDefined();
    expect(data.order.amount).toBe(9.9);
    expect(data.order.status).toBe('pending');
    testOrderId = data.order.orderId;
  });

  it('GET /api/payment/status/:orderId - should return pending status', async () => {
    const response = await fetch(`${BASE_URL}/api/payment/status/${testOrderId}`, {
      headers: {
        'Authorization': `Bearer ${jwtToken}`
      }
    });
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.status).toBe('pending');
  });

  // 8. Unlimited Credit for Pro User
  it('POST /api/payment/deduct - should not deduct credits for Pro VIP', async () => {
    // Manually upgrade user via test-upgrade endpoint instead of direct SQL connection
    const upgradeRes = await fetch(`${BASE_URL}/api/auth/test-upgrade`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwtToken}`
      },
      body: JSON.stringify({
        uid: testUid,
        membershipType: 'pro',
        billingCycle: 'monthly',
        remainingCredits: 500
      })
    });
    const upgradeData = await upgradeRes.json();
    expect(upgradeData.success).toBe(true);

    const response = await fetch(`${BASE_URL}/api/payment/deduct`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwtToken}`
      },
      body: JSON.stringify({ uid: testUid }),
    });

    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.remainingCredits).toBe('unlimited');
    expect(data.membershipType).toBe('pro');
  });

  // 9. Image generation & evaluation endpoints
  it('POST /api/generate/evaluate - should return evaluation metrics (mock fallback)', async () => {
    const response = await fetch(`${BASE_URL}/api/generate/evaluate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwtToken}`
      },
      body: JSON.stringify({
        uid: testUid,
        image: 'non_existent_image.png', // force mock fallback since real API keys are mock/invalid in tests
        productInfo: { name: '香水', sellingPoints: '清新' },
        instruction: '评估图片',
      }),
    });

    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.metrics.ctr).toBeDefined();
    expect(data.metrics.quality).toBeDefined();
  });

  it('POST /api/generate/matting - should return matting instructions ready', async () => {
    const response = await fetch(`${BASE_URL}/api/generate/matting`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwtToken}`
      },
      body: JSON.stringify({
        uid: testUid,
        image: 'french_vintage.png',
        sampleId: 'perfume',
      }),
    });

    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.message).toContain('抠图处理就绪');
  });

  it('POST /api/generate/inpaint - should return mock inpainting result', async () => {
    const response = await fetch(`${BASE_URL}/api/generate/inpaint`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwtToken}`
      },
      body: JSON.stringify({
        uid: testUid,
        image: 'french_vintage.png',
        mask: 'data:image/png;base64,mockmask...',
        prompt: '在沙滩阳光下',
        fidelity: 90,
        isCustomProduct: false,
        productInfo: { name: '香水', sellingPoints: '清新' },
      }),
    });

    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.image).toContain('outdoor_sunlight.png'); // prompt contained "沙滩"
    expect(data.metrics.ctr).toBeGreaterThan(5.0); // outdoor_sunlight has base CTR 5.2
  });
});
