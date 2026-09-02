// @ts-nocheck
/**
 * Supervisor Agent — LangGraph coordinator for Miras.
 * Routes admin tasks to specialized workers, then pauses on the
 * `approval` node until the admin replies OK by email (Nodemailer).
 */
import {
  Annotation,
  Command,
  END,
  INTERRUPT,
  MemorySaver,
  START,
  StateGraph,
  interrupt,
  isGraphInterrupt,
  isInterrupted,
} from '@langchain/langgraph';
import { runDeveloperAgent, executeDeveloperAction } from './developer.js';
import { runFirebaseAgent, executeFirebaseAction } from './firebase.js';
import {
  runEmailAgent,
  executeEmailAction,
  sendApprovalEmail,
  sendToAdmin,
  evaluateSupportIssue,
  sendAdminSupportBrief,
  autoAckEnabled,
  sendCustomerAcknowledgement,
  recordSupportTicket,
} from './email.js';
import { classifyInboundMail } from './mailFilter.js';
import { runPayoutsAgent, executePayoutsAction } from './payouts.js';

const WORKERS = ['developer', 'firebase', 'email', 'payouts'];

export const AgentState = Annotation.Root({
  messages: Annotation({
    reducer: (left, right) => (left || []).concat(right || []),
    default: () => [],
  }),
  task: Annotation(),
  nextWorker: Annotation(),
  workerResults: Annotation({
    reducer: (left, right) => ({ ...(left || {}), ...(right || {}) }),
    default: () => ({}),
  }),
  pendingAction: Annotation(),
  approvalStatus: Annotation(),
  adminReply: Annotation(),
  finalResponse: Annotation(),
});

const APPROVE_RE = /^(ok|okay|yes|y|موافق|نعم|تم|اعتماد|قبول)$/i;
const REJECT_RE = /^(no|n|reject|cancel|رفض|لا|الغاء|إلغاء)$/i;

export function isApprovalReply(text) {
  return APPROVE_RE.test(String(text || '').trim());
}

export function isRejectionReply(text) {
  return REJECT_RE.test(String(text || '').trim());
}

function keywordRoute(task) {
  const text = String(task || '').toLowerCase();
  if (/^\s*(help|مساعدة|اوامر|commands)\s*$/i.test(task || '')) return 'chat';
  if (/^(developer|dev|firebase|email|payouts)\s*:/i.test(task || '')) {
    return task.split(':')[0].trim().toLowerCase().replace(/^dev$/i, 'developer');
  }
  if (/\b(payout|withdraw|withdrawal|iban|سحب|دفعة)\b/i.test(text)) return 'payouts';
  if (/\b(email|support|بريد|دعم|شكوى)\b/i.test(text)) return 'email';
  if (/\b(firebase|firestore|collection|query|pricing)\b/i.test(text)) return 'firebase';
  if (/\b(code|file|edit|write|read|ls|src\/|fix|كود|ملف)\b/i.test(text)) return 'developer';
  return 'chat';
}

async function llmRoute(task) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) return keywordRoute(task);
  try {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: process.env.MIRAS_AGENT_MODEL || 'gemini-2.0-flash',
      contents:
        'Classify this Miras admin task into exactly one label: developer, firebase, email, payouts, chat.\n' +
        'developer = local code/files. firebase = Firestore/backend. email = customer support mail. ' +
        'payouts = driver withdrawals. chat = greeting/help/unknown.\n' +
        `Task: ${String(task).slice(0, 2000)}\nLabel:`,
    });
    const label = String(response.text || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z]/g, '');
    if (WORKERS.includes(label) || label === 'chat') return label;
  } catch (error) {
    console.warn('[supervisor] LLM routing fallback:', error?.message || error);
  }
  return keywordRoute(task);
}

function helpText() {
  return [
    'Miras Supervisor',
    'Email is the admin channel. Sensitive actions pause until you reply OK.',
    `Support mailbox: ${process.env.MIRAS_SUPPORT_EMAIL || 'support@miras.com'}`,
    '',
    'Workers:',
    '• developer — `read src/lib/foo.ts` / `write path.ts ```code````',
    '• firebase — `get orders/{id}` / `query withdrawals status=pending`',
    '• email — `email: to=user@x.com subject=... body=...`',
    '• payouts — `payouts list` / `approve {id}` / `reject {id} reason`',
    '',
    'Prefix with a worker to skip routing: `payouts: list`',
  ].join('\n');
}

