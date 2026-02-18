# WhatsApp Business Calling API - Project Learnings

## Project Overview
A Node.js application that enables outbound voice calls via the WhatsApp Business Calling API, using WebRTC for browser-based audio and n8n as a webhook proxy.

**Stack:** Node.js + Express + Socket.IO + WebRTC
**Deployment:** Coolify (Docker) at `wcall.ifsjaipur.cloud`
**Webhook Proxy:** n8n at `workflow.financialskills.in`

---

## Architecture

```
Browser (mic/speaker)
    ↕ Socket.IO
Coolify Server (Node.js)
    ↕ Graph API
WhatsApp Cloud API
    ↕ Webhooks
n8n (webhook proxy) → forwards to Coolify /webhook/forward
```

### Call Flow
1. **Enable Calling** - One-time setup via `POST /{phone-id}/settings`
2. **Send Permission Template** - `call_permission` template to user
3. **User Accepts** - Webhook: `interactive.type = "call_permission_reply"` with `response = "accept"`
4. **Initiate Call** - Browser generates SDP offer → Server sends to `POST /{phone-id}/calls`
5. **User Picks Up** - Webhook: `event = "connect"` with SDP answer
6. **Audio Established** - Browser sets remote SDP → WebRTC audio flows
7. **Call Ends** - Webhook: `event = "terminate"` with duration

---

## Key Learnings

### 1. WhatsApp Template Language Code
- Templates created as **English (US)** in Meta Business Manager use language code `en_US`, NOT `en`
- Error: `(#132001) Template name does not exist in the translation`
- Fix: Match the exact language code used during template creation

### 2. Meta Webhook Data Formats for Calls
Meta sends call-related webhooks in **two different formats**, both with `field: "calls"`:

**Format A - Call Events (connect, terminate):**
```json
{
  "field": "calls",
  "value": {
    "calls": [{
      "id": "wacid...",
      "event": "connect",
      "session": { "sdp": "...", "sdp_type": "answer" }
    }]
  }
}
```

**Format B - Call Status Updates (RINGING, ACCEPTED, REJECTED):**
```json
{
  "field": "calls",
  "value": {
    "statuses": [{
      "id": "wacid...",
      "status": "RINGING",
      "type": "call"
    }]
  }
}
```

**Important:** Both formats use `field: "calls"`, but data is in different arrays (`calls[]` vs `statuses[]`). Your webhook handler must check BOTH.

### 3. Call Permission Reply Format
- Meta sends permission responses as `interactive.type = "call_permission_reply"` (NOT `call_permission_response`)
- The acceptance is at `call_permission_reply.response = "accept"` (NOT `status = "granted"`)
- Includes `is_permanent: true` and `response_source: "user_action"`

### 4. API Response Format for Call Initiation
```json
{
  "messaging_product": "whatsapp",
  "calls": [{ "id": "wacid.HBgM..." }],
  "success": true
}
```
- Call ID is at `result.calls[0].id`, NOT `result.call_id` or `result.id`
- This ID must be stored and matched against incoming webhooks

### 5. n8n Webhook Proxy Considerations
- n8n's "IF Messages?" filter checking `statuses[0].status EXISTS` will catch BOTH message statuses AND call statuses (since call status webhooks also have a `statuses` array)
- Fix: Add condition `AND changes[0].field equals "messages"` to only filter message delivery statuses
- Call events with `field: "calls"` must pass through to the Switch node

### 6. Graph API Version
- The Calling API works with `v22.0` and `v23.0`
- The `/messages` endpoint and `/calls` endpoint may behave differently across versions
- Stick with the version that works; don't change mid-development

### 7. Docker / Coolify Deployment
- `.env` is in `.gitignore` — environment variables must be set in **Coolify Runtime** settings
- `@roamhq/wrtc` (server-side WebRTC) requires native dependencies not available in base `node:20-bullseye` — falls back to **browser-only mode**
- In browser-only mode, the browser handles all WebRTC (mic capture, SDP generation, audio playback)
- Environment variables must be set as **Runtime** (not Build time) since `process.env` reads them at startup

### 8. WebRTC / ICE Considerations
- Browser needs HTTPS for microphone access (Coolify provides this)
- STUN servers (`stun.l.google.com`) are used for ICE candidate gathering
- ICE gathering may timeout (3s default) — this is normal, proceed with available candidates
- `Connection state: failed` after `connected` indicates ICE/TURN issues — may need TURN servers for reliable audio in production
- WhatsApp's SDP uses `ice-lite` and specific codecs: `opus/48000/2` and `telephone-event/8000`

### 9. Call Permission Rules
- 1 permission request per 24 hours per user
- Maximum 2 requests per week per user
- Permission valid for 72 hours after accepted
- Must have an active conversation open before sending permission template

### 10. Duplicate Call Prevention
- Socket.IO can emit events multiple times if multiple clients are connected
- Guard against duplicate SDP offers by checking call state (`if status === 'ringing', skip`)
- The API will return 400 if you try to call the same number twice simultaneously

---

## Common Errors & Solutions

| Error | Cause | Solution |
|-------|-------|----------|
| `#132001 Template does not exist` | Language code mismatch | Use `en_US` not `en` |
| `401 Unauthorized` on `/calls` | Token missing calling permission or wrong API version | Check token permissions, verify Graph API version |
| `400 Bad Request` on call | Duplicate call or missing permission | Prevent double calls; check permission status |
| Stuck on "Ringing" | Webhook not reaching server | Fix n8n routing; ensure call webhooks pass through status filter |
| No audio after connect | ICE connection failed | May need TURN servers; check browser mic permissions |

---

## Files Modified During Development

| File | Changes |
|------|---------|
| `src/whatsappApi.js` | Template language `en` → `en_US` |
| `src/webhookHandler.js` | Fixed permission reply type; added `processCallStatusEvent` for RINGING/ACCEPTED |
| `src/callManager.js` | Fixed callId extraction from API response; added fallback callId lookup; duplicate call prevention |
| `server.js` | Added debug logging to `/webhook/forward` |
| `Dockerfile` | Added native build dependencies for `@roamhq/wrtc` |

---

## Future Improvements
- Add TURN servers for reliable audio connectivity
- Fix remaining double-call issue (Socket.IO duplicate events)
- Remove debug logging from production
- Add proper error display in browser when call fails
- Handle inbound calls from users
- Implement call recording/logging
