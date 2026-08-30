import { authFetch } from '@/lib/authApi';
import { readApiErrorMessage } from '@/lib/apiResponse';

export class AccountDeletionError extends Error {
  statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'AccountDeletionError';
    this.statusCode = statusCode;
  }
}

/** Server-side account deletion (P0-10) — irreversible. */
export async function deleteAccountSecure(): Promise<void> {
  const res = await authFetch('/api/account/delete', {
    method: 'POST',
    body: JSON.stringify({ confirm: true }),
  });

  if (!res.ok) {
    throw new AccountDeletionError(
      await readApiErrorMessage(res, 'DELETE_ACCOUNT_FAILED'),
      res.status
    );
  }
}
