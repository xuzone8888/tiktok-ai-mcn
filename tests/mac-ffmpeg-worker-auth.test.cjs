const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const { readFileSync } = require('node:fs');
const net = require('node:net');
const { resolve } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const workerPath = resolve('mac-ffmpeg-worker/server.js');

function runRejectedWorker(token) {
  return new Promise((resolvePromise, rejectPromise) => {
    const environment = {
      ...process.env,
      DOTENV_CONFIG_QUIET: 'true',
    };
    if (token === undefined) environment.WORKER_AUTH_TOKEN = '';
    else environment.WORKER_AUTH_TOKEN = token;

    const child = spawn(process.execPath, [workerPath], {
      cwd: resolve('.'),
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', rejectPromise);
    const timer = setTimeout(() => {
      child.kill();
      rejectPromise(new Error('Worker did not fail closed within five seconds'));
    }, 5_000);
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolvePromise({ code, signal, stdout, stderr });
    });
  });
}

function workerRuntimeDependenciesAvailable() {
  try {
    require.resolve('express');
    require.resolve('dotenv');
    require.resolve('ali-oss');
    return true;
  } catch {
    return false;
  }
}

function reserveLoopbackPort() {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = net.createServer();
    server.once('error', rejectPromise);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close((error) => {
        if (error) rejectPromise(error);
        else if (!Number.isInteger(port)) rejectPromise(new Error('No loopback port'));
        else resolvePromise(port);
      });
    });
  });
}

function startWorker(port, token) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [workerPath], {
      cwd: resolve('.'),
      env: {
        ...process.env,
        DOTENV_CONFIG_QUIET: 'true',
        WORKER_AUTH_TOKEN: token,
        WORKER_PORT: String(port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let output = '';
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) rejectPromise(error);
      else resolvePromise(child);
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    const observe = (chunk) => {
      output += chunk;
      if (output.length > 256 * 1024) {
        child.kill();
        finish(new Error('Worker startup output exceeded the test limit'));
      } else if (output.includes(`FFmpeg Worker running on port ${port}`)) {
        finish();
      }
    };
    child.stdout.on('data', observe);
    child.stderr.on('data', observe);
    child.once('error', finish);
    child.once('close', (code, signal) => {
      if (!settled) {
        finish(new Error(`Worker exited before readiness: code=${code} signal=${signal}`));
      }
    });
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error('Worker did not become ready within ten seconds'));
    }, 10_000);
  });
}

async function stopWorker(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise((resolvePromise) => child.once('close', resolvePromise));
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
  await closed;
  clearTimeout(timer);
}

async function requestWorker(port, pathname, { token, body } = {}) {
  const headers = {};
  if (token !== undefined) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    body,
  });
  await response.arrayBuffer();
  return response.status;
}

test('Mac Worker source enforces strict loopback Bearer authentication', () => {
  const source = readFileSync(workerPath, 'utf8');
  assert.match(source, /if \(!\/\^\[0-9a-f\]\{64\}\$\/\.test\(AUTH_TOKEN\)\)/);
  assert.match(source, /\^Bearer \(\[0-9a-f\]\{64\}\)\$/);
  assert.match(source, /crypto\.timingSafeEqual\(presentedToken, AUTH_TOKEN_BUFFER\)/);
  assert.match(source, /delete process\.env\.WORKER_AUTH_TOKEN/);
  assert.match(source, /app\.use\('\/api', authMiddleware\)/);
  assert.match(source, /app\.use\('\/health', authMiddleware\)/);
  assert.match(source, /app\.listen\(PORT, '127\.0\.0\.1'/);
  assert.doesNotMatch(source, /if \(!AUTH_TOKEN\) return next\(\)/);
  assert.ok(
    source.indexOf("app.use('/api', authMiddleware)") <
      source.indexOf("app.use('/api', express.json"),
    'authentication must run before the large JSON body parser'
  );
  assert.ok(
    source.indexOf('WORKER_AUTH_TOKEN must be exactly 64') <
      source.indexOf("const express = require('express')"),
    'token validation must run before optional Worker dependencies load'
  );
});

test('Mac Worker middleware accepts only the exact configured Bearer token', () => {
  const expectedToken = 'c'.repeat(64);
  const source = readFileSync(workerPath, 'utf8');
  const functionStart = source.indexOf('function authMiddleware');
  const functionEnd = source.indexOf("\napp.use('/api', authMiddleware)", functionStart);
  assert.ok(functionStart >= 0 && functionEnd > functionStart);
  const authMiddleware = vm.runInNewContext(
    `(${source.slice(functionStart, functionEnd)})`,
    {
      AUTH_TOKEN_BUFFER: Buffer.from(expectedToken, 'ascii'),
      Buffer,
      crypto,
    }
  );

  const invoke = (authorization) => {
    const request = { headers: {} };
    if (authorization !== undefined) request.headers.authorization = authorization;
    const observation = { nextCalls: 0, status: null, body: null };
    const response = {
      status(code) {
        observation.status = code;
        return this;
      },
      json(body) {
        observation.body = body;
        return this;
      },
    };
    authMiddleware(request, response, () => { observation.nextCalls += 1; });
    return observation;
  };

  assert.deepEqual(invoke(`Bearer ${expectedToken}`), {
    nextCalls: 1,
    status: null,
    body: null,
  });
  for (const authorization of [
    undefined,
    `bearer ${expectedToken}`,
    `Bearer  ${expectedToken}`,
    `Bearer ${expectedToken} `,
    `Bearer ${expectedToken.toUpperCase()}`,
    `Bearer ${'d'.repeat(64)}`,
    [`Bearer ${expectedToken}`],
  ]) {
    const result = invoke(authorization);
    assert.equal(result.nextCalls, 0);
    assert.equal(result.status, 401);
    assert.equal(result.body?.error, 'Unauthorized');
  }
});

test('Mac Worker refuses missing, weak, uppercase, short, and long tokens', async () => {
  const invalidTokens = [
    undefined,
    'weak-worker-token',
    'A'.repeat(64),
    'a'.repeat(63),
    'a'.repeat(65),
  ];

  for (const token of invalidTokens) {
    const result = await runRejectedWorker(token);
    const output = `${result.stdout}\n${result.stderr}`;
    assert.notEqual(result.code, 0);
    assert.match(output, /Refusing to start: WORKER_AUTH_TOKEN must be exactly 64/);
    if (token) assert.doesNotMatch(output, new RegExp(token));
  }
});

test(
  'Mac Worker enforces authentication on real loopback health and API requests',
  { skip: workerRuntimeDependenciesAvailable() ? false : 'Mac Worker dependencies are not installed' },
  async () => {
    const token = 'c'.repeat(64);
    const wrongToken = 'd'.repeat(64);
    const port = await reserveLoopbackPort();
    const child = await startWorker(port, token);
    try {
      assert.equal(await requestWorker(port, '/health'), 401);
      assert.equal(await requestWorker(port, '/health', { token: wrongToken }), 401);
      assert.equal(await requestWorker(port, '/health', { token }), 200);
      assert.equal(await requestWorker(port, '/api/render', { body: '{' }), 401);
      assert.equal(await requestWorker(port, '/api/render', { token, body: '{' }), 400);
    } finally {
      await stopWorker(child);
    }
  }
);
