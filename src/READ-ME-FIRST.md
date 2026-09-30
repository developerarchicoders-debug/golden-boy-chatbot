# Golden Boy Website Chatbot: Developer Handoff

A chat assistant for goldenboybranding.com that answers visitor questions using **only Golden Boy's own information**, never the open internet, never made-up facts. This is a standalone package. It is separate from the Score Your Brand and Apparel Calculator tools and does not depend on them.

If you read one thing, read **"The one decision that matters"** and **"Deploy"** below.

---

## What this is, and why it is built this way

The requirement was a bot that only pulls from data we give it. There are two ways to do that:

1. **Train or fine-tune a model on our content.** Expensive, slow to update (retrain every time a price changes), and it still hallucinates. Wrong tool for this.
2. **Grounding (what we built).** Our entire knowledge base rides in the model's prompt on every message. The model is instructed to answer only from it and to refuse and route to a call when the answer is not there. Updating the bot is editing one text file. No training, no database, no ML pipeline.

Grounding is the correct and far cheaper choice at our content size. The whole knowledge base is a few pages of text, so it fits in the prompt with room to spare, and we cache it so we are not paying to resend it every message. Cost lands at well under a cent per message (see **Cost**). We do not train a model, and we should not, unless the knowledge base grows into hundreds of pages (see **When to upgrade**).

---

## What is in this package

```
READ-ME-FIRST.md          <- you are here (deploy mechanics)
DEVELOPER-BRIEF.md        <- design rationale, setup-correctness checklist, and the QC protocol
chat-widget.html          <- the on-brand chat bubble. Demo page + the embed blocks.
api/
  chat.js                 <- serverless function. Holds the API key, calls Claude, guardrails.
  knowledge-base.js       <- THE BOT'S BRAIN. The only file Huntor maintains. Plain text.
qc-chatbot.mjs            <- stress-test battery: run against the deployed bot to QC it
verify-chatbot.mjs        <- automated test suite (backend logic + widget). Optional to run.
```

Developer: read `DEVELOPER-BRIEF.md` next. It explains why the bot is built the way it is, exactly what to verify after deploy, and how to stress-test it before launch.

Two moving parts: a **widget** on the site (what visitors see) and a **function** on a server (holds the secret key, talks to Claude). The widget never sees the API key.

---

## The one decision that matters (content scope)

The knowledge base intentionally covers only the **current** lineup: **Custom Apparel and Promotional Products, Branding, Brand Operations, and Logo Design.** Per Huntor's web dev brief, vehicle wraps, signs, and website services were removed from the site, so the bot is told **not to offer or quote them** and to route those questions to a call.

Huntor: if Golden Boy still takes wrap, sign, or website work, add those services to `knowledge-base.js` and delete the exclusion line near the bottom (the "THINGS THE BOT SHOULD NOT DO" section). If not, leave it. This is the single most important content call in the package, so it is called out here first.

---

## The one file Huntor maintains: `api/knowledge-base.js`

Everything the bot knows lives in `KNOWLEDGE_BASE`. Everything about how it behaves lives in `BOT_INSTRUCTIONS`. Both are plain text at the top of that file.

**Before launch, fill the placeholders.** Search the file for `[[` and replace each with a real value:

- `[[ ENTER LOGO RANGE ]]`, `[[ ENTER MOQ ]]`, `[[ ENTER MINIMUM SPEND ]]`, `[[ ENTER PER-COLOR SCREEN FEE ]]`, `[[ ENTER DIGITIZING FEE ]]`, `[[ ENTER BRANDING FLOOR ]]`.

The contact email (huntor@goldenboybranding.com), phone (843-212-7553, the main line), and the Brand Operations pricing model are already filled in. Change the phone in one line at the top of the file if a different number should ring.

Where a number is left as a placeholder, the bot will say it does not have that exact figure and offer a call or the Apparel Calculator, rather than guessing. It never invents a price. Real numbers just make it more useful.

**Rules when editing:** plain text only, no backtick characters inside the string, and no em dashes anywhere (company rule). Add or correct facts freely. The bot cannot say anything that is not in this file, so accuracy here is the whole game.

