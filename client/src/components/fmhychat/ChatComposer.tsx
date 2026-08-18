/** FMHY Reference Tool: a compact, source-aware composer with clear keyboard and focus behavior. */

import { ArrowUp, Loader2, X } from "lucide-react";
import { useId, useRef } from "react";

type ChatComposerProps = {
  availabilityMessage: string;
  error: string | null;
  isSubmitting: boolean;
  onCancel?: () => void;
  onChange: (value: string) => void;
  onSubmit: () => void;
  retrySecondsRemaining?: number | null;
  value: string;
};

export function ChatComposer({ availabilityMessage, error, isSubmitting, onCancel, onChange, onSubmit, retrySecondsRemaining, value }: ChatComposerProps) {
  const id = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const remainingCharacters = 240 - value.length;

  return (
    <form
      className="fmhy-composer"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <label className="sr-only" htmlFor={id}>
        Ask the FMHY database
      </label>
      <textarea
        id={id}
        maxLength={240}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            onSubmit();
          }
        }}
        placeholder="Ask the FMHY database…"
        ref={textareaRef}
        rows={2}
        value={value}
      />
      <div className="flex items-center justify-between gap-3 px-3 pb-3 sm:px-4">
        <span className="fmhy-composer-status-wrap">
          <span className="fmhy-composer-status">{availabilityMessage}</span>
          <span className="fmhy-character-count" aria-live="polite">{remainingCharacters} characters remaining</span>
        </span>
        {isSubmitting ? (
          <button aria-label="Cancel search" className="fmhy-cancel-button" onClick={onCancel} type="button">
            <X className="size-3.5" strokeWidth={2.5} />
            Cancel
          </button>
        ) : (
          <button aria-label="Send message" className="fmhy-send-button" disabled={!value.trim() || Boolean(retrySecondsRemaining)} type="submit">
            <ArrowUp className="size-4" strokeWidth={2.5} />
          </button>
        )}
      </div>
      {error ? <p className="px-4 pb-3 text-xs font-medium text-[#b42318]" role="alert">{error}</p> : null}
    </form>
  );
}
