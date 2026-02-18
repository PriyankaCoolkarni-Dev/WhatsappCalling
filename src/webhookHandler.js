const crypto = require('crypto');
const config = require('./config');

function verifyWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.WEBHOOK_VERIFY_TOKEN) {
    console.log('[Webhook] Verification successful');
    return res.status(200).send(challenge);
  }

  console.warn('[Webhook] Verification failed');
  return res.sendStatus(403);
}

function validateSignature(req, res, next) {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature) {
    console.warn('[Webhook] Missing signature header');
    return res.sendStatus(403);
  }

  const expectedSig = 'sha256=' + crypto
    .createHmac('sha256', config.APP_SECRET)
    .update(req.rawBody)
    .digest('hex');

  if (signature !== expectedSig) {
    console.warn('[Webhook] Invalid signature');
    return res.sendStatus(403);
  }

  next();
}

function handleWebhookEvent(req, res, callManager, io) {
  // Respond immediately to avoid webhook timeout
  res.sendStatus(200);

  const body = req.body;
  console.log('[Webhook] Received event:', JSON.stringify(body, null, 2));

  if (body.object !== 'whatsapp_business_account') return;

  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field === 'calls') {
        const calls = change.value?.calls || [];
        for (const call of calls) {
          processCallEvent(call, callManager, io);
        }

        // Call status updates come in statuses array (RINGING, ACCEPTED, etc.)
        const callStatuses = change.value?.statuses || [];
        for (const status of callStatuses) {
          processCallStatusEvent(status, callManager, io);
        }
      }

      if (change.field === 'messages') {
        const messages = change.value?.messages || [];
        for (const msg of messages) {
          processMessageEvent(msg, change.value, callManager, io);
        }

        const statuses = change.value?.statuses || [];
        for (const status of statuses) {
          processStatusEvent(status, callManager, io);
        }
      }
    }
  }
}

function processCallEvent(call, callManager, io) {
  const { id: callId, from, event, direction, session } = call;
  console.log(`[Call Event] id=${callId} event=${event} direction=${direction}`);

  switch (event) {
    case 'connect':
      if (direction === 'BUSINESS_INITIATED') {
        // Outbound call was answered - SDP answer received
        callManager.handleOutboundSdpAnswer(callId, session?.sdp, io);
      } else if (direction === 'USER_INITIATED') {
        // Inbound call from user - SDP offer received
        callManager.handleInboundCall(callId, from, session?.sdp, io);
      }
      break;

    case 'status':
      callManager.handleOutboundStatus(callId, call.status, io);
      break;

    case 'terminate':
      callManager.handleTerminate(callId, io);
      break;

    default:
      console.log(`[Call Event] Unknown event: ${event}`);
  }
}

function processCallStatusEvent(status, callManager, io) {
  const callId = status.id;
  const statusValue = status.status;
  console.log(`[Call Status] id=${callId} status=${statusValue}`);

  switch (statusValue) {
    case 'RINGING':
      callManager.handleOutboundStatus(callId, 'ringing', io);
      break;
    case 'ACCEPTED':
      callManager.handleOutboundStatus(callId, 'accepted', io);
      break;
    case 'REJECTED':
      callManager.handleOutboundStatus(callId, 'rejected', io);
      break;
    default:
      console.log(`[Call Status] Unknown status: ${statusValue}`);
      io.emit('call-status', { callId, status: statusValue });
  }
}

function processMessageEvent(msg, value, callManager, io) {
  // Handle permission grant responses (interactive messages)
  if (msg.type === 'interactive' && msg.interactive?.type === 'call_permission_reply') {
    const phone = msg.from;
    const granted = msg.interactive?.call_permission_reply?.response === 'accept';
    console.log(`[Permission] Phone=${phone} granted=${granted}`);
    if (granted) {
      callManager.handlePermissionGranted(phone, io);
    }
  }

  // Also handle button replies that might indicate permission
  if (msg.type === 'button' || msg.type === 'interactive') {
    console.log(`[Message] type=${msg.type} from=${msg.from}`, JSON.stringify(msg, null, 2));
    io.emit('webhook-event', { type: 'message', data: msg });
  }
}

function processStatusEvent(status, callManager, io) {
  console.log(`[Status] id=${status.id} status=${status.status}`);
  io.emit('webhook-event', { type: 'message-status', data: status });
}

module.exports = { verifyWebhook, validateSignature, handleWebhookEvent };
