import {useEffect, useState} from 'react';

import {Dialog, DialogHeader} from '@astryxdesign/core/Dialog';
import {DropdownMenu} from '@astryxdesign/core/DropdownMenu';
import {Button} from '@astryxdesign/core/Button';
import {HStack, VStack} from '@astryxdesign/core/Layout';
import {Text} from '@astryxdesign/core/Text';
import {TextArea} from '@astryxdesign/core/TextArea';
import {TextInput} from '@astryxdesign/core/TextInput';

import type {Settings, ThemeMode} from '../chat/model';

type Props = {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  settings: Settings;
  onSave: (settings: Settings) => void;
};

const MODE_LABEL: Record<ThemeMode, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

export default function SettingsDialog({
  isOpen,
  onOpenChange,
  settings,
  onSave,
}: Props) {
  const [systemPrompt, setSystemPrompt] = useState(settings.systemPrompt);
  const [temperature, setTemperature] = useState(String(settings.temperature));
  const [maxTokens, setMaxTokens] = useState(String(settings.maxTokens));
  const [mode, setMode] = useState<ThemeMode>(settings.mode);

  useEffect(() => {
    if (isOpen) {
      setSystemPrompt(settings.systemPrompt);
      setTemperature(String(settings.temperature));
      setMaxTokens(String(settings.maxTokens));
      setMode(settings.mode);
    }
  }, [isOpen, settings]);

  function save() {
    const parsedTemperature = Number(temperature);
    const parsedMaxTokens = Number(maxTokens);
    onSave({
      systemPrompt,
      temperature: Number.isFinite(parsedTemperature)
        ? Math.min(2, Math.max(0, parsedTemperature))
        : 0.7,
      maxTokens: Number.isFinite(parsedMaxTokens)
        ? Math.min(128000, Math.max(256, Math.round(parsedMaxTokens)))
        : 16000,
      mode,
    });
    onOpenChange(false);
  }

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      purpose="form"
      width={520}
      padding={4}>
      <VStack gap={4}>
        <DialogHeader
          title="Settings"
          subtitle="Applies to new messages in every conversation."
          onOpenChange={onOpenChange}
        />

        <TextArea
          label="System prompt"
          description="Optional instructions prepended to every request."
          rows={4}
          placeholder="You are a helpful assistant..."
          value={systemPrompt}
          onChange={setSystemPrompt}
        />

        <HStack gap={3} wrap="wrap">
          <TextInput
            label="Temperature"
            description="0 = precise, 2 = creative"
            value={temperature}
            onChange={setTemperature}
            inputMode="decimal"
          />
          <TextInput
            label="Max tokens"
            description="Reply length limit"
            value={maxTokens}
            onChange={setMaxTokens}
            inputMode="numeric"
          />
          <VStack gap={1}>
            <Text type="label" weight="semibold">
              Appearance
            </Text>
            <DropdownMenu
              button={{label: MODE_LABEL[mode], variant: 'secondary', size: 'md'}}
              items={(['system', 'light', 'dark'] as ThemeMode[]).map(value => ({
                label: MODE_LABEL[value],
                onClick: () => setMode(value),
              }))}
            />
          </VStack>
        </HStack>

        <Text type="supporting" color="secondary">
          Shortcuts: ⌘/Ctrl+K new chat · ⌘/Ctrl+, settings · ⌘/Ctrl+⇧+L theme.
        </Text>

        <HStack gap={2} justify="end">
          <Button label="Cancel" variant="ghost" onClick={() => onOpenChange(false)} />
          <Button label="Save settings" variant="primary" onClick={save} />
        </HStack>
      </VStack>
    </Dialog>
  );
}
