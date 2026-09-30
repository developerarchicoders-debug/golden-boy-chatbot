/* =============================================================================
   Golden Boy - Website Chatbot: API endpoint
   -----------------------------------------------------------------------------
   A serverless function that answers visitor questions using ONLY the Golden Boy
   knowledge base (see knowledge-base.js). The bot cannot use outside knowledge:
   if it is not in the knowledge base, it says so and routes to a call. That is
   the "only pulls from data we give it" requirement, done the cheap, correct way
   (grounding), with no model training required.

   WHY A BACKEND: the Claude API key must never touch the browser. The widget on
   the site posts the conversation here, this holds the key and calls Claude, and
   only the reply text goes back to the page.

   COST: the whole knowledge base rides in a cached system prompt, so after the
   first call each message is a few hundred tokens of new text against a cached
   prefix. On Claude Haiku this is a fraction of a cent per message. See READ-ME.

   DEPLOY:
     - Drop this file and knowledge-base.js into an /api folder on Vercel or
       Netlify. It works as-is at /api/chat.
     - Set env vars: ANTHROPIC_API_KEY (required), ANTHROPIC_MODEL (optional),
       GHL_WEBHOOK (optional), ALLOWED_ORIGIN (optional).
     - Point the widget's CHAT_ENDPOINT at this URL.
   ============================================================================= */

import { KNOWLEDGE_BASE, BOT_INSTRUCTIONS } from "./knowledge-base.js";

// Default model: Claude Haiku is the right tool for a grounded FAQ bot (fast and
// cheap). Override with ANTHROPIC_MODEL if you ever want a richer model.
const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";

// Guardrail limits (protect the key and the bill).
const MAX_TURNS = 12;          // how many recent messages to keep
const MAX_CHARS_PER_MSG = 1500; // cap each visitor message
const MAX_OUTPUT_TOKENS = 700;  // cap the reply length

/* Build the cached system prompt. Two blocks: behavior, then the facts. The
   cache_control marker on the last block caches the whole prefix, so the large,
   static knowledge base is not re-billed at full price on every message. */
function buildSystem() {
  return [
    { type: "text", text: BOT_INSTRUCTIONS },
    {
      type: "text",
      text: "COMPANY KNOWLEDGE BASE (your only source of truth):\n" + KNOWLEDGE_BASE,
      cache_control: { type: "ephemeral" }
    }
  ];
}

/* Sanitize the conversation from the browser into a clean, bounded messages
   array. We trust nothing from the client: roles are forced to user/assistant,
   content is coerced to a capped string, and the history is trimmed. */
function cleanMessages(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const role = m.role === "assistant" ? "assistant" : "user";
    let content = m.content;
    if (typeof content !== "string") content = content == null ? "" : String(content);
    content = content.trim().slice(0, MAX_CHARS_PER_MSG);
    if (!content) continue;
    out.push({ role, content });
  }
  // keep only the most recent turns, and make sure it starts with a user turn
  const trimmed = out.slice(-MAX_TURNS);
  while (trimmed.length && trimmed[0].role !== "user") trimmed.shift();
  return trimmed;
}

/* Optional: forward the conversation to GoHighLevel, server-side, so a chat can
   become a lead. Fire and forget. Never let a CRM failure break the reply. */
async function forwardToCRM(messages, reply, contact) {
  const hook = process.env.GHL_WEBHOOK;
  if (!hook) return;
  try {
    const transcript = messages
      .map((m) => (m.role === "user" ? "Visitor: " : "Bot: ") + m.content)
      .join("\n");
    // heuristic gap signal: if the bot had to route instead of answer, flag it so
    // Huntor can review these transcripts and grow the knowledge base toward real demand
    const unanswered = /do not have|don't have|not something golden boy|not part of the current|cannot help|could not reach/i.test(reply);
    await fetch(hook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "website-chatbot",
        contact: contact && typeof contact === "object" ? contact : {},
        transcript: transcript + "\nBot: " + reply,
        last_question: [...messages].reverse().find((m) => m.role === "user")?.content || "",
        unanswered
      })
    });
  } catch (e) { /* swallow: CRM must never break the visitor experience */ }
}

/* --------------------------------- handler --------------------------------- */
export default async function handler(req, res) {
  const origin = process.env.ALLOWED_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Use POST." });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ ok: false, error: "Server not configured." });

  let body = req.body;
  try { if (typeof body === "string") body = JSON.parse(body); } catch { body = null; }
  if (!body || typeof body !== "object") return res.status(400).json({ ok: false, error: "Bad request." });

  const messages = cleanMessages(body.messages);
  if (!messages.length) return res.status(400).json({ ok: false, error: "No message." });

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: buildSystem(),
        messages
      })
    });

    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      return res.status(502).json({ ok: false, error: "Model call failed.", detail: detail.slice(0, 300) });
    }

    const data = await resp.json();
    const reply = (data.content || [])
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("")
      .trim();

    if (!reply) return res.status(502).json({ ok: false, error: "No reply produced." });

    // fire and forget: turn the chat into a lead if a webhook is configured
    forwardToCRM(messages, reply, body.contact);

    return res.status(200).json({ ok: true, reply });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "Unexpected error." });
  }
}
