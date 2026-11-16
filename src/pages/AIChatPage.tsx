// Based on the Astryx `ai-chat` page template. Its two-column frame and
// spacing are kept; the artifact panel is replaced with a conversation list
// and the transcript is wired to a live, streamed chat endpoint.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

import {
  Layout,
  LayoutContent,
  LayoutPanel,
  Stack,
  StackItem,
  HStack,
  VStack,
} from '@astryxdesign/core/Layout';
import {Text, Heading} from '@astryxdesign/core/Text';
import {
  ChatComposer,
  ChatComposerInput,
  ChatLayout,
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
  ChatMessageMetadata,
  ChatSystemMessage,
} from '@astryxdesign/core/Chat';
import {Avatar} from '@astryxdesign/core/Avatar';
import {Badge} from '@astryxdesign/core/Badge';
import {Button} from '@astryxdesign/core/Button';
import {Divider} from '@astryxdesign/core/Divider';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Icon} from '@astryxdesign/core/Icon';
import {IconButton} from '@astryxdesign/core/IconButton';
import {List, ListItem} from '@astryxdesign/core/List';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Timestamp} from '@astryxdesign/core/Timestamp';
import {useMediaQuery} from '@astryxdesign/core/hooks';

import {
  Bars3Icon,
  ChatBubbleLeftRightIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  SparklesIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

// ---------------------------------------------------------------------------
// Types and local persistence
// ---------------------------------------------------------------------------

type Role = 'user' | 'assistant';

type Message = {
  id: string;
  role: Role;
  text: string;
  sentAt: string;
  // Beam models require the reasoning they emitted for every earlier
  // assistant message when the history is replayed on a later turn.
  reasoningContent?: string;
};

type Conversation = {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: string;
};

type ApiStatus = {
  configured: boolean;
  provider: string;
  model: string;
};

const STORAGE_KEY = 'astryx-chat-conversations-v1';
const SELECTED_KEY = 'astryx-chat-selected-v1';

let idCounter = 0;
function makeId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${Date.now()}-${idCounter}`;
}

function newConversation(
  title = 'New conversation',
  messages: Message[] = [],
): Conversation {
  const now = new Date().toISOString();
  return {id: makeId('c'), title, messages, updatedAt: now};
}

const WELCOME_TEXT =
  "Hi! I'm Astryx Chat. This interface is built entirely from free, open-source packages (Astryx, React and StyleX are MIT-licensed). Your conversations are saved in this browser. Ask me about open models, local runtimes, or anything else.";

function seedConversations(): Conversation[] {
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

function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Conversation[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    // Corrupt or unavailable storage — fall back to a fresh conversation.
  }
  return seedConversations();
}

// ---------------------------------------------------------------------------
// Offline fallback replies (used only when no API key is configured)
// ---------------------------------------------------------------------------

const SUGGESTIONS = [
  'What open-source models can I run locally?',
  'How do I keep my chat data private?',
  'Which licenses do these packages use?',
];

const DEMO_REPLIES: Array<{match: RegExp; text: string}> = [
  {
    match: /ollama|local|offline|run.*model/i,
    text: 'Ollama is the simplest free way to run open-weight models locally (Llama, Mistral, Qwen, Gemma and more). LM Studio is another good desktop option. Both expose an OpenAI-compatible API, so this app can point at them just as easily as at a hosted endpoint.',
  },
  {
    match: /hugging|license|open.?source|mit|free/i,
    text: 'Everything in this project is free and open source under the MIT license: @astryxdesign/core, @astryxdesign/theme-neutral, @astryxdesign/cli, @stylexjs/stylex and React. Model weights each have their own license, so check the model card before using one commercially.',
  },
  {
    match: /privacy|data|cloud|store/i,
    text: 'Your conversations are stored only in this browser via localStorage — there is no analytics or tracking. When a live API key is configured, messages are sent to that provider for inference. You can clear everything with the trash button in the header.',
  },
];

function demoReply(input: string) {
  return (
    DEMO_REPLIES.find(reply => reply.match.test(input))?.text ??
    'This is the local demo responder. Set REFLECTION_API_KEY in your .env file and restart the dev server to chat with a live model instead.'
  );
}

// ---------------------------------------------------------------------------
// Styles — semantic tokens only, no raw colors or pixel values
// ---------------------------------------------------------------------------

const styles: Record<string, CSSProperties> = {
  root: {height: '100dvh', width: '100%'},
  sidebar: {height: '100%', minHeight: 0},
  sidebarHeader: {
    alignItems: 'center',
    paddingInline: 'var(--spacing-3)',
    paddingBlock: 'var(--spacing-3)',
  },
  sidebarSearch: {
    paddingInline: 'var(--spacing-3)',
    paddingBottom: 'var(--spacing-2)',
  },
  sidebarScroll: {
    minHeight: 0,
    overflowY: 'auto',
    paddingInline: 'var(--spacing-2)',
    paddingBottom: 'var(--spacing-3)',
  },
  sidebarFooter: {
    padding: 'var(--spacing-3)',
  },
  streamHeader: {
    alignItems: 'center',
    paddingInline: 'var(--spacing-4)',
    paddingBlock: 'var(--spacing-3)',
  },
  title: {minWidth: 0},
  chatFill: {flex: 1, minHeight: 0, width: '100%'},
  chatLayout: {flex: 1, minHeight: 0},
};

// ---------------------------------------------------------------------------
// One message row
// ---------------------------------------------------------------------------

function MessageRow({message}: {message: Message}) {
  const isUser = message.role === 'user';
  return (
    <ChatMessage
      sender={isUser ? 'user' : 'assistant'}
      avatar={isUser ? undefined : <Avatar name="Astryx" size="md" />}>
      <ChatMessageBubble
        name={isUser ? undefined : 'Astryx'}
        metadata={
          <ChatMessageMetadata
            timestamp={<Timestamp value={message.sentAt} format="time" />}
          />
        }>
        {message.text || (isUser ? '' : '…')}
      </ChatMessageBubble>
    </ChatMessage>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AIChatPage() {
  const [conversations, setConversations] =
    useState<Conversation[]>(loadConversations);
  const [selectedId, setSelectedId] = useState(() => {
    try {
      return localStorage.getItem(SELECTED_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [draft, setDraft] = useState('');
  const [isResponding, setIsResponding] = useState(false);
  const [search, setSearch] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [apiStatus, setApiStatus] = useState<ApiStatus>({
    configured: false,
    provider: 'Local demo',
    model: 'No API key',
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const isCompact = useMediaQuery('(max-width: 768px)');
  const showSidebar = !isCompact || isSidebarOpen;

  // Ask our own server whether a key is configured. The token never travels
  // to the browser; only this boolean and the model name do.
  useEffect(() => {
    fetch('/api/chat')
      .then(response => (response.ok ? response.json() : null))
      .then(data => {
        if (data) {
          setApiStatus({
            configured: Boolean(data.configured),
            provider: data.provider ?? 'Reflection AI',
            model: data.model ?? '',
          });
        }
      })
      .catch(() => {
        // No backend (e.g. static hosting) — keep the local demo.
      });
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
    } catch {
      // Storage may be full or disabled; the app still works in memory.
    }
  }, [conversations]);

  useEffect(() => {
    if (!selectedId && conversations.length > 0) {
      setSelectedId(conversations[0].id);
    }
    try {
      if (selectedId) localStorage.setItem(SELECTED_KEY, selectedId);
    } catch {
      // Ignore storage failures.
    }
  }, [conversations, selectedId]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      abortRef.current?.abort();
    },
    [],
  );

  const selected = conversations.find(conversation => conversation.id === selectedId);

  const visibleConversations = useMemo(() => {
    const query = search.trim().toLowerCase();
    const sorted = [...conversations].sort(
      (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    );
    return query
      ? sorted.filter(conversation =>
          conversation.title.toLowerCase().includes(query),
        )
      : sorted;
  }, [conversations, search]);

  function patchMessage(
    conversationId: string,
    messageId: string,
    patch: Partial<Message>,
  ) {
    setConversations(previous =>
      previous.map(conversation =>
        conversation.id === conversationId
          ? {
              ...conversation,
              messages: conversation.messages.map(message =>
                message.id === messageId ? {...message, ...patch} : message,
              ),
              updatedAt: new Date().toISOString(),
            }
          : conversation,
      ),
    );
  }

  function handleNewChat() {
    const conversation = newConversation();
    setConversations(previous => [conversation, ...previous]);
    setSelectedId(conversation.id);
    setDraft('');
    setIsSidebarOpen(false);
  }

  function handleDeleteChat() {
    if (!selected) return;
    const remaining = conversations.filter(
      conversation => conversation.id !== selected.id,
    );
    if (remaining.length === 0) {
      const fresh = newConversation();
      setConversations([fresh]);
      setSelectedId(fresh.id);
    } else {
      setConversations(remaining);
      if (selected.id === selectedId) setSelectedId(remaining[0].id);
    }
  }

  function handleStop() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    abortRef.current?.abort();
    setIsResponding(false);
  }

  async function handleSubmit(value: string) {
    const text = value.trim();
    if (!text || !selected || isResponding) return;

    const conversationId = selected.id;
    const now = new Date().toISOString();
    const userMessage: Message = {
      id: makeId('u'),
      role: 'user',
      text,
      sentAt: now,
    };
    // The Beam models need the reasoning they emitted for each earlier
    // assistant turn. Replay it verbatim; skip assistant turns that have no
    // stored reasoning (e.g. the seeded welcome or older local-demo replies).
    const outbound: Array<{
      role: 'user' | 'assistant';
      content: string;
      reasoning_content?: string;
    }> = [];
    for (const message of selected.messages) {
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
    outbound.push({role: 'user', content: text});
    const replyId = makeId('a');
    const reply: Message = {
      id: replyId,
      role: 'assistant',
      text: '',
      sentAt: now,
    };

    setConversations(previous =>
      previous.map(conversation =>
        conversation.id === conversationId
          ? {
              ...conversation,
              title:
                conversation.messages.filter(message => message.role === 'user')
                  .length === 0
                  ? text.slice(0, 48)
                  : conversation.title,
              messages: [...conversation.messages, userMessage, reply],
              updatedAt: now,
            }
          : conversation,
      ),
    );
    setDraft('');
    setIsResponding(true);

    // Local demo mode — no key configured.
    if (!apiStatus.configured) {
      timerRef.current = setTimeout(() => {
        patchMessage(conversationId, replyId, {text: demoReply(text)});
        setIsResponding(false);
      }, 600);
      return;
    }

    // Live mode — stream tokens from our server-side proxy.
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({messages: outbound}),
        signal: controller.signal,
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
            if (changed) {
              patchMessage(conversationId, replyId, {
                text: content,
                reasoningContent: reasoning,
              });
            }
          } catch {
            // Ignore keep-alive comments / partial frames.
          }
        }
      }
      if (!content) {
        patchMessage(conversationId, replyId, {
          text: '(No content returned.)',
          reasoningContent: reasoning,
        });
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        patchMessage(conversationId, replyId, {
          text: `Sorry — the request failed: ${(error as Error).message}`,
        });
      }
    } finally {
      abortRef.current = null;
      setIsResponding(false);
    }
  }

  const sidebar = (
    <Stack direction="vertical" style={styles.sidebar}>
      <HStack gap={2} style={styles.sidebarHeader}>
        <StackItem size="fill">
          <HStack gap={2} vAlign="center">
            <Icon
              icon={ChatBubbleLeftRightIcon}
              size="sm"
              color="secondary"
            />
            <Heading level={6}>Conversations</Heading>
          </HStack>
        </StackItem>
        <IconButton
          label="New conversation"
          tooltip="New conversation"
          icon={<Icon icon={PlusIcon} size="sm" color="inherit" />}
          variant="ghost"
          size="sm"
          onClick={handleNewChat}
        />
        {isCompact && (
          <IconButton
            label="Close conversations"
            tooltip="Close conversations"
            icon={<Icon icon={XMarkIcon} size="sm" color="inherit" />}
            variant="ghost"
            size="sm"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}
      </HStack>

      <VStack style={styles.sidebarSearch}>
        <TextInput
          label="Search conversations"
          isLabelHidden
          size="sm"
          type="search"
          placeholder="Search conversations..."
          startIcon={MagnifyingGlassIcon}
          hasClear
          value={search}
          onChange={setSearch}
        />
      </VStack>

      <StackItem size="fill" style={styles.sidebarScroll}>
        {visibleConversations.length > 0 ? (
          <List density="compact" hasDividers={false} edge="outset">
            {visibleConversations.map(conversation => (
              <ListItem
                key={conversation.id}
                itemKey={conversation.id}
                label={conversation.title}
                description={`${conversation.messages.length} messages`}
                isSelected={conversation.id === selectedId}
                onClick={() => {
                  setSelectedId(conversation.id);
                  setIsSidebarOpen(false);
                }}
                startContent={
                  <Icon
                    icon={ChatBubbleLeftRightIcon}
                    size="sm"
                    color="secondary"
                  />
                }
              />
            ))}
          </List>
        ) : (
          <VStack style={{padding: 'var(--spacing-3)'}}>
            <Text type="supporting" color="secondary">
              No conversations match “{search}”.
            </Text>
          </VStack>
        )}
      </StackItem>

      <Divider />
      <VStack style={styles.sidebarFooter}>
        <Text type="supporting" color="secondary">
          Free &amp; open source · MIT licensed
        </Text>
      </VStack>
    </Stack>
  );

  return (
    <VStack style={styles.root}>
      <Layout
        height="fill"
        start={
          showSidebar ? (
            <LayoutPanel width={280} padding={0}>
              {sidebar}
            </LayoutPanel>
          ) : undefined
        }
        content={
          <LayoutContent padding={0}>
            <Stack direction="vertical" style={{height: '100%', minHeight: 0}}>
              <HStack gap={3} style={styles.streamHeader}>
                {isCompact && (
                  <IconButton
                    label="Open conversations"
                    tooltip="Open conversations"
                    icon={<Icon icon={Bars3Icon} size="sm" color="inherit" />}
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsSidebarOpen(true)}
                  />
                )}
                <StackItem size="fill" style={styles.title}>
                  <VStack gap={0}>
                    <Heading level={5}>
                      {selected?.title ?? 'New conversation'}
                    </Heading>
                    <Text type="supporting" color="secondary">
                      {apiStatus.configured
                        ? `${apiStatus.model} · streamed via ${apiStatus.provider}`
                        : 'Local demo · saved in this browser'}
                    </Text>
                  </VStack>
                </StackItem>
                <Badge
                  label={apiStatus.configured ? 'Live' : 'Local demo'}
                  variant="neutral"
                />
                <IconButton
                  label="Delete conversation"
                  tooltip="Delete conversation"
                  icon={<Icon icon={TrashIcon} size="sm" color="inherit" />}
                  variant="ghost"
                  size="sm"
                  onClick={handleDeleteChat}
                />
              </HStack>

              <Divider />

              <VStack style={styles.chatFill}>
                <ChatLayout
                  density="balanced"
                  style={styles.chatLayout}
                  composer={
                    <ChatComposer
                      value={draft}
                      onChange={setDraft}
                      onSubmit={handleSubmit}
                      isStopShown={isResponding}
                      onStop={handleStop}
                      placeholder="Ask anything about open-source AI..."
                      input={<ChatComposerInput />}
                      footerActions={
                        <Text type="supporting" color="secondary">
                          {apiStatus.configured
                            ? 'Server-side key · streamed reply'
                            : 'No API key · offline demo replies'}
                        </Text>
                      }
                    />
                  }
                  emptyState={
                    <EmptyState
                      icon={<Icon icon={SparklesIcon} size="lg" />}
                      title="Start an open conversation"
                      description={
                        apiStatus.configured
                          ? 'Connected to Reflection AI. Ask a question or try one of these:'
                          : 'Everything runs in your browser. Add REFLECTION_API_KEY to .env for live answers, or try one of these:'
                      }
                      actions={
                        <HStack gap={2} wrap="wrap">
                          {SUGGESTIONS.map(suggestion => (
                            <Button
                              key={suggestion}
                              label={suggestion}
                              variant="secondary"
                              size="sm"
                              onClick={() => handleSubmit(suggestion)}
                            />
                          ))}
                        </HStack>
                      }
                    />
                  }>
                  {selected && selected.messages.length > 0 ? (
                    <ChatMessageList density="balanced">
                      <ChatSystemMessage variant="divider">
                        Today
                      </ChatSystemMessage>
                      {selected.messages.map(message => (
                        <MessageRow key={message.id} message={message} />
                      ))}
                      {isResponding && (
                        <ChatSystemMessage>
                          Generating a reply…
                        </ChatSystemMessage>
                      )}
                    </ChatMessageList>
                  ) : null}
                </ChatLayout>
              </VStack>
            </Stack>
          </LayoutContent>
        }
      />
    </VStack>
  );
}
