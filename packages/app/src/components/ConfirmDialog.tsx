interface Props {
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ message, confirmLabel = "Delete", onConfirm, onCancel }: Props) {
  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={onCancel}
      onKeyDown={(e) => e.key === "Escape" && onCancel()}
    >
      <div
        className="modal confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-describedby="confirm-msg"
        onClick={(e) => e.stopPropagation()}
      >
        <p id="confirm-msg" className="confirm-message">{message}</p>
        <div className="modal-actions">
          <button className="btn secondary" autoFocus onClick={onCancel}>Cancel</button>
          <button className="btn danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
