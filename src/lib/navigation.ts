function withHost(hostname: string) {
  const url = new URL(window.location.href);
  url.hostname = hostname;
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function appUrl() {
  const hostname = window.location.hostname;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return withHost('app.localhost');
  return withHost(hostname.startsWith('app.') ? hostname : `app.${hostname}`);
}

export function landingUrl() {
  const hostname = window.location.hostname;
  if (hostname === 'app.localhost') return withHost('localhost');
  if (hostname.startsWith('app.')) return withHost(hostname.slice(4));
  return withHost(hostname);
}
