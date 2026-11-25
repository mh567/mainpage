import { lookup } from 'node:dns';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { parse } from 'parse5';

const privateIPv4 = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10],
  ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 3],
] as const) {
  privateIPv4.addSubnet(address, prefix);
}

const publicIPv6 = new BlockList();
publicIPv6.addSubnet('2000::', 3, 'ipv6');
const specialIPv6 = new BlockList();
specialIPv6.addSubnet('2001::', 23, 'ipv6');
specialIPv6.addSubnet('2001:db8::', 32, 'ipv6');
specialIPv6.addSubnet('2002::', 16, 'ipv6');
specialIPv6.addSubnet('3fff::', 20, 'ipv6');

function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) return !privateIPv4.check(address);
  return publicIPv6.check(address, 'ipv6') && !specialIPv6.check(address, 'ipv6');
}

function webURL(value: string, base?: URL): URL | undefined {
  if (!value.trim()) return;
  const url = URL.parse(value, base);
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) return;
  return url;
}

export function readLinkMetadata(html: string, url: URL) {
  const root = parse(html).childNodes.find((node) => node.nodeName === 'html');
  const head = root && 'childNodes' in root
    ? root.childNodes.find((node) => node.nodeName === 'head')
    : undefined;

  let title = '';
  let shareTitle = '';
  let icon = '';
  for (const node of head && 'childNodes' in head ? head.childNodes : []) {
    if (!('tagName' in node)) continue;
    const attr = (name: string) => node.attrs.find((item) => item.name === name)?.value ?? '';
    if (node.tagName === 'title') {
      const text = node.childNodes[0];
      if (text && 'value' in text) title ||= text.value;
    }
    if (node.tagName === 'meta' && attr('property').toLowerCase() === 'og:title') {
      shareTitle ||= attr('content');
    }
    if (node.tagName === 'link' && attr('rel').toLowerCase().split(/\s+/).includes('icon')) {
      const candidate = webURL(attr('href'), url);
      if (candidate?.protocol === 'https:') icon = candidate.href;
    }
  }

  const label = [shareTitle, title]
    .map((value) => value.replace(/https?:\/\/\S+/gi, '').replace(/\s+/g, ' ').trim())
    .find(Boolean);
  return { title: label ?? '', icon };
}

function requestPage(url: URL, signal: AbortSignal) {
  const address = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(address) && !isPublicAddress(address)) throw new Error('Non-public address');

  const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
    request(url, {
      signal,
      headers: { Accept: 'text/html', 'Accept-Encoding': 'identity' },
      // Check the resolved addresses used for the connection, including redirected requests.
      lookup(hostname, options, callback) {
        lookup(hostname, { all: true }, (error, addresses) => {
          if (error) return callback(error, '', 0);
          const allowed = addresses.filter(({ address }) => isPublicAddress(address));
          if (!allowed.length) return callback(new Error('Non-public address'), '', 0);
          if (options.all) return callback(null, allowed);
          const [{ address, family }] = allowed;
          callback(null, address, family);
        });
      },
    }, resolve).on('error', reject).end();
  });
}

async function fetchMetadata(url: URL) {
  const signal = AbortSignal.timeout(4_000);
  for (let hop = 0; hop < 4; hop++) {
    const response = await requestPage(url, signal);
    const { statusCode = 0, headers } = response;
    if (statusCode >= 300 && statusCode < 400 && headers.location) {
      response.destroy();
      const next = webURL(headers.location, url);
      if (!next) return;
      url = next;
      continue;
    }
    if (statusCode !== 200 || !/^text\/html\b/i.test(headers['content-type'] ?? '')) {
      response.destroy();
      return;
    }

    const chunks: Buffer[] = [];
    let remaining = 256 * 1024;
    let tail = '';
    for await (const chunk of response) {
      const part = chunk.subarray(0, remaining);
      chunks.push(part);
      remaining -= part.length;
      const text = tail + part.toString('ascii');
      if (remaining === 0 || /<\/head\s*>/i.test(text)) break;
      tail = text.slice(-8);
    }
    return readLinkMetadata(Buffer.concat(chunks).toString('utf8'), url);
  }
}

async function buildPreview(url: URL) {
  const metadata = await fetchMetadata(url).catch(() => undefined);
  const github = url.hostname === 'github.com' || url.hostname === 'www.github.com';
  return {
    title: metadata?.title || (github ? 'GitHub' : url.hostname),
    icon: metadata?.icon || (github ? 'https://github.githubassets.com/favicons/favicon.svg' : ''),
  };
}

const previews = new Map<string, ReturnType<typeof buildPreview>>();

export function getNoteLinkPreview(value: string) {
  const url = webURL(value);
  if (!url) return;
  url.hash = '';
  if (!previews.has(url.href)) previews.set(url.href, buildPreview(url));
  return previews.get(url.href);
}
