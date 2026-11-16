// Based on the Astryx `ai-chat` page template. Its two-column frame and
// spacing are kept; the artifact panel is replaced with a conversation list
// and the transcript is wired to a live, streamed chat endpoint.

import {useEffect, useMemo, useRef, useState, type CSSProperties} from 'react';

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
  ChatMessageList,
  ChatSystemMessage,
} from '@astryxdesign/core/Chat';
import {Badge} from '@astryxdesign/core/Badge';
import {Button} from '@astryxdesign/core/Button';
import {Dialog, DialogHeader} from '@astryxdesign/core/Dialog';
import {Drawer} from '@astryxdesign/core/Drawer';
import {Divider} from '@astryxdesign/core/Divider';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Icon} from '@astryxdesign/core/Icon';
import {IconButton} from '@astryxdesign/core/IconButton';
import {List, ListItem} from '@astryxdesign/core/List';
import {MoreMenu} from '@astryxdesign/core/MoreMenu';
import {TextInput} from '@astryxdesign/core/TextInput';
import {useMediaQuery} from '@astryxdesign/core/hooks';

import {
  ArrowDownTrayIcon,
  ChatBubbleLeftRightIcon,
  ChevronDoubleLeftIcon,
  ChevronDoubleRightIcon,
  Cog6ToothIcon,
  MagnifyingGlassIcon,
  MoonIcon,
  PencilIcon,
  PlusIcon,
  SparklesIcon,
  SunIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

import MessageRow from '../components/MessageRow';
import SettingsDialog from '../components/SettingsDialog';
import {
  DEFAULT_SETTINGS,
  buildOutbound,
  conversationToMarkdown,
  downloadFile,
  loadConversations,
  loadSelectedId,
  loadSettings,
  makeId,
  newConversation,
  saveConversations,
  saveSelectedId,
  saveSettings,
  seedConversations,
  streamCompletion,
  wordCount,
  type ApiStatus,
  type Conversation,
  type Message,
  type OutboundMessage,
  type Settings,
  type ThemeMode,
} from '../chat/model';

// ---------------------------------------------------------------------------
// Offline fallback (used only when no API key is configured)
// ---------------------------------------------------------------------------

const SUGGESTIONS = [
  'Explain how a JWT works with a code example',
  'Compare REST and GraphQL in a table',
  'Write a markdown checklist for launching a side project',
  'How do I run open-source models locally?',
];

const DEMO_REPLIES: Array<{match: RegExp; text: string}> = [
  {
    match: /jwt|token|auth/i,
    text: '## JSON Web Tokens\n\nA JWT has three parts: `header.payload.signature`. The server signs it so the client can send proof of identity without a session.\n\n| Part | Purpose |\n| --- | --- |\n| Header | Algorithm and type |\n| Payload | Claims such as `sub` and `exp` |\n| Signature | Verifies it was not tampered with |\n\n```js\nconst token = sign({sub: user.id, exp: expiresAt}, secret);\n```',
  },
  {
    match: /rest|graphql|table|compare/i,
    text: '| Aspect | REST | GraphQL |\n| --- | --- | --- |\n| Endpoints | Many URLs | One endpoint |\n| Data fetching | Over/under-fetching | Ask for exactly what you need |\n| Caching | Built into HTTP | Needs a client cache |\n\nBoth are fine — pick based on how varied your clients are.',
  },
  {
    match: /ollama|local|offline|run.*model/i,
    text: '## Run open models locally\n\n- **Ollama** — one command to run Llama, Mistral, Qwen or Gemma\n- **LM Studio** — desktop app with a model browser\n- Both expose an OpenAI-compatible API, so Open Sandbox can point at them instead of a hosted service.',
  },
  {
    match: /license|open.?source|mit|free/i,
    text: 'Everything here is **MIT licensed**: Astryx, React, StyleX and this project. Model weights each have their own license, so check the model card before commercial use.',
  },
  {
    match: /privacy|data|cloud|store/i,
    text: 'Conversations live in this browser via `localStorage`. When a live key is set, messages go to that provider for inference only. Use **Export** to keep a Markdown copy, or **Clear all** to remove everything.',
  },
];

function demoReply(input: string) {
  return (
    DEMO_REPLIES.find(reply => reply.match.test(input))?.text ??
    'This is the local demo responder. Set `REFLECTION_API_KEY` in `.env` and restart the dev server to chat with a live model instead.'
  );
}

// ---------------------------------------------------------------------------
// Styles — semantic tokens only, no raw colors or pixel values
// ---------------------------------------------------------------------------

const styles: Record<string, CSSProperties> = {
  root: {
    height: '100dvh',
    width: '100%',
    paddingInline: 'env(safe-area-inset-left) env(safe-area-inset-right)',
    paddingBottom: 'env(safe-area-inset-bottom)',
  },
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
  sidebarFooter: {padding: 'var(--spacing-2)'},
  streamHeader: {
    alignItems: 'center',
    paddingInline: 'var(--spacing-4)',
    paddingBlock: 'var(--spacing-3)',
  },
  title: {minWidth: 0},
  chatFill: {flex: 1, minHeight: 0, width: '100%'},
  chatLayout: {flex: 1, minHeight: 0},
  pad: {padding: 'var(--spacing-3)'},
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type Props = {
  mode: ThemeMode;
  onModeChange: (mode: ThemeMode) => void;
};

export default function AIChatPage({mode, onModeChange}: Props) {
  const [conversations, setConversations] =
    useState<Conversation[]>(loadConversations);
  const [selectedId, setSelectedId] = useState(loadSelectedId);
  const [draft, setDraft] = useState('');
  const [isResponding, setIsResponding] = useState(false);
  const [search, setSearch] = useState('');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [apiStatus, setApiStatus] = useState<ApiStatus>({
    configured: false,
    provider: 'Local demo',
    model: 'No API key',
  });

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [isClearOpen, setIsClearOpen] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const isMobile = useMediaQuery('(max-width: 768px)');
  const isTablet = useMediaQuery('(min-width: 769px) and (max-width: 1024px)');
  const isShort = useMediaQuery('(max-height: 600px)');
  const compactChat = isMobile || isShort;
  const showSidebar = isMobile ? isMobileSidebarOpen : !isSidebarCollapsed;

  function toggleSidebar() {
    if (isMobile) setIsMobileSidebarOpen(open => !open);
    else setIsSidebarCollapsed(collapsed => !collapsed);
  }

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
        // Static hosting without the proxy — keep the local demo.
      });
  }, []);

  useEffect(() => saveConversations(conversations), [conversations]);
  useEffect(() => {
    if (!selectedId && conversations.length > 0) {
      setSelectedId(conversations[0].id);
    }
    if (selectedId) saveSelectedId(selectedId);
  }, [conversations, selectedId]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      abortRef.current?.abort();
    },
    [],
  );

  const selected = conversations.find(
    conversation => conversation.id === selectedId,
  );

  const visibleConversations = useMemo(() => {
    const query = search.trim().toLowerCase();
    const sorted = [...conversations].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
    if (!query) return sorted;
    return sorted.filter(
      conversation =>
        conversation.title.toLowerCase().includes(query) ||
        conversation.messages.some(message =>
          message.text.toLowerCase().includes(query),
        ),
    );
  }, [conversations, search]);

  // --- state helpers -------------------------------------------------------

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

  function runDemoReply(
    conversationId: string,
    replyId: string,
    sourceText: string,
  ) {
    setIsResponding(true);
    timerRef.current = setTimeout(() => {
      patchMessage(conversationId, replyId, {text: demoReply(sourceText)});
      setIsResponding(false);
    }, 600);
  }

  async function streamReply(
    conversationId: string,
    replyId: string,
    outbound: OutboundMessage[],
  ) {
    const controller = new AbortController();
    abortRef.current = controller;
    setIsResponding(true);
    try {
      await streamCompletion(
        outbound,
        settings,
        (text, reasoning) => {
          patchMessage(conversationId, replyId, {
            text,
            reasoningContent: reasoning,
          });
        },
        controller.signal,
      );
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

  function runReply(
    conversationId: string,
    replyId: string,
    outbound: OutboundMessage[],
    sourceText: string,
  ) {
    if (apiStatus.configured) {
      void streamReply(conversationId, replyId, outbound);
    } else {
      runDemoReply(conversationId, replyId, sourceText);
    }
  }

  // --- actions -------------------------------------------------------------

  function handleNewChat() {
    const conversation = newConversation();
    setConversations(previous => [conversation, ...previous]);
    setSelectedId(conversation.id);
    setDraft('');
    setIsMobileSidebarOpen(false);
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

  function handleDeleteMessage(messageId: string) {
    if (!selected) return;
    setConversations(previous =>
      previous.map(conversation =>
        conversation.id === selected.id
          ? {
              ...conversation,
              messages: conversation.messages.filter(
                message => message.id !== messageId,
              ),
              updatedAt: new Date().toISOString(),
            }
          : conversation,
      ),
    );
  }

  function handleSubmit(value: string) {
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
    const replyId = makeId('a');
    const history = [...selected.messages, userMessage];

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
              messages: [
                ...conversation.messages,
                userMessage,
                {id: replyId, role: 'assistant', text: '', sentAt: now},
              ],
              updatedAt: now,
            }
          : conversation,
      ),
    );
    setDraft('');
    runReply(
      conversationId,
      replyId,
      buildOutbound(history, settings.systemPrompt),
      text,
    );
  }

  function handleRegenerate(messageId: string) {
    if (!selected || isResponding) return;
    const index = selected.messages.findIndex(message => message.id === messageId);
    if (index < 0) return;
    const base = selected.messages.slice(0, index);
    const source =
      [...base].reverse().find(message => message.role === 'user')?.text ?? '';
    const replyId = makeId('a');
    const now = new Date().toISOString();

    setConversations(previous =>
      previous.map(conversation =>
        conversation.id === selected.id
          ? {
              ...conversation,
              messages: [
                ...base,
                {id: replyId, role: 'assistant', text: '', sentAt: now},
              ],
              updatedAt: now,
            }
          : conversation,
      ),
    );
    runReply(
      selected.id,
      replyId,
      buildOutbound(base, settings.systemPrompt),
      source,
    );
  }

  function handleEditMessage(messageId: string, text: string) {
    if (!selected || isResponding) return;
    const index = selected.messages.findIndex(message => message.id === messageId);
    if (index < 0) return;
    const base = [
      ...selected.messages.slice(0, index),
      {...selected.messages[index], text, sentAt: new Date().toISOString()},
    ];
    const replyId = makeId('a');
    const now = new Date().toISOString();

    setConversations(previous =>
      previous.map(conversation =>
        conversation.id === selected.id
          ? {
              ...conversation,
              messages: [
                ...base,
                {id: replyId, role: 'assistant', text: '', sentAt: now},
              ],
              updatedAt: now,
            }
          : conversation,
      ),
    );
    runReply(
      selected.id,
      replyId,
      buildOutbound(base, settings.systemPrompt),
      text,
    );
  }

  function handleStop() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    abortRef.current?.abort();
    setIsResponding(false);
  }

  function handleExport() {
    if (!selected) return;
    const slug =
      selected.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'conversation';
    downloadFile(`${slug}.md`, conversationToMarkdown(selected));
  }

  function handleExportAll() {
    if (conversations.length === 0) return;
    const document = conversations
      .map(conversationToMarkdown)
      .join('\n\n---\n\n');
    downloadFile('open-sandbox-conversations.md', document);
  }

  function handleRenameSave() {
    const title = renameValue.trim();
    if (title && selected) {
      setConversations(previous =>
        previous.map(conversation =>
          conversation.id === selected.id ? {...conversation, title} : conversation,
        ),
      );
    }
    setIsRenameOpen(false);
  }

  function handleClearAll() {
    const fresh = seedConversations();
    setConversations(fresh);
    setSelectedId(fresh[0].id);
    setIsClearOpen(false);
  }

  function handleToggleTheme() {
    const next: ThemeMode =
      mode === 'dark'
        ? 'light'
        : mode === 'light'
          ? 'dark'
          : window.matchMedia?.('(prefers-color-scheme: dark)').matches
            ? 'light'
            : 'dark';
    setSettings(previous => {
      const updated = {...previous, mode: next};
      saveSettings(updated);
      return updated;
    });
    onModeChange(next);
  }

  function handleSaveSettings(next: Settings) {
    setSettings(next);
    saveSettings(next);
    onModeChange(next.mode);
  }

  // Keep shortcut handlers fresh without rebinding on every streamed token.
  const shortcutsRef = useRef({handleNewChat, handleToggleTheme});
  shortcutsRef.current = {handleNewChat, handleToggleTheme};

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'k') {
        event.preventDefault();
        shortcutsRef.current.handleNewChat();
      } else if (key === ',') {
        event.preventDefault();
        setIsSettingsOpen(true);
      } else if (key === 'l' && event.shiftKey) {
        event.preventDefault();
        shortcutsRef.current.handleToggleTheme();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // --- layout --------------------------------------------------------------

  const sidebar = (
    <Stack direction="vertical" style={styles.sidebar}>
      <HStack gap={2} style={styles.sidebarHeader}>
        <StackItem size="fill">
          <HStack gap={2} vAlign="center">
            <Icon icon={ChatBubbleLeftRightIcon} size="sm" color="secondary" />
            <Heading level={5}>Open Sandbox</Heading>
          </HStack>
        </StackItem>
        <IconButton
          label="New conversation"
          tooltip="New conversation (⌘/Ctrl+K)"
          icon={<Icon icon={PlusIcon} size="sm" color="inherit" />}
          variant="ghost"
          size="sm"
          onClick={handleNewChat}
        />
        {isMobile && (
          <IconButton
            label="Close conversations"
            tooltip="Close conversations"
            icon={<Icon icon={XMarkIcon} size="sm" color="inherit" />}
            variant="ghost"
            size="sm"
            onClick={() => setIsMobileSidebarOpen(false)}
          />
        )}
      </HStack>

      <VStack style={styles.sidebarSearch}>
        <TextInput
          label="Search conversations and messages"
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
          <List
            density="compact"
            hasDividers={false}
            edge="outset"
            header={
              <Text type="label" size="sm" color="secondary">
                Conversations
              </Text>
            }>
            {visibleConversations.map(conversation => (
              <ListItem
                key={conversation.id}
                itemKey={conversation.id}
                label={conversation.title}
                description={`${conversation.messages.length} messages`}
                isSelected={conversation.id === selectedId}
                onClick={() => {
                  setSelectedId(conversation.id);
                  setIsMobileSidebarOpen(false);
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
          <VStack style={styles.pad}>
            <Text type="supporting" color="secondary">
              No conversations or messages match “{search}”.
            </Text>
          </VStack>
        )}
      </StackItem>

      <Divider />
      <VStack gap={1} style={styles.sidebarFooter}>
        <HStack gap={1}>
          <Button
            label="Export all"
            variant="ghost"
            size="sm"
            icon={<Icon icon={ArrowDownTrayIcon} size="sm" />}
            onClick={handleExportAll}
          />
          <Button
            label="Clear all"
            variant="ghost"
            size="sm"
            icon={<Icon icon={TrashIcon} size="sm" />}
            onClick={() => setIsClearOpen(true)}
          />
        </HStack>
        <Text type="supporting" color="secondary">
          Free &amp; open source · MIT licensed
        </Text>
      </VStack>
    </Stack>
  );

  const headerActions = isMobile ? (
    <MoreMenu
      label="Conversation actions"
      size="sm"
      items={[
        {
          label: mode === 'dark' ? 'Light mode' : 'Dark mode',
          icon: mode === 'dark' ? SunIcon : MoonIcon,
          onClick: handleToggleTheme,
        },
        {
          label: 'Settings',
          icon: Cog6ToothIcon,
          onClick: () => setIsSettingsOpen(true),
        },
        {
          label: 'Rename conversation',
          icon: PencilIcon,
          onClick: () => {
            setRenameValue(selected?.title ?? '');
            setIsRenameOpen(true);
          },
        },
        {
          label: 'Export as Markdown',
          icon: ArrowDownTrayIcon,
          onClick: handleExport,
        },
        {type: 'divider'},
        {
          label: 'Delete conversation',
          icon: TrashIcon,
          onClick: handleDeleteChat,
        },
      ]}
    />
  ) : (
    <>
      <IconButton
        label={mode === 'dark' ? 'Switch to light' : 'Switch to dark'}
        tooltip={
          mode === 'dark' ? 'Switch to light (⌘/Ctrl+⇧+L)' : 'Switch to dark (⌘/Ctrl+⇧+L)'
        }
        icon={
          <Icon
            icon={mode === 'dark' ? SunIcon : MoonIcon}
            size="sm"
            color="inherit"
          />
        }
        variant="ghost"
        size="sm"
        onClick={handleToggleTheme}
      />
      <IconButton
        label="Settings"
        tooltip="Settings (⌘/Ctrl+,)"
        icon={<Icon icon={Cog6ToothIcon} size="sm" color="inherit" />}
        variant="ghost"
        size="sm"
        onClick={() => setIsSettingsOpen(true)}
      />
      <IconButton
        label="Rename conversation"
        tooltip="Rename conversation"
        icon={<Icon icon={PencilIcon} size="sm" color="inherit" />}
        variant="ghost"
        size="sm"
        onClick={() => {
          setRenameValue(selected?.title ?? '');
          setIsRenameOpen(true);
        }}
      />
      <IconButton
        label="Export conversation"
        tooltip="Export as Markdown"
        icon={<Icon icon={ArrowDownTrayIcon} size="sm" color="inherit" />}
        variant="ghost"
        size="sm"
        onClick={handleExport}
      />
      <IconButton
        label="Delete conversation"
        tooltip="Delete conversation"
        icon={<Icon icon={TrashIcon} size="sm" color="inherit" />}
        variant="ghost"
        size="sm"
        onClick={handleDeleteChat}
      />
    </>
  );

  const headerStyle: CSSProperties = {
    ...styles.streamHeader,
    paddingInline: isMobile
      ? 'var(--spacing-2)'
      : isTablet
        ? 'var(--spacing-3)'
        : 'var(--spacing-4)',
    paddingBlock: compactChat ? 'var(--spacing-2)' : 'var(--spacing-3)',
  };

  return (
    <VStack style={styles.root}>
      <Layout
        height="fill"
        start={
          !isMobile && showSidebar ? (
            <LayoutPanel width={isTablet ? 240 : 280} padding={0}>
              {sidebar}
            </LayoutPanel>
          ) : undefined
        }
        content={
          <LayoutContent padding={0}>
            <Stack direction="vertical" style={{height: '100%', minHeight: 0}}>
              <HStack gap={2} style={headerStyle}>
                <IconButton
                  label={showSidebar ? 'Hide conversations' : 'Show conversations'}
                  tooltip={
                    showSidebar
                      ? 'Hide conversations'
                      : 'Show conversations'
                  }
                  icon={
                    <Icon
                      icon={
                        showSidebar
                          ? ChevronDoubleLeftIcon
                          : ChevronDoubleRightIcon
                      }
                      size="sm"
                      color="inherit"
                    />
                  }
                  variant="ghost"
                  size="sm"
                  onClick={toggleSidebar}
                />
                <StackItem size="fill" style={styles.title}>
                  <VStack gap={0}>
                    <Heading level={5}>
                      {selected?.title ?? 'New conversation'}
                    </Heading>
                    <Text type="supporting" color="secondary" maxLines={1}>
                      {isMobile
                        ? `${selected?.messages.length ?? 0} messages · ${apiStatus.configured ? 'live' : 'local demo'}`
                        : `${selected?.messages.length ?? 0} messages · ${wordCount(selected ? [selected] : [])} words · ${apiStatus.configured ? `${apiStatus.model} via ${apiStatus.provider}` : 'local demo'}`}
                    </Text>
                  </VStack>
                </StackItem>
                {!isMobile && (
                  <Badge
                    label={apiStatus.configured ? 'Live' : 'Local demo'}
                    variant="neutral"
                  />
                )}
                {headerActions}
              </HStack>

              <Divider />

              <VStack style={styles.chatFill}>
                <ChatLayout
                  density={compactChat ? 'compact' : 'balanced'}
                  style={styles.chatLayout}
                  composer={
                    <ChatComposer
                      density={compactChat ? 'compact' : 'balanced'}
                      value={draft}
                      onChange={setDraft}
                      onSubmit={handleSubmit}
                      isStopShown={isResponding}
                      onStop={handleStop}
                      placeholder="Ask anything — Markdown is supported..."
                      input={<ChatComposerInput />}
                      footerActions={
                        isMobile ? undefined : (
                          <Text type="supporting" color="secondary">
                            {apiStatus.configured
                              ? 'Streaming · reasoning preserved'
                              : 'Offline demo · replies use Markdown'}
                          </Text>
                        )
                      }
                    />
                  }
                  emptyState={
                    <EmptyState
                      icon={<Icon icon={SparklesIcon} size="lg" />}
                      title="Start an open conversation"
                      description={
                        apiStatus.configured
                          ? 'Replies support Markdown, code blocks and tables. Try one of these:'
                          : 'Runs entirely in your browser with Markdown replies. Add REFLECTION_API_KEY to .env for live answers, or try one of these:'
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
                    <ChatMessageList
                      density={compactChat ? 'compact' : 'balanced'}>
                      <ChatSystemMessage variant="divider">Today</ChatSystemMessage>
                      {selected.messages.map(message => (
                        <MessageRow
                          key={message.id}
                          message={message}
                          isStreaming={
                            isResponding &&
                            message.role === 'assistant' &&
                            message === selected.messages[selected.messages.length - 1]
                          }
                          onRegenerate={() => handleRegenerate(message.id)}
                          onEdit={text => handleEditMessage(message.id, text)}
                          onDelete={() => handleDeleteMessage(message.id)}
                        />
                      ))}
                    </ChatMessageList>
                  ) : null}
                </ChatLayout>
              </VStack>
            </Stack>
          </LayoutContent>
        }
      />

      {isMobile && (
        <Drawer
          isOpen={isMobileSidebarOpen}
          onOpenChange={setIsMobileSidebarOpen}
          label="Conversations"
          side="start"
          width={320}
          padding={0}>
          {sidebar}
        </Drawer>
      )}

      <SettingsDialog
        isOpen={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        settings={settings}
        onSave={handleSaveSettings}
      />

      <Dialog
        isOpen={isRenameOpen}
        onOpenChange={setIsRenameOpen}
        purpose="form"
        width={420}>
        <VStack gap={3}>
          <DialogHeader title="Rename conversation" onOpenChange={setIsRenameOpen} />
          <TextInput
            label="Title"
            value={renameValue}
            onChange={setRenameValue}
            onEnter={handleRenameSave}
            hasAutoFocus
          />
          <HStack gap={2} justify="end">
            <Button label="Cancel" variant="ghost" onClick={() => setIsRenameOpen(false)} />
            <Button label="Save" variant="primary" onClick={handleRenameSave} />
          </HStack>
        </VStack>
      </Dialog>

      <Dialog
        isOpen={isClearOpen}
        onOpenChange={setIsClearOpen}
        purpose="required"
        width={420}>
        <VStack gap={3}>
          <DialogHeader
            title="Clear all conversations?"
            subtitle="This removes every saved conversation and cannot be undone."
            onOpenChange={setIsClearOpen}
          />
          <HStack gap={2} justify="end">
            <Button label="Cancel" variant="ghost" onClick={() => setIsClearOpen(false)} />
            <Button
              label="Clear everything"
              variant="destructive"
              onClick={handleClearAll}
            />
          </HStack>
        </VStack>
      </Dialog>
    </VStack>
  );
}
