// Webhook รับ event จาก LINE Messaging API
const crypto = require('crypto');

const FIREBASE_DB_URL = (process.env.FIREBASE_DB_URL || '').replace(/\/$/, '');
const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_SECRET = process.env.LINE_CHANNEL_SECRET;

function verifySignature(rawBody, signature) {
  if (!LINE_SECRET) return true;
  const hash = crypto.createHmac('sha256', LINE_SECRET).update(rawBody).digest('base64');
  return hash === signature;
}

async function replyLine(replyToken, text) {
  if (!LINE_TOKEN) {
    console.error('LINE_CHANNEL_ACCESS_TOKEN is missing');
    return;
  }
  const res = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${LINE_TOKEN}`,
    },
    body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] }),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error('LINE reply failed', res.status, errText);
  } else {
    console.log('LINE reply sent OK');
  }
}

exports.handler = async function (event) {
  console.log('webhook invoked, env check:', {
    hasFirebase: !!FIREBASE_DB_URL,
    hasToken: !!LINE_TOKEN,
    hasSecret: !!LINE_SECRET,
  });

  const signature = event.headers['x-line-signature'] || event.headers['X-Line-Signature'];
  if (!verifySignature(event.body, signature)) {
    console.error('Invalid signature');
    return { statusCode: 401, body: 'Invalid signature' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    body = {};
  }
  const events = body.events || [];
  console.log('events received:', events.length);

  for (const e of events) {
    try {
      if (e.source && e.source.type === 'group' && e.source.groupId) {
        await fetch(`${FIREBASE_DB_URL}/config/lineGroupId.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(e.source.groupId),
        });
        console.log('saved group id', e.source.groupId);
      }

      if (e.type === 'message' && e.message && e.message.type === 'text' && e.source && e.source.type === 'user') {
        console.log('received text message:', e.message.text);
        const match = e.message.text.trim().match(/^ลงทะเบียน\s+(\S+)$/);
        if (match) {
          const username = match[1];
          const userRes = await fetch(`${FIREBASE_DB_URL}/users/${username}.json`);
          const userData = await userRes.json();
          console.log('lookup username', username, 'found:', !!userData);
          if (userData) {
            await fetch(`${FIREBASE_DB_URL}/users/${username}.json`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ lineUserId: e.source.userId }),
            });
            if (e.replyToken) await replyLine(e.replyToken, `✅ ลงทะเบียนสำเร็จ! เชื่อมบัญชี "${username}" กับ LINE นี้แล้ว`);
          } else {
            if (e.replyToken) await replyLine(e.replyToken, `❌ ไม่พบ username "${username}" ในระบบ พิมพ์ใหม่ให้ตรงกับที่ใช้ล็อกอินในเว็บ`);
          }
        }
      }
    } catch (err) {
      console.error('event handling error', err);
    }
  }

  return { statusCode: 200, body: 'OK' };
};