async function supervisorNode(state) {
  if (state.approvalStatus === 'approved' || state.approvalStatus === 'rejected') {
    return {};
  }
  const task = String(state.task || '').trim();
  const worker = await llmRoute(task);
  if (worker === 'chat' || !WORKERS.includes(worker)) {
    const text = helpText();
    return {
      nextWorker: END,
      finalResponse: text,
      approvalStatus: 'idle',
      pendingAction: null,
      messages: [{ role: 'assistant', content: text }],
    };
  }
  return {
    nextWorker: worker,
    approvalStatus: 'idle',
    messages: [{ role: 'supervisor', content: `Delegating to ${worker}` }],
  };
}

function routeFromSupervisor(state) {
  const next = state.nextWorker;
  if (WORKERS.includes(next)) return next;
  return END;
}

async function wrapWorker(name, runner, state) {
  try {
    const update = await runner(state);
    return {
      ...update,
      nextWorker: name,
      messages: [{ role: name, content: String(update.finalResponse || update.pendingAction?.summary || name) }],
    };
  } catch (error) {
    const message = error?.message || String(error);
    return {
      nextWorker: name,
      pendingAction: {
        worker: name,
        type: 'none',
        sensitive: false,
        summary: message,
        payload: null,
      },
      finalResponse: `${name} error: ${message}`,
      approvalStatus: 'idle',
      messages: [{ role: name, content: message }],
    };
  }
}

async function developerNode(state) {
  return wrapWorker('developer', runDeveloperAgent, state);
}

async function firebaseNode(state) {
  return wrapWorker('firebase', runFirebaseAgent, state);
}

async function emailNode(state) {
  return wrapWorker('email', runEmailAgent, state);
}

async function payoutsNode(state) {
  return wrapWorker('payouts', runPayoutsAgent, state);
}

function routeAfterWorker(state) {
  if (state.pendingAction?.sensitive) return 'approval';
  return END;
}

/**
 * Human-in-the-loop gate. `interrupt()` freezes the graph until the admin
 * replies OK or NO by email (or in the local agent terminal).
 */
async function approvalNode(state) {
  const action = state.pendingAction;
  if (!action?.sensitive) {
    return { approvalStatus: 'idle' };
  }

  const decision = interrupt({
    type: 'human_approval',
    worker: action.worker,
    summary: action.summary,
    payloadPreview: action.payload?.formatted || action.summary,
  });

  const approved = isApprovalReply(decision);
  return {
    approvalStatus: approved ? 'approved' : 'rejected',
    adminReply: String(decision ?? ''),
    finalResponse: approved ? `Approved: ${action.summary}` : `Rejected: ${action.summary}`,
    messages: [{ role: 'admin', content: String(decision ?? '') }],
  };
}

function routeAfterApproval(state) {
  if (state.approvalStatus === 'approved' && state.pendingAction?.sensitive) {
    return 'execute';
  }
  return END;
}

async function executeNode(state) {
  const action = state.pendingAction;
  if (!action?.sensitive) {
    return { finalResponse: state.finalResponse || 'Nothing to execute.' };
  }
  if (state.approvalStatus !== 'approved') {
    return { finalResponse: 'Execution blocked — admin did not send OK.' };
  }

  let result;
  switch (action.worker) {
    case 'developer':
      result = await executeDeveloperAction(action);
      break;
    case 'firebase':
      result = await executeFirebaseAction(action);
      break;
    case 'email':
      result = await executeEmailAction(action);
      break;
    case 'payouts':
      result = await executePayoutsAction(action);
      break;
    default:
      result = { ok: false, error: `Unknown worker ${action.worker}` };
  }

  const text = `Executed ${action.worker}: ${action.summary}\n${JSON.stringify(result)}`;
  return {
    finalResponse: text,
    pendingAction: { ...action, executed: true },
    messages: [{ role: 'supervisor', content: text }],
  };
}

let compiledGraph = null;

export function createMirasGraph() {
  const checkpointer = new MemorySaver();
  const graph = new StateGraph(AgentState)
    .addNode('supervisor', supervisorNode)
    .addNode('developer', developerNode)
    .addNode('firebase', firebaseNode)
    .addNode('email', emailNode)
    .addNode('payouts', payoutsNode)
    .addNode('approval', approvalNode)
    .addNode('execute', executeNode)
    .addEdge(START, 'supervisor')
    .addConditionalEdges('supervisor', routeFromSupervisor, {
      developer: 'developer',
      firebase: 'firebase',
      email: 'email',
      payouts: 'payouts',
      [END]: END,
    })
    .addConditionalEdges('developer', routeAfterWorker, {
      approval: 'approval',
      [END]: END,
    })
    .addConditionalEdges('firebase', routeAfterWorker, {
      approval: 'approval',
      [END]: END,
    })
    .addConditionalEdges('email', routeAfterWorker, {
      approval: 'approval',
      [END]: END,
    })
    .addConditionalEdges('payouts', routeAfterWorker, {
      approval: 'approval',
      [END]: END,
    })
    .addConditionalEdges('approval', routeAfterApproval, {
      execute: 'execute',
      [END]: END,
    })
    .addEdge('execute', END);

  return graph.compile({ checkpointer });
}

