'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Button, ErrorText } from '@command-center/ui';
import { t } from '@/lib/i18n';

/**
 * Hard delete behind a confirmation (ADR-016, PO-confirmed: no trash, no
 * undo window). Native modal <dialog>: focus moves to Cancel on open and
 * back to the opener on close.
 */
export function DeleteEntryDialog({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}): ReactElement {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) {
      opener.current = document.activeElement;
      setFailed(false);
      node.showModal();
      cancel.current?.focus();
    } else if (!open && node.open) {
      node.close();
      if (opener.current instanceof HTMLElement) opener.current.focus();
    }
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className="cc-dialog"
      aria-labelledby="cc-journal-delete-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2 id="cc-journal-delete-title" className="cc-dialog-title">
        {t('journal.delete.title')}
      </h2>
      <p>{t('journal.delete.body')}</p>
      {failed && <ErrorText>{t('journal.delete.failed')}</ErrorText>}
      <div className="cc-dialog-footer">
        <span className="cc-dialog-footer-spacer" />
        <button
          ref={cancel}
          type="button"
          className="cc-btn cc-btn-ghost"
          onClick={onCancel}
          disabled={busy}
        >
          {t('journal.cancel')}
        </button>
        <Button
          variant="danger"
          busy={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
            } catch {
              setFailed(true);
            } finally {
              setBusy(false);
            }
          }}
        >
          {t('journal.delete.confirm')}
        </Button>
      </div>
    </dialog>
  );
}
