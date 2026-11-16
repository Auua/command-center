'use client';

import type { Editor } from '@tiptap/react';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { Button, ErrorText } from '@command-center/ui';
import { t } from '@/lib/i18n';
import { normalizeJournalHref } from './editor-extensions';

/**
 * Inline link editor (Cmd/Ctrl+K or the toolbar's link button). Not a
 * browser prompt: it is a labelled field in the page, focus moves into it
 * and back to the text when it closes.
 */
export function LinkForm({
  editor,
  onClose,
}: {
  editor: Editor;
  onClose: () => void;
}): ReactElement {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const existing = editor.getAttributes('link').href as string | undefined;
  const [value, setValue] = useState(existing ?? '');
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const close = (): void => {
    onClose();
    editor.commands.focus();
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const href = normalizeJournalHref(value);
    if (!href) {
      setInvalid(true);
      input.current?.focus();
      return;
    }
    const chain = editor.chain().focus().extendMarkRange('link');
    if (editor.state.selection.empty && !editor.isActive('link')) {
      chain.insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] });
    } else {
      chain.setLink({ href });
    }
    chain.run();
    onClose();
  };

  const remove = (): void => {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    onClose();
  };

  return (
    <form
      className="cc-journal-link-form"
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          close();
        }
      }}
    >
      <label htmlFor={inputId}>{t('journal.link.label')}</label>
      <input
        id={inputId}
        ref={input}
        type="text"
        inputMode="url"
        autoComplete="off"
        value={value}
        aria-invalid={invalid || undefined}
        onChange={(event) => {
          setValue(event.target.value);
          setInvalid(false);
        }}
        placeholder="https://"
      />
      <Button type="submit" size="sm">
        {t('journal.link.apply')}
      </Button>
      {existing && (
        <Button variant="ghost" size="sm" onClick={remove}>
          {t('journal.link.remove')}
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={close}>
        {t('journal.cancel')}
      </Button>
      {invalid && <ErrorText>{t('journal.link.invalid')}</ErrorText>}
    </form>
  );
}