export function getGraph() {
  if (!compiledGraph) compiledGraph = createMirasGraph();
  return compiledGraph;
}

function threadConfig(threadId) {
  return {
    configurable: { thread_id: threadId },
    recursionLimit: 30,
  };
}

function packResult(status, values, threadId, interruptValue) {
  return {
    status,
    threadId,
    values,
    interrupt: interruptValue || null,
    text: values?.finalResponse || interruptValue?.summary || '',
  };
}

/**
 * Start a new supervisor run. Returns `interrupted` when approval is required.
 */
export async function invokeTask(task, threadId) {
  const graph = getGraph();
  const config = threadConfig(threadId);
  const input = {
    task: String(task || '').trim(),
    messages: [{ role: 'user', content: String(task || '') }],
    nextWorker: '',
    workerResults: {},
    pendingAction: null,
    approvalStatus: 'idle',
    adminReply: '',
    finalResponse: '',
  };

  try {
    const values = await graph.invoke(input, config);
    if (isInterrupted(values)) {
      return packResult('interrupted', values, threadId, values[INTERRUPT]?.[0]?.value);
    }
    return packResult('completed', values, threadId);
  } catch (error) {
    if (isGraphInterrupt(error)) {
      return packResult('interrupted', {}, threadId, error.interrupts?.[0]?.value);
    }
    throw error;
  }
}

/**
 * Resume the approval node after the admin replies by email (OK / NO).
 */
export async function resumeWithAdminReply(threadId, reply) {
  const graph = getGraph();
  const config = threadConfig(threadId);
  try {
    const values = await graph.invoke(new Command({ resume: String(reply || '') }), config);
    if (isInterrupted(values)) {
      return packResult('interrupted', values, threadId, values[INTERRUPT]?.[0]?.value);
    }
    return packResult('completed', values, threadId);
  } catch (error) {
    if (isGraphInterrupt(error)) {
      return packResult('interrupted', {}, threadId, error.interrupts?.[0]?.value);
    }
    throw error;
  }
}

export function formatApprovalMessage(interruptValue, threadId) {
  const payload = interruptValue || {};
  return [
    'Miras — approval required',
    `Worker: ${payload.worker || 'unknown'}`,
    `Action: ${payload.summary || 'sensitive operation'}`,
    payload.payloadPreview && payload.payloadPreview !== payload.summary
      ? `\n${String(payload.payloadPreview).slice(0, 2200)}`
      : '',
    '',
    `Thread: ${threadId}`,
    'Reply OK to execute, or NO to reject.',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Notify the admin via Nodemailer from support@miras.com.
 */
export async function notifyAdminByEmail(text, options = {}) {
  return sendToAdmin(text, options);
}

/**
 * Send a HITL approval request to MIRAS_ADMIN_EMAIL.
 */
export async function requestEmailApproval(interruptValue, threadId) {
  return sendApprovalEmail(interruptValue, threadId);
}

/**
 * Support Agent → Supervisor: evaluate a customer email to support@miras.com,
 * draft a reply, and email the admin a summary + action items from the support mailbox.
 */
export async function handleInboundCustomerEmail(mail) {
  const classified = classifyInboundMail(mail);
  if (classified.skip) {
    return { skipped: true, reason: classified.reason, acked: false, brief: null, evaluation: null };
  }
  const evaluation = await evaluateSupportIssue(mail);
  const threadId = `support-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const customer = mail?.from || evaluation.from || '';
  const subject = mail?.subject || evaluation.subject || 'Miras support';
  console.log(
    `[imap] evaluated from=${customer} urgency=${evaluation.urgency} subject=${subject}`
  );

  let acked = false;
  if (autoAckEnabled()) {
    try {
      const ack = await sendCustomerAcknowledgement(mail);
      acked = Boolean(ack?.ok);
    } catch (error) {
      console.warn('[supervisor] customer auto-ack failed:', error?.message || error);
    }
  }

  const task =
    `email: to=${customer} subject=${subject.startsWith('Re:') ? subject : `Re: ${subject}`} ` +
    `body=${evaluation.draftBody}`;
  const result = await invokeTask(task, threadId);
  const brief = await sendAdminSupportBrief({ mail, evaluation, threadId, result });
  recordSupportTicket({
    from: customer,
    subject,
    urgency: evaluation.urgency,
    acked,
    snippet: String(mail?.text || evaluation.summary || ''),
    actions: evaluation.actions,
    source: mail?.source === 'historical' ? 'historical' : 'live',
  });
  return { evaluation, threadId, result, brief, acked };
}
