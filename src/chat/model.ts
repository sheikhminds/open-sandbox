// Shared chat model: types, persistence, outbound history construction,
// streaming transport and export helpers.

export type Role = 'user' | 'assistant';

export type Message = {
  id: string;
  role: Role;
  text: string;
  sentAt: string;
  // Beam models require the reasoning they emitted for every earlier
  // assistant turn when the conversation history is replayed.
  reasoningContent?: string;
};

export type Conversation = {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: string;
};

export type ThemeMode = 'system' | 'light' | 'dark';

export type Settings = {
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  mode: ThemeMode;
};

export type OutboundMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
  reasoning_content?: string;
};

export type ApiStatus = {
  configured: boolean;
  provider: string;
  model: string;
};

export const DEFAULT_SETTINGS: Settings = {
  systemPrompt: '',
  temperature: 0.7,
  maxTokens: 16000,
  mode: 'system',
};

export const STORAGE_KEY = 'astryx-chat-conversations-v1';
export const SELECTED_KEY = 'astryx-chat-selected-v1';
export const SETTINGS_KEY = 'open-sandbox-settings-v1';

let idCounter = 0;
export function makeId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${Date.now()}-${idCounter}`;
}

export function newConversation(
  title = 'New conversation',
  messages: Message[] = [],
): Conversation {
  const now = new Date().toISOString();
  return {id: makeId('c'), title, messages, updatedAt: now};
}

export const WELCOME_TEXT = `## Welcome to Open Sandbox

This is a **free and open-source** chat built with Astryx, React and StyleX (all MIT licensed).

- Markdown replies, fenced code blocks and tables
- Conversations saved in this browser
- Live streaming via Reflection AI when a key is configured

Ask me about open models, local runtimes, or anything else.`;

export function seedConversations(): Conversation[] {
  return [
    newConversation('Welcome', [
      {
        id: 'welcome-message',
        role: 'assistant',
        text: WELCOME_TEXT,
        sentAt: '2026-11-16T10:00:00',
      },
    ]),
  ];
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage may be unavailable or full — stay usable in memory.
  }
}

export function loadConversations(): Conversation[] {
  const raw = readStorage(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Conversation[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      // Corrupt payload — fall back to a fresh conversation.
    }
  }
  return seedConversations();
}

export function saveConversations(conversations: Conversation[]) {
  writeStorage(STORAGE_KEY, JSON.stringify(conversations));
}

export function loadSelectedId(): string {
  return readStorage(SELECTED_KEY) ?? '';
}

export function saveSelectedId(id: string) {
  writeStorage(SELECTED_KEY, id);
}

export function loadSettings(): Settings {
  const raw = readStorage(SETTINGS_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<Settings>;
      return {
        systemPrompt:
          typeof parsed.systemPrompt === 'string'
            ? parsed.systemPrompt
            : DEFAULT_SETTINGS.systemPrompt,
        temperature:
          typeof parsed.temperature === 'number' &&
          Number.isFinite(parsed.temperature)
            ? parsed.temperature
            : DEFAULT_SETTINGS.temperature,
        maxTokens:
          typeof parsed.maxTokens === 'number' && Number.isFinite(parsed.maxTokens)
            ? parsed.maxTokens
            : DEFAULT_SETTINGS.maxTokens,
        mode:
          parsed.mode === 'light' || parsed.mode === 'dark'
            ? parsed.mode
            : DEFAULT_SETTINGS.mode,
      };
    } catch {
      // Fall through to defaults.
    }
  }
  return DEFAULT_SETTINGS;
}

export function saveSettings(settings: Settings) {
  writeStorage(SETTINGS_KEY, JSON.stringify(settings));
}

/**
 * Build the request history. Assistant turns without stored reasoning cannot
 * be replayed to the Beam models, so they are omitted.
 */
export function buildOutbound(
  messages: Message[],
  systemPrompt: string,
): OutboundMessage[] {
  const outbound: OutboundMessage[] = [];
  if (systemPrompt.trim()) {
    outbound.push({role: 'system', content: systemPrompt.trim()});
  }
  for (const message of messages) {
    if (message.role === 'user') {
      outbound.push({role: 'user', content: message.text});
    } else if (message.reasoningContent) {
      outbound.push({
        role: 'assistant',
        content: message.text,
        reasoning_content: message.reasoningContent,
      });
    }
  }
  return outbound;
}

/** POST to our server proxy and parse OpenAI-style SSE deltas. */
export async function streamCompletion(
  messages: OutboundMessage[],
  settings: Settings,
  onDelta: (text: string, reasoning: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      messages,
      temperature: settings.temperature,
      max_tokens: settings.maxTokens,
    }),
    signal,
  });
  if (!response.ok) {
    const detail = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(detail.error ?? `Request failed (${response.status})`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response stream was returned.');
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let reasoning = '';

  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, {stream: true});
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const event = JSON.parse(data) as {
            choices?: Array<{
              delta?: {content?: string; reasoning_content?: string};
            }>;
          };
          const delta = event.choices?.[0]?.delta;
          const reasoningDelta = delta?.reasoning_content;
          const textDelta = delta?.content;
          let changed = false;
          if (typeof reasoningDelta === 'string' && reasoningDelta) {
            reasoning += reasoningDelta;
            changed = true;
          }
          if (typeof textDelta === 'string' && textDelta) {
            content += textDelta;
            changed = true;
          }
          if (changed) onDelta(content, reasoning);
        } catch {
          // Ignore keep-alive comments and partial frames.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!content) onDelta('(No content returned.)', reasoning);
}

/** Export one conversation as a Markdown document. */
export function conversationToMarkdown(conversation: Conversation): string {
  const lines = [`# ${conversation.title}`, ''];
  for (const message of conversation.messages) {
    const label = message.role === 'user' ? 'You' : 'Open Sandbox';
    lines.push(`## ${label}`, '', message.text, '');
  }
  return lines.join('\n').trim() + '\n';
}

export function downloadFile(filename: string, contents: string) {
  const blob = new Blob([contents], {type: 'text/markdown;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function wordCount(conversations: Conversation[]): number {
  return conversations.reduce(
    (total, conversation) =>
      total +
      conversation.messages.reduce(
        (sum, message) => sum + message.text.trim().split(/\s+/).filter(Boolean).length,
        0,
      ),
    0,
  );
}
