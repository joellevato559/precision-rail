/**
 * Pluggable push notification service.
 *
 * NOTIFY_PROVIDER:
 *   console  (default) — logs only; always works in dev
 *   webhook  — POST JSON to NOTIFY_WEBHOOK_URL
 *   fcm      — Firebase Cloud Messaging via firebase-admin
 *
 * FCM credentials (any one of):
 *   FIREBASE_SERVICE_ACCOUNT_PATH  — path to service account JSON file
 *   FIREBASE_SERVICE_ACCOUNT_JSON  — full JSON string (e.g. from secret manager)
 *   GOOGLE_APPLICATION_CREDENTIALS — standard Google env path to JSON file
 *
 * Optional:
 *   FIREBASE_PROJECT_ID — overrides project_id in the service account
 */

const fs = require('fs');
const path = require('path');
const { query } = require('../db');

const PROVIDER = (process.env.NOTIFY_PROVIDER || 'console').toLowerCase();
const WEBHOOK_URL = process.env.NOTIFY_WEBHOOK_URL || '';

let fcmApp = null;
let fcmInitError = null;

function loadServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    } catch (err) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON');
    }
  }

  const filePath =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    '';

  if (!filePath) {
    throw new Error(
      'FCM requires FIREBASE_SERVICE_ACCOUNT_PATH, FIREBASE_SERVICE_ACCOUNT_JSON, or GOOGLE_APPLICATION_CREDENTIALS'
    );
  }

  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Firebase service account file not found: ${resolved}`);
  }

  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

function initFcm() {
  if (fcmApp) return fcmApp;
  if (fcmInitError) throw fcmInitError;

  try {
    // Lazy require so console/webhook work without firebase-admin installed
    const admin = require('firebase-admin');
    if (admin.apps.length) {
      fcmApp = admin.app();
      return fcmApp;
    }

    const sa = loadServiceAccount();
    const projectId = process.env.FIREBASE_PROJECT_ID || sa.project_id;

    fcmApp = admin.initializeApp({
      credential: admin.credential.cert(sa),
      projectId
    });

    console.log(`[notify] FCM initialized for project ${projectId}`);
    return fcmApp;
  } catch (err) {
    fcmInitError = err;
    console.error('[notify] FCM init failed:', err.message);
    throw err;
  }
}

async function logNotification({ companyId, userId, title, body, data, status, provider, error }) {
  try {
    await query(
      `INSERT INTO notification_log
        (company_id, user_id, channel, title, body, data, status, provider, error)
       VALUES ($1,$2,'push',$3,$4,$5,$6,$7,$8)`,
      [
        companyId,
        userId || null,
        title,
        body || null,
        data ? JSON.stringify(data) : null,
        status || 'sent',
        provider || PROVIDER,
        error || null
      ]
    );
  } catch (err) {
    console.error('[notify] log failed', err.message);
  }
}

async function getTokensForUser(userId) {
  const { rows } = await query(
    `SELECT id, token, platform FROM device_tokens
     WHERE user_id = $1 AND active = true`,
    [userId]
  );
  return rows;
}

async function getUsersByRoles(companyId, roles) {
  const { rows } = await query(
    `SELECT id, name, email, role FROM users
     WHERE company_id = $1 AND active = true AND role = ANY($2::user_role[])`,
    [companyId, roles]
  );
  return rows;
}

async function deactivateToken(token) {
  try {
    await query(`UPDATE device_tokens SET active = false WHERE token = $1`, [token]);
  } catch (err) {
    console.error('[notify] deactivate token failed', err.message);
  }
}

async function sendFcm(tokens, payload) {
  const admin = require('firebase-admin');
  initFcm();

  const message = {
    notification: {
      title: payload.title,
      body: payload.body || ''
    },
    data: Object.fromEntries(
      Object.entries(payload.data || {}).map(([k, v]) => [k, String(v)])
    ),
    tokens: tokens.map((t) => t.token)
  };

  // multicast (up to 500 tokens)
  const response = await admin.messaging().sendEachForMulticast(message);

  let success = 0;
  const errors = [];
  response.responses.forEach((r, i) => {
    if (r.success) {
      success += 1;
    } else {
      const code = r.error?.code || '';
      const token = tokens[i]?.token;
      errors.push({ token: token?.slice(0, 16), code, message: r.error?.message });
      // Invalid / unregistered → deactivate
      if (
        code.includes('registration-token-not-registered') ||
        code.includes('invalid-registration-token') ||
        code.includes('invalid-argument')
      ) {
        if (token) deactivateToken(token);
      }
    }
  });

  return {
    provider: 'fcm',
    delivered: success,
    failureCount: response.failureCount,
    errors
  };
}

async function deliver(tokens, payload) {
  if (PROVIDER === 'fcm') {
    return sendFcm(tokens, payload);
  }

  if (PROVIDER === 'webhook' && WEBHOOK_URL) {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tokens: tokens.map((t) => ({ token: t.token, platform: t.platform })),
        notification: payload
      })
    });
    if (!res.ok) {
      throw new Error(`Webhook ${res.status}`);
    }
    return { provider: 'webhook', delivered: tokens.length };
  }

  console.log('[notify:push]', {
    to: tokens.map((t) => `${t.platform}:${t.token.slice(0, 12)}…`),
    title: payload.title,
    body: payload.body,
    data: payload.data
  });
  return { provider: 'console', delivered: tokens.length };
}

async function sendToUser(userId, companyId, { title, body, data }) {
  const tokens = await getTokensForUser(userId);
  const payload = { title, body, data: data || {} };

  if (!tokens.length) {
    await logNotification({
      companyId,
      userId,
      title,
      body,
      data,
      status: 'no_device',
      provider: PROVIDER
    });
    return { sent: 0, reason: 'no_device' };
  }

  try {
    const result = await deliver(tokens, payload);
    await logNotification({
      companyId,
      userId,
      title,
      body,
      data,
      status: result.delivered > 0 ? 'sent' : 'failed',
      provider: result.provider,
      error: result.errors?.length ? JSON.stringify(result.errors.slice(0, 3)) : null
    });
    return {
      sent: result.delivered,
      provider: result.provider,
      failureCount: result.failureCount || 0,
      errors: result.errors
    };
  } catch (err) {
    await logNotification({
      companyId,
      userId,
      title,
      body,
      data,
      status: 'failed',
      provider: PROVIDER,
      error: err.message
    });
    return { sent: 0, error: err.message };
  }
}

async function sendToRoles(companyId, roles, { title, body, data }) {
  const users = await getUsersByRoles(companyId, roles);
  const results = [];
  for (const u of users) {
    results.push({
      userId: u.id,
      ...(await sendToUser(u.id, companyId, { title, body, data }))
    });
  }
  return results;
}

function notifyAsync(fn) {
  Promise.resolve()
    .then(fn)
    .catch((err) => console.error('[notify]', err.message));
}

/** Health helper for /health or admin checks */
function fcmStatus() {
  if (PROVIDER !== 'fcm') {
    return { provider: PROVIDER, fcm: 'not_selected' };
  }
  try {
    initFcm();
    return { provider: 'fcm', fcm: 'ready', projectId: process.env.FIREBASE_PROJECT_ID || null };
  } catch (err) {
    return { provider: 'fcm', fcm: 'error', error: err.message };
  }
}

module.exports = {
  sendToUser,
  sendToRoles,
  notifyAsync,
  getTokensForUser,
  fcmStatus,
  PROVIDER
};
