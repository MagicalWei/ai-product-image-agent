import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';

const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;
const testEmail = `journey-${Date.now()}@example.com`;
const testPassword = 'testpassword123';

let serverProcess;
let verificationCode;
let sessionCookie = '';
let testUid;
let uploadedAsset;
let styleReferenceAsset;
let designSessionId;
let fakeAgentServer;
let capturedAgentBody;

function request(pathname, options = {}) {
  const headers = new Headers(options.headers || {});
  if (sessionCookie) headers.set('cookie', sessionCookie);
  return fetch(`${BASE_URL}${pathname}`, { ...options, headers });
}

function captureSessionCookie(response) {
  const cookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  sessionCookie = cookies
    .map((value) => value.split(';', 1)[0])
    .filter(Boolean)
    .join('; ');
}

async function waitFor(predicate, timeoutMs = 8_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

beforeAll(async () => {
  fakeAgentServer = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"status":"ok"}');
      return;
    }
    if (req.url === '/agent/run-stream' && req.method === 'POST') {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => {
        capturedAgentBody = JSON.parse(raw);
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        if (capturedAgentBody.message === '开始新设计') {
          res.write('data: {"event":"new_design_started","text":"已开始新的设计，之前的对话仍然保留。"}\n\n');
        } else {
          res.write('data: {"event":"agent_message","agent":"agent","text":"已根据商品图开始生成自然场景卖点图。"}\n\n');
        }
        res.write(`data: ${JSON.stringify({
          event: 'memory_updated',
          agent_memory: {
            ...capturedAgentBody.agent_memory,
            style_preference: '自然场景',
            image_types: ['selling_point'],
          },
        })}\n\n`);
        res.end('data: {"event":"done"}\n\n');
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => fakeAgentServer.listen(8100, '127.0.0.1', resolve));

  serverProcess = spawn('node', ['server.js'], {
    cwd: path.join(process.cwd(), 'backend'),
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'test',
      FRONTEND_URL: 'http://localhost:5173',
      CORS_ORIGIN: 'http://localhost:5173',
      AI_SERVICE_URL: 'http://127.0.0.1:8100',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  const collectOutput = (chunk) => {
    const text = chunk.toString();
    output += text;
    const match = text.match(/Verification code (\d{6}) for /);
    if (match) verificationCode = match[1];
  };
  serverProcess.stdout.on('data', collectOutput);
  serverProcess.stderr.on('data', collectOutput);

  await waitFor(() => {
    if (serverProcess.exitCode !== null) {
      throw new Error(`Test server exited (${serverProcess.exitCode}):\n${output}`);
    }
    return output.includes(`localhost:${PORT}`);
  }, 12_000);
}, 15_000);

afterAll(async () => {
  if (serverProcess && serverProcess.exitCode === null) {
    serverProcess.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => serverProcess.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
  }
  if (fakeAgentServer) await new Promise((resolve) => fakeAgentServer.close(resolve));
});

describe.sequential('registered user API journey', () => {
  it('rejects protected endpoints before login', async () => {
    const response = await fetch(`${BASE_URL}/api/custom-auth/me`);
    expect(response.status).toBe(401);
  });

  it('creates an unverified account and sends a verification code', async () => {
    const signUp = await request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword, name: 'Journey Test' }),
    });
    expect(signUp.status).toBe(200);

    verificationCode = undefined;
    const send = await request('/api/auth/send-verification-email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: testEmail }),
    });
    expect(send.status).toBe(200);
    await waitFor(() => verificationCode);
    expect(verificationCode).toMatch(/^\d{6}$/);
  });

  it('rejects an invalid code and accepts the current code', async () => {
    const invalid = await request('/api/custom-auth/verify-code', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: testEmail, code: '000000' }),
    });
    expect(invalid.status).toBe(400);

    const valid = await request('/api/custom-auth/verify-code', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: testEmail, code: verificationCode }),
    });
    expect(valid.status).toBe(200);
    expect(await valid.json()).toMatchObject({ success: true });
  });

  it('signs in with a cookie session and returns the current profile', async () => {
    const wrong = await request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: 'wrongpassword' }),
    });
    expect(wrong.status).toBeGreaterThanOrEqual(400);

    const signIn = await request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    expect(signIn.status).toBe(200);
    captureSessionCookie(signIn);
    expect(sessionCookie).toContain('better-auth.session_token=');

    const profile = await request('/api/custom-auth/me');
    expect(profile.status).toBe(200);
    const data = await profile.json();
    expect(data.user.email).toBe(testEmail);
    expect(data.user.emailVerified).toBe(true);
    testUid = data.user.uid;
  });

  it('syncs account-specific settings', async () => {
    const response = await request('/api/custom-auth/sync-keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ evalKey1: 'test-key-1', customProxy: 'http://proxy.local' }),
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.user.mimo_key).toBe('test-key-1');
    expect(data.user.custom_proxy).toBe('http://proxy.local');
  });

  it('creates a product design session', async () => {
    const clientSessionId = `session-${crypto.randomUUID()}`;
    const body = JSON.stringify({ title: '商品图回归会话', client_session_id: clientSessionId });
    const response = await request('/api/agent/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    expect(response.status).toBe(200);
    designSessionId = (await response.json()).session.session_id;
    expect(designSessionId).toBe(clientSessionId);

    const repeated = await request('/api/agent/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    expect(repeated.status).toBe(200);
    expect((await repeated.json()).session.session_id).toBe(clientSessionId);
  });

  it('uploads, lists, counts, and deletes a cloud asset', async () => {
    const onePixelPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const clientUploadId = crypto.randomUUID();
    const uploadBody = JSON.stringify({
      name: 'journey.png',
      data: onePixelPng,
      session_id: designSessionId,
      client_upload_id: clientUploadId,
    });
    const upload = await request('/api/assets/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: uploadBody,
    });
    expect(upload.status, await upload.clone().text()).toBe(200);
    uploadedAsset = (await upload.json()).asset;
    expect(uploadedAsset.url).toMatch(/^\/uploads\//);

    const repeatedUpload = await request('/api/assets/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: uploadBody,
    });
    expect(repeatedUpload.status).toBe(200);
    const repeatedData = await repeatedUpload.json();
    expect(repeatedData.idempotent).toBe(true);
    expect(repeatedData.asset.id).toBe(uploadedAsset.id);

    const list = await request('/api/assets');
    expect(list.status).toBe(200);
    const listedAssets = (await list.json()).assets;
    expect(listedAssets.filter((asset) => asset.id === uploadedAsset.id)).toHaveLength(1);

    const stats = await request('/api/assets/stats');
    expect(stats.status).toBe(200);
    expect((await stats.json()).totalAssets).toBeGreaterThanOrEqual(1);

  });

  it('restores the confirmed product image and persists the complete conversation', async () => {
    const analysis = {
      product: { product_name: '军事士兵人偶模型', product_category: '玩具/模型', confidence: 0.95 },
      visible_facts: ['绿色迷彩服与头盔清晰可见'],
      selling_points: [{
        title: '经典军事题材造型',
        description: '迷彩服与头盔造型',
        visual_evidence: '图中可见绿色迷彩服与头盔',
        confidence: 0.9,
        verification: 'confirmed_visual',
      }],
      uncertain_claims: ['材质无法从图片确认'],
      image_quality: { subject_complete: true, clarity: 'good', issues: [] },
    };
    const confirm = await request(`/api/agent/sessions/${designSessionId}/product-analysis/confirm`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ analysis }),
    });
    expect(confirm.status, await confirm.clone().text()).toBe(200);

    const stream = await request('/api/agent/chat-stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: designSessionId, message: '自然场景，卖点图' }),
    });
    expect(stream.status, await stream.clone().text()).toBe(200);
    expect(await stream.text()).toContain('已根据商品图开始生成自然场景卖点图。');
    expect(capturedAgentBody.product_image_base64).toMatch(/^data:image\/png;base64,/);
    expect(capturedAgentBody.agent_memory).toMatchObject({
      product_name: '军事士兵人偶模型',
      product_analysis_confirmed: true,
    });

    const restored = await request(`/api/agent/sessions/${designSessionId}`);
    expect(restored.status).toBe(200);
    const session = (await restored.json()).session;
    expect(session.chat_history.slice(-2)).toEqual([
      { role: 'user', content: '自然场景，卖点图' },
      { role: 'assistant', content: '已根据商品图开始生成自然场景卖点图。' },
    ]);
    expect(session.last_params.product_image_url).toBe(uploadedAsset.url);
    expect(session.agent_memory).toMatchObject({
      style_preference: '自然场景',
      image_types: ['selling_point'],
    });

    const remove = await request(`/api/assets/${uploadedAsset.id}`, { method: 'DELETE' });
    expect(remove.status).toBe(200);
  });

  it('keeps earlier messages when a new design starts in the same session', async () => {
    const stream = await request('/api/agent/chat-stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: designSessionId, message: '开始新设计' }),
    });
    expect(stream.status, await stream.clone().text()).toBe(200);
    await stream.text();

    const restored = await request(`/api/agent/sessions/${designSessionId}`);
    const history = (await restored.json()).session.chat_history;
    expect(history).toContainEqual({ role: 'user', content: '自然场景，卖点图' });
    expect(history.slice(-2)).toEqual([
      { role: 'user', content: '开始新设计' },
      { role: 'assistant', content: '已开始新的设计，之前的对话仍然保留。' },
    ]);
  });

  it('persists a style reference and restores it for a later Agent turn', async () => {
    const styleDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const upload = await request('/api/assets/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'style-reference.png',
        data: styleDataUrl,
        session_id: designSessionId,
        client_upload_id: crypto.randomUUID(),
        metrics: { asset_role: 'style_reference' },
      }),
    });
    expect(upload.status, await upload.clone().text()).toBe(200);
    styleReferenceAsset = (await upload.json()).asset;

    const firstTurn = await request('/api/agent/chat-stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session_id: designSessionId,
        message: '按照参考风格生成一张卖点图',
        style_transfer_mode: true,
        style_reference_images: [styleDataUrl],
        message_images: [{
          id: styleReferenceAsset.id,
          name: styleReferenceAsset.name,
          url: styleReferenceAsset.url,
          role: 'style_reference',
        }],
      }),
    });
    expect(firstTurn.status, await firstTurn.clone().text()).toBe(200);
    await firstTurn.text();
    expect(capturedAgentBody.style_reference_images).toEqual([styleDataUrl]);
    expect(capturedAgentBody.agent_memory.style_reference_image_urls).toEqual([
      styleReferenceAsset.url,
    ]);

    const laterTurn = await request('/api/agent/chat-stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session_id: designSessionId,
        message: '再生成一张同风格详情图',
      }),
    });
    expect(laterTurn.status, await laterTurn.clone().text()).toBe(200);
    await laterTurn.text();
    expect(capturedAgentBody.style_reference_images).toHaveLength(1);
    expect(capturedAgentBody.style_reference_images[0]).toMatch(/^data:image\/png;base64,/);
    expect(capturedAgentBody.agent_memory).toMatchObject({
      style_reference_image_urls: [styleReferenceAsset.url],
      reference_images_intent: 'style_transfer',
    });

    const restored = await request(`/api/agent/sessions/${designSessionId}`);
    expect((await restored.json()).session.agent_memory.style_reference_image_urls).toEqual([
      styleReferenceAsset.url,
    ]);
  });

  it('deducts credits and preserves credits for a pro account', async () => {
    const deduct = await request('/api/payment/deduct', { method: 'POST' });
    expect(deduct.status, await deduct.clone().text()).toBe(200);
    expect((await deduct.json()).remainingCredits).toBe(9);

    const upgrade = await request('/api/custom-auth/test-upgrade', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ uid: testUid, membershipType: 'pro', billingCycle: 'monthly', remainingCredits: 500 }),
    });
    expect(upgrade.status).toBe(200);

    const proDeduct = await request('/api/payment/deduct', { method: 'POST' });
    expect(proDeduct.status).toBe(200);
    expect(await proDeduct.json()).toMatchObject({ remainingCredits: 'unlimited', membershipType: 'pro' });
  });

  it('supports repeated sign-out and sign-in cycles without losing the session cookie', async () => {
    for (let index = 0; index < 3; index += 1) {
      if (index > 0) {
        const signInAgain = await request('/api/auth/sign-in/email', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: testEmail, password: testPassword }),
        });
        expect(signInAgain.status).toBe(200);
        captureSessionCookie(signInAgain);
      }
      const profile = await request('/api/custom-auth/me');
      expect(profile.status).toBe(200);
      if (index < 2) {
        const signOutCycle = await request('/api/auth/sign-out', { method: 'POST' });
        expect(signOutCycle.status).toBe(200);
        sessionCookie = '';
      }
    }
  });

  it('signs out and invalidates access', async () => {
    const signOut = await request('/api/auth/sign-out', { method: 'POST' });
    expect(signOut.status).toBe(200);
    sessionCookie = '';
    expect((await fetch(`${BASE_URL}/api/custom-auth/me`)).status).toBe(401);
  });
});
