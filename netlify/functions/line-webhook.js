// Webhook รับ event จาก LINE Messaging API
// ใช้ทำ 2 อย่าง: 1) จับ Group ID เก็บไว้อัตโนมัติ  2) ให้สมาชิกลงทะเบียนผูก LINE กับ username
// ต้องตั้งค่า Environment variables ใน Netlify: FIREBASE_DB_URL, LINE_CHANNEL_ACCESS_TOKEN, LINE_CHANNEL_SECRET
// แล้วเอา URL ของฟังก์ชันนี้ไปกรอกที่ "Webhook URL" ใน LINE Developers Console > Messaging API

const crypto = require('crypto');

const FIREBASE_DB_URL = (process.env.FIREBASE_DB_URL || '').replace(/\/$/, '');
const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_SECRET = process.env.LINE_CHANNEL_SECRET;

function verifySignature(rawBody, signature) {
  if (!LINE_SECRET) return true; // ยังไม่ตั้ง secret ไว้ก็ข้ามไปก่อน (ไม่แนะนำใช้ production จริง)
  const hash = crypto.createHmac('sha256', LINE_SECRET).update(rawBody).digest('base64');
  return hash === signature;
}

async function replyLine(replyToken, text) {
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${LINE_TOKEN}`,
    },
    body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] }),
  });
}

exports.handler = async function (event) {
  const signature = event.headers['x-line-signature'] || event.headers['X-Line-Signature'];
  if (!verifySignature(event.body, signature)) {
    return { statusCode: 401, body: 'Invalid signature' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    body = {};
  }
  const events = body.events || [];

  for (const e of events) {
    try {
      // 1) จับ Group ID เก็บไว้ใน Firebase ทุกครั้งที่มีความเคลื่อนไหวในกลุ่ม
      if (e.source && e.source.type === 'group' && e.source.groupId) {
        await fetch(`${FIREBASE_DB_URL}/config/lineGroupId.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(e.source.groupId),
        });
      }

      // 2) ลงทะเบียนส่วนตัว: พิมพ์ "ลงทะเบียน <username>" ทักบอท
      if (e.type === 'message' && e.message && e.message.type === 'text' && e.source && e.source.type === 'user') {
        const match = e.message.text.trim().match(/^ลงทะเบียน\s+(\S+)$/);
        if (match) {
          const username = match[1];
          const userRes = await fetch(`${FIREBASE_DB_URL}/users/${username}.json`);
          const userData = await userRes.json();
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
