import { authFetch } from '@/lib/authApi';
import { readApiErrorMessage, readApiJson } from '@/lib/apiResponse';
import { rememberCustomerOrderId } from '@/lib/customerOrderMemory';

export interface CustomerOrderListItem {
  id: string;
  data: Record<string, unknown>;
}

export async function fetchMyOrders(): Promise<CustomerOrderListItem[]> {
  const response = await authFetch('/api/orders/mine');
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to load orders'));
  }
  const result = await readApiJson<{ orders?: CustomerOrderListItem[] }>(response);
  const orders = Array.isArray(result.orders) ? result.orders : [];
  return orders.filter((row) => row && typeof row.id === 'string' && row.data);
}

export async function payCheckoutDraftWithWallet(draftId: string): Promise<{
  orderId: string;
  status: string;
}> {
  const response = await authFetch('/api/orders/pay-with-wallet', {
    method: 'POST',
    body: JSON.stringify({ draftId }),
  });
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Wallet payment failed'));
  }
  return readApiJson<{ orderId: string; status: string }>(response);
}

export function rememberPlacedOrder(uid: string, orderId: string): void {
  rememberCustomerOrderId(uid, orderId);
}
