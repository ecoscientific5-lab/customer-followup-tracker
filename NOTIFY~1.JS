// รันอัตโนมัติทุกวันตามเวลาที่ตั้งใน netlify.toml (ค่าเริ่มต้น 08:00 เวลาไทย)
// อ่านข้อมูลลูกค้าจาก Firebase แล้วส่งแจ้งเตือนผ่าน LINE Messaging API
// ต้องตั้งค่า Environment variables ใน Netlify: FIREBASE_DB_URL, LINE_CHANNEL_ACCESS_TOKEN

const FIREBASE_DB_URL = (process.env.FIREBASE_DB_URL || '').replace(/\/$/, '');
const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

function todayISO() {
  // เวลาไทย = UTC+7
  const now = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

async function pushLine(to, text) {
  if (!LINE_TOKEN || !to) return;
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${LINE_TOKEN}`,
    },
    body: JSON.stringify({ to, messages: [{ type: 'text', text }] }),
  });
  if (!res.ok) {
    console.error('LINE push failed', res.status, await res.text());
  }
}

exports.handler = async function () {
  try {
    if (!FIREBASE_DB_URL) return { statusCode: 500, body: 'Missing FIREBASE_DB_URL env var' };

    const [entriesRes, usersRes, configRes] = await Promise.all([
      fetch(`${FIREBASE_DB_URL}/entries.json`),
      fetch(`${FIREBASE_DB_URL}/users.json`),
      fetch(`${FIREBASE_DB_URL}/config.json`),
    ]);
    const entriesData = (await entriesRes.json()) || {};
    const users = (await usersRes.json()) || {};
    const config = (await configRes.json()) || {};

    const today = todayISO();
    const entries = Object.entries(entriesData).map(([key, v]) => ({ ...v, _key: key }));

    // ลูกค้าที่ครบกำหนดตามวันนี้หรือเลยกำหนดแล้ว และยังไม่ปิด/ยกเลิก
    const due = entries.filter(
      (e) =>
        e.followupDate &&
        e.followupDate <= today &&
        e.status !== 'ปิดการขาย' &&
        e.status !== 'ยกเลิก'
    );

    if (due.length === 0) {
      return { statusCode: 200, body: 'No due entries today' };
    }

    // 1) ส่งสรุปเข้ากลุ่ม
    if (config.lineGroupId) {
      const lines = due.map(
        (e) => `• ${e.name} (${e.company || '-'}) — ${e.nextAction || 'ไม่มี Next Action'} | ผู้รับผิดชอบ: ${e.owner || '-'}`
      );
      const groupMsg = `📋 สรุปลูกค้าที่ต้องตามวันนี้ (${due.length} รายการ)\n\n${lines.join('\n')}`;
      await pushLine(config.lineGroupId, groupMsg);
    } else {
      console.log('No lineGroupId saved yet — skipping group push');
    }

    // 2) ส่งแจ้งเตือนรายบุคคลตาม "ผู้รับผิดชอบ" (จับคู่ display name กับ user ที่ลงทะเบียน LINE แล้ว)
    const displayToUser = {};
    for (const [username, u] of Object.entries(users)) {
      if (u && u.display) displayToUser[u.display] = { username, ...u };
    }

    const byOwner = {};
    for (const e of due) {
      if (!e.owner) continue;
      (byOwner[e.owner] = byOwner[e.owner] || []).push(e);
    }

    for (const [ownerName, list] of Object.entries(byOwner)) {
      const user = displayToUser[ownerName];
      if (!user || !user.lineUserId) continue; // คนนี้ยังไม่ลงทะเบียน LINE
      const lines = list.map((e) => `• ${e.name} (${e.company || '-'}) — ${e.nextAction || 'ไม่มี Next Action'}`);
      const msg = `🔔 วันนี้คุณมีลูกค้าที่ต้องตาม (${list.length} รายการ)\n\n${lines.join('\n')}`;
      await pushLine(user.lineUserId, msg);
    }

    return { statusCode: 200, body: `Notified ${due.length} due entries` };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: String(err) };
  }
};
