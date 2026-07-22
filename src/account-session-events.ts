export const accountSessionRefreshEvent = 'helix:account-session-refresh';
export const accountSessionRefreshChannel = 'helix-account-session-refresh';
export const accountSessionRefreshMessage = 'refresh';

export function requestAccountSessionRefresh() {
  window.dispatchEvent(new Event(accountSessionRefreshEvent));
}

export function notifyAccountAuthorizationFailure(response: Pick<Response, 'status'>) {
  if (response.status === 401 || response.status === 403) {
    requestAccountSessionRefresh();
  }
}