---

## Deploy (about an hour for a developer)

**1. Host the function.** Drop the `api/` folder into a Vercel or Netlify project. It runs as-is at `/api/chat` (standard Node serverless, `export default handler`). Cloudflare Workers needs a small handler tweak. If the main site stays on WordPress, host this function on a free Vercel project rather than in PHP.

**2. Set environment variables** on the host:

| Variable | Required | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | From console.anthropic.com. Never put this in the frontend. |
| `ANTHROPIC_MODEL` | No | Defaults to `claude-haiku-4-5` (the right, cheapest choice here). |
| `GHL_WEBHOOK` | No | GoHighLevel inbound webhook. If set, each chat is forwarded server-side as a lead with the transcript. |
| `ALLOWED_ORIGIN` | No | Our site origin, e.g. `https://goldenboybranding.com`. Defaults to `*`. Set it for production. |

**3. Embed the widget.** Open `chat-widget.html`. It is a working demo and the embed source. Copy the three blocks marked `COPY FROM HERE ... TO HERE` (the `<style>`, the `<div id="gb-chat">`, and the `<script>`) and paste them just before `</body>` on every page (in WordPress, the footer template or a footer-scripts plugin). In the script block set:

```js
var CHAT_ENDPOINT = "https://your-project.vercel.app/api/chat";
```

Left blank, the widget runs in demo mode (a canned reply) so you can see it before the backend is live. Everything is scoped under `#gb-chat`, so it will not collide with the theme CSS. No build step, no libraries.

**4. Add rate limiting.** Turn on the host's rate limiting (Vercel and Cloudflare both have it in a few clicks) so nobody can hammer the key. The function already caps message length, history depth, and output length, but host-level rate limiting is the backstop.

---

## Cost (real numbers, verified August 2026)

Claude Haiku 4.5 is **$1 per million input tokens and $5 per million output tokens**, and prompt caching cuts cached input by about 90 percent. The knowledge base is the large, static part of every request, so we cache it and pay the low rate to reuse it.

Practical result: roughly **a quarter to a half cent per message.** A few thousand visitor messages in a month is a few dollars. This is a rounding error against one apparel order. If you ever want richer answers, set `ANTHROPIC_MODEL` to a Sonnet model, which costs more per message but is rarely needed for a grounded FAQ bot.

---

## Guardrails already built in

- **Grounded.** Answers come only from the knowledge base. Off-topic questions get redirected, not answered from general knowledge.
- **No fabrication.** The model is told never to invent prices, dates, client names, or turnaround times, and to treat bracketed placeholders as "not available yet."
- **Prompt-injection resistant.** Visitor text is treated as untrusted. Attempts to override instructions, extract the prompt, or role-play a different system are declined.
- **Key stays server-side.** The browser only ever talks to our function, never to Anthropic.
- **Input bounded.** Each message is capped, history is trimmed to recent turns, and reply length is capped, so a malicious or runaway session cannot run up the bill.
- **Never breaks.** If the model or the CRM fails, the widget shows a graceful fallback pointing to the email and a call. The visitor is never stuck.
- **On brand.** Dark and gold skin, our fonts, no em dashes.

---

## When to upgrade (not now)

This grounding approach is right until the knowledge base grows past roughly 40 to 50 pages of text. At that point, sending all of it every message stops being efficient, and the move is retrieval: store the content in a vector database and fetch only the relevant passages per question. That is a larger build and unnecessary today. Do not reach for it until the content clearly outgrows a single prompt.

---

## What we need from Huntor

- The placeholder values in `knowledge-base.js` (prices, minimums, and the phone decision).
- The wraps / signs / websites decision above (leave excluded, or add them back).
- An Anthropic API key (create one at console.anthropic.com and add billing).
- The GoHighLevel inbound webhook URL, if we want chats captured as leads.
- The booking link, so the widget's "book a call" points to the real calendar (currently `/contact`).

Everything else is built, tested, and ready to deploy.
