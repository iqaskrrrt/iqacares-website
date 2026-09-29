// Netlify Function — proxies chatbot messages to the Google Gemini API
// (free tier) so the API key stays secret on the server side.
//
// SETUP:
// 1. Get a free API key from https://aistudio.google.com/apikey (no credit card needed)
// 2. In Netlify: Site settings → Environment variables, add:
//      GEMINI_API_KEY = AIzaSy...
// 3. Deploy — Netlify auto-detects any file inside /netlify/functions as an
//    endpoint at yoursite.com/.netlify/functions/chat
//    (netlify.toml redirects /api/chat there too, so the site code doesn't change)
//
// Free tier limit: 1,500 requests/day on Gemini 2.5 Flash — more than enough
// for a part-time agent's website. No charge, no expiry.

const SYSTEM_PROMPT = `Anda ialah Pembantu AI di laman web iqacares, milik Iqa, seorang ejen bertauliah Prudential BSN Takaful.

PERANAN ANDA:
- Jawab soalan am tentang jenis-jenis plan Takaful (nyawa, kesihatan, pendidikan) dan cara Takaful berfungsi secara umum.
- Terangkan konsep dengan mudah dan mesra, dalam Bahasa Malaysia (atau Bahasa Inggeris jika pengguna menulis dalam Bahasa Inggeris).
- Kekalkan jawapan ringkas — 2 hingga 4 ayat.

HAD PENTING (JANGAN LANGGAR):
- JANGAN kira atau anggarkan premium/caruman sebenar untuk sesiapa. Katakan itu perlu dikira oleh Iqa berdasarkan maklumat sebenar.
- JANGAN cadangkan plan tertentu sebagai "yang terbaik untuk anda" berdasarkan situasi peribadi seseorang — itu memerlukan penilaian oleh ejen bertauliah.
- JANGAN beri nasihat kewangan atau perubatan.
- Untuk sebarang soalan spesifik tentang situasi peribadi, budget tepat, atau nak teruskan permohonan — galakkan pengguna isi borang tempahan di bahagian "Tempah" untuk sesi dengan Iqa.
- Jika pengguna nampak keliru atau perlukan bantuan lanjut, cadangkan WhatsApp terus.

Sentiasa mesra, profesional, dan jujur tentang had anda sebagai AI.`;

const GEMINI_MODEL = 'gemini-3.8-flash';

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server belum dikonfigurasi — GEMINI_API_KEY tiada dalam environment variables.' })
    };
  }

  let messages;
  try {
    messages = JSON.parse(event.body || '{}').messages;
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Mesej tidak sah' }) };
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Mesej tidak sah' }) };
  }

  // Basic guardrails: cap history length and message size to control abuse
  // Gemini uses "model" instead of "assistant" for the AI's turns
  const trimmed = messages.slice(-12).map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: String(m.content || '').slice(0, 2000) }]
  }));

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
    const payload = JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: trimmed,
      generationConfig: { maxOutputTokens: 1024 }
    });

    // Cuba sehingga 3 kali jika Google sibuk (503) atau had kadar (429)
    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      });
      if (response.status !== 503 && response.status !== 429) break;
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }

    if (!response.ok) {
      const errText = await response.text();
      console.error('Gemini API error:', errText);
      return { statusCode: 502, body: JSON.stringify({ error: 'Maaf, pembantu AI sedang menghadapi masalah. Sila cuba lagi.' }) };
    }

    const data = await response.json();
    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text
      || 'Maaf, saya tidak pasti macam mana nak jawab itu.';

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply })
    };
  } catch (err) {
    console.error('Chat handler error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Maaf, ada masalah menyambung ke pembantu AI.' }) };
  }
}
