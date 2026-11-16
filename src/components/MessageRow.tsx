import {useState} from 'react';

import {
  ChatMessage,
  ChatMessageBubble,
  ChatMessageMetadata,
} from '@astryxdesign/core/Chat';
import {Markdown} from '@astryxdesign/core/Markdown';
import {Collapsible} from '@astryxdesign/core/Collapsible';
import {Avatar} from '@astryxdesign/core/Avatar';
import {Button} from '@astryxdesign/core/Button';
import {HStack, VStack} from '@astryxdesign/core/Layout';
import {Icon} from '@astryxdesign/core/Icon';
import {IconButton} from '@astryxdesign/core/IconButton';
import {Text} from '@astryxdesign/core/Text';
import {TextArea} from '@astryxdesign/core/TextArea';
import {Timestamp} from '@astryxdesign/core/Timestamp';
import {useClipboard, useContainerReveal} from '@astryxdesign/core/hooks';

import {
  ArrowPathIcon,
  CheckIcon,
  ClipboardDocumentIcon,
  PencilIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

import type {Message} from '../chat/model';

type Props = {
  message: Message;
  isStreaming: boolean;
  onRegenerate: () => void;
  onEdit: (text: string) => void;
  onDelete: () => void;
};

export default function MessageRow({
  message,
  isStreaming,
  onRegenerate,
  onEdit,
  onDelete,
}: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(message.text);
  const {copy, isCopied} = useClipboard({announce: 'Message copied'});
  const reveal = useContainerReveal();

  const isUser = message.role === 'user';
  const reasoning = message.reasoningContent ?? '';
  const reasoningWords = reasoning.trim().split(/\s+/).filter(Boolean).length;
  const canRegenerate = !isUser && !isStreaming && Boolean(message.text.trim());
  const showActions = !isEditing && !isStreaming;

  function saveEdit() {
    const text = draft.trim();
    if (text) onEdit(text);
    setIsEditing(false);
  }

  const metadata = (
    <ChatMessageMetadata
      timestamp={<Timestamp value={message.sentAt} format="time" />}
    />
  );

  const body = isEditing ? (
    <VStack gap={2} width="100%">
      <TextArea
        label="Edit message"
        isLabelHidden
        rows={4}
        value={draft}
        onChange={setDraft}
        hasAutoFocus
      />
      <HStack gap={2}>
        <Button
          label="Cancel"
          size="sm"
          variant="ghost"
          icon={<Icon icon={XMarkIcon} size="sm" />}
          onClick={() => setIsEditing(false)}
        />
        <Button label="Save & resend" size="sm" variant="primary" onClick={saveEdit} />
      </HStack>
    </VStack>
  ) : isUser ? (
    <Text style={{whiteSpace: 'pre-wrap'}}>{message.text}</Text>
  ) : message.text ? (
    <Markdown
      density="compact"
      headingLevelStart={4}
      autolink="gfm"
      isStreaming={isStreaming}>
      {message.text}
    </Markdown>
  ) : (
    <Text type="supporting" color="secondary">
      Thinking…
    </Text>
  );

  return (
    <ChatMessage
      sender={isUser ? 'user' : 'assistant'}
      avatar={isUser ? undefined : <Avatar name="Open Sandbox" size="md" />}>
      <VStack {...reveal.getContainerProps({hoverDelay: 120})}>
        <ChatMessageBubble
          variant={isUser ? undefined : 'ghost'}
          name={isUser ? undefined : 'Open Sandbox'}
          metadata={isEditing ? undefined : metadata}>
          {body}
        </ChatMessageBubble>

        {isStreaming && reasoning && (
          <Text type="supporting" color="secondary">
            Reasoning…
          </Text>
        )}

        {showActions && reasoning && (
          <Collapsible
            defaultIsOpen={false}
            trigger={
              <Text type="body" weight="semibold">
                Reasoning
              </Text>
            }>
            <VStack gap={2}>
              <HStack gap={2} vAlign="center" justify="between" wrap="wrap">
                <Text type="supporting" color="secondary">
                  {reasoningWords} words of internal reasoning
                </Text>
                <Button
                  label="Copy reasoning"
                  variant="ghost"
                  size="sm"
                  icon={<Icon icon={ClipboardDocumentIcon} size="sm" />}
                  onClick={() => void copy(reasoning)}
                />
              </HStack>
              <Text
                type="body"
                color="secondary"
                style={{whiteSpace: 'pre-wrap'}}>
                {reasoning}
              </Text>
            </VStack>
          </Collapsible>
        )}

        {showActions && (
          <HStack gap={1} {...reveal.getContentRevealProps()}>
            <IconButton
              label="Copy message"
              tooltip={isCopied ? 'Copied' : 'Copy message'}
              size="sm"
              variant="ghost"
              icon={
                <Icon
                  icon={isCopied ? CheckIcon : ClipboardDocumentIcon}
                  size="sm"
                  color="inherit"
                />
              }
              onClick={() => void copy(message.text)}
            />
            {canRegenerate && (
              <IconButton
                label="Regenerate response"
                tooltip="Regenerate response"
                size="sm"
                variant="ghost"
                icon={<Icon icon={ArrowPathIcon} size="sm" color="inherit" />}
                onClick={onRegenerate}
              />
            )}
            {isUser && (
              <IconButton
                label="Edit message"
                tooltip="Edit message"
                size="sm"
                variant="ghost"
                icon={<Icon icon={PencilIcon} size="sm" color="inherit" />}
                onClick={() => {
                  setDraft(message.text);
                  setIsEditing(true);
                }}
              />
            )}
            <IconButton
              label="Delete message"
              tooltip="Delete message"
              size="sm"
              variant="ghost"
              icon={<Icon icon={TrashIcon} size="sm" color="inherit" />}
              onClick={onDelete}
            />
          </HStack>
        )}
      </VStack>
    </ChatMessage>
  );
}
