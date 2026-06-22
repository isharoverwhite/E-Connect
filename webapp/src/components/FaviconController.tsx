/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

'use client';

import { useEffect } from 'react';

// Track the link element we inject so we only ever remove our own node,
// never the React-managed favicon links (removing those breaks React's
// reconciler with "Cannot read properties of null (reading 'removeChild')").
let injectedLink: HTMLLinkElement | null = null;

function setFavicon(href: string) {
  if (injectedLink) {
    injectedLink.remove();
    injectedLink = null;
  }
  const link = document.createElement('link');
  link.rel = 'icon';
  link.href = href;
  if (href.endsWith('.gif')) link.type = 'image/gif';
  else if (href.endsWith('.svg')) link.type = 'image/svg+xml';
  document.head.appendChild(link);
  injectedLink = link;
}

export function FaviconController() {
  useEffect(() => {
    const onVisibilityChange = () => {
      setFavicon(
        document.visibilityState === 'hidden' ? '/logo-spin.gif' : '/icon.svg'
      );
    };

    onVisibilityChange();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  return null;
}
