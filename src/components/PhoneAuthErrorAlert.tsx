import React from 'react';

type PhoneAuthErrorAlertProps = {
  code: string;
  message: string;
  onDismiss: () => void;
};

/** In-app Alert that always shows the exact Firebase Auth code + server message. */
export function PhoneAuthErrorAlert({ code, message, onDismiss }: PhoneAuthErrorAlertProps) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="phone-auth-error-title"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/45 px-6"
      onClick={onDismiss}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="phone-auth-error-title" className="text-center text-lg font-semibold text-slate-900">
          Firebase Auth
        </h2>
        <p className="mt-3 break-all text-center font-mono text-sm font-semibold text-red-600" dir="ltr">
          {code}
        </p>
        <p className="mt-2 text-center text-sm leading-relaxed text-slate-700" dir="ltr">
          {message}
        </p>
        <button
          type="button"
          className="mt-5 w-full rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white"
          onClick={onDismiss}
        >
          OK
        </button>
      </div>
    </div>
  );
}

export function presentPhoneAuthErrorAlert(code: string, message: string): void {
  const line = message && message !== code ? `${code}: ${message}` : code;
  try {
    window.alert(line);
  } catch {
    /* WKWebView without alert */
  }
}
