// ==UserScript==
// @name         RipperStore Link Revealer
// @namespace    https://forum.ripper.store
// @version      1.3.1
// @description  Reveals guest-hidden links and uploaded media on RipperStore topics.
// @author       VRCUploader Team
// @match        https://forum.ripper.store/*
// @downloadURL  https://raw.githubusercontent.com/VRCUploader/ripper-store-links-revealer/main/ripper-reveal-links.user.js
// @updateURL    https://raw.githubusercontent.com/VRCUploader/ripper-store-links-revealer/main/ripper-reveal-links.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const API_POSTS = '/api/v3/posts';
  const HIDDEN_LINK = 'a.hide-to-guest';
  const LOCKED_MEDIA = 'a.login-required';
  const POST = '[data-pid], [component="post"]';
  const POST_CONTENT = '[component="post/content"]';
  const REVEALED = 'data-rs-revealed';

  const rawPostCache = new Map();
  let revealInProgress = false;
  let revealTimer;
  let toastTimer;
  let revealedTotals = { links: 0, media: 0, posts: 0 };

  function addStyles() {
    if (document.querySelector('#rs-reveal-styles')) return;

    const style = document.createElement('style');
    style.id = 'rs-reveal-styles';
    style.textContent = `
      .rs-revealed-link {
        color: #0d6efd !important;
        text-decoration: underline !important;
        overflow-wrap: anywhere;
      }

      .rs-revealed-image {
        display: block;
        max-width: 100%;
        height: auto;
        margin: .35rem 0;
        border-radius: 4px;
      }

      .rs-extra-links {
        margin: .35rem 0;
        padding: .4rem .55rem;
        border-left: 3px solid #198754;
        border-radius: 0 4px 4px 0;
        background: rgb(25 135 84 / 8%);
        font-size: .9em;
      }

      .rs-reveal-button {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 99999;
        padding: 8px 12px;
        border: 0;
        border-radius: 8px;
        background: #198754;
        box-shadow: 0 4px 14px rgb(0 0 0 / 25%);
        color: #fff;
        font: 600 13px/1.2 system-ui, sans-serif;
        cursor: pointer;
      }

      .rs-reveal-button:hover {
        filter: brightness(1.08);
      }

      .rs-reveal-button:disabled {
        opacity: .6;
        cursor: wait;
      }

      .rs-reveal-toast {
        position: fixed;
        right: 16px;
        bottom: 56px;
        z-index: 99999;
        max-width: 320px;
        padding: 8px 12px;
        border-radius: 8px;
        background: #212529;
        color: #fff;
        font: 12px/1.35 system-ui, sans-serif;
        opacity: 0;
        transition: opacity .2s;
        pointer-events: none;
      }

      .rs-reveal-toast.is-visible {
        opacity: .95;
      }
    `;
    document.head.append(style);
  }

  function showToast(message) {
    let toast = document.querySelector('.rs-reveal-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'rs-reveal-toast';
      document.body.append(toast);
    }

    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2800);
  }

  function createLink(url, text = url, title = 'Revealed hidden link') {
    const link = document.createElement('a');
    link.className = 'rs-revealed-link';
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = text;
    link.title = title;
    return link;
  }

  function toAbsoluteUrl(value) {
    if (!value || value === '/login') return null;

    try {
      const url = new URL(value, location.origin);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
    } catch {
      return null;
    }
  }

  function isImageUrl(url) {
    return /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)(?:\?.*)?$/i.test(url);
  }

  function findLockedUrl(lock) {
    const wrapper = lock.parentElement;
    if (wrapper?.tagName === 'A') {
      const url = toAbsoluteUrl(wrapper.getAttribute('href'));
      if (url) return url;
    }

    const nearbyUpload = lock
      .closest('p, div, span')
      ?.querySelector('a[href*="/assets/uploads/"]');

    return toAbsoluteUrl(
      lock.dataset.url ||
      lock.dataset.href ||
      nearbyUpload?.getAttribute('href')
    );
  }

  function revealLockedMedia() {
    let revealedCount = 0;

    for (const lock of document.querySelectorAll(LOCKED_MEDIA)) {
      const url = findLockedUrl(lock);
      if (!url) continue;

      const wrapper = lock.parentElement?.tagName === 'A'
        ? lock.parentElement
        : lock;

      if (isImageUrl(url)) {
        const image = document.createElement('img');
        image.className = 'rs-revealed-image img-fluid';
        image.src = url;
        image.alt = 'Revealed media';
        image.loading = 'lazy';
        image.title = 'Revealed from the public upload URL';

        const link = createLink(url, '', 'Open revealed media');
        link.append(image);
        wrapper.replaceWith(link);
      } else {
        wrapper.replaceWith(createLink(url, url, 'Revealed from the public upload URL'));
      }

      revealedCount++;
    }

    return revealedCount;
  }

  function getPostId(element) {
    return (
      element.getAttribute('data-pid') ||
      element.closest('[data-pid]')?.getAttribute('data-pid') ||
      element.querySelector('[data-pid]')?.getAttribute('data-pid')
    );
  }

  function getPostContent(post) {
    return post.querySelector(POST_CONTENT) || post.querySelector('.content') || post;
  }

  async function fetchRawPost(postId) {
    if (rawPostCache.has(postId)) return rawPostCache.get(postId);

    const request = fetch(`${API_POSTS}/${postId}`, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    }).then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const body = await response.json();
      if (body.status?.code && body.status.code !== 'ok') {
        throw new Error(body.status.message || body.status.code);
      }

      return body.response?.content ?? body.content ?? '';
    });

    rawPostCache.set(postId, request);

    try {
      return await request;
    } catch (error) {
      rawPostCache.delete(postId);
      throw error;
    }
  }

  function extractUrls(text) {
    const matches = text.match(/https?:\/\/[^\s\]>'")]+/g) || [];
    const normalized = matches.map((url) => url.replace(/[.,);]+$/, ''));
    return [...new Set(normalized)];
  }

  function visibleUrls(content) {
    return new Set(
      [...content.querySelectorAll('a[href]')]
        .filter((link) => !link.matches(HIDDEN_LINK) && link.getAttribute('href') !== '/login')
        .map((link) => toAbsoluteUrl(link.getAttribute('href')))
        .filter(Boolean)
    );
  }

  function hiddenUrls(rawContent, postContent) {
    const visible = visibleUrls(postContent);

    return extractUrls(rawContent).filter((url) => {
      const absoluteUrl = toAbsoluteUrl(url);
      if (!absoluteUrl) return false;
      if (absoluteUrl.startsWith(`${location.origin}/assets/`)) return false;
      return !visible.has(absoluteUrl);
    });
  }

  function replaceHiddenLinks(postContent, urls, postId) {
    const placeholders = [...postContent.querySelectorAll(HIDDEN_LINK)];
    const replacementCount = Math.min(placeholders.length, urls.length);
    const title = `Revealed via ${API_POSTS}/${postId}`;

    for (let index = 0; index < replacementCount; index++) {
      placeholders[index].replaceWith(createLink(urls[index], urls[index], title));
    }

    appendExtraLinks(postContent, urls.slice(replacementCount), title);
  }

  function appendExtraLinks(postContent, urls, title) {
    if (!urls.length || postContent.querySelector('.rs-extra-links')) return;

    const container = document.createElement('div');
    container.className = 'rs-extra-links';

    const heading = document.createElement('strong');
    heading.textContent = 'Revealed links';
    container.append(heading);

    for (const url of urls) {
      container.append(document.createElement('br'), createLink(url, url, title));
    }

    postContent.append(container);
  }

  function hiddenPosts() {
    const posts = new Map();

    for (const placeholder of document.querySelectorAll(HIDDEN_LINK)) {
      const post = placeholder.closest(POST);
      const postId = post && getPostId(post);
      if (postId && !post.hasAttribute(REVEALED)) posts.set(postId, post);
    }

    return posts;
  }

  async function revealGuestLinks() {
    let postCount = 0;
    let linkCount = 0;

    for (const [postId, post] of hiddenPosts()) {
      try {
        const rawContent = await fetchRawPost(postId);
        const postContent = getPostContent(post);
        const urls = hiddenUrls(rawContent, postContent);

        replaceHiddenLinks(postContent, urls, postId);
        post.setAttribute(REVEALED, '');
        if (urls.length) postCount++;
        linkCount += urls.length;
      } catch (error) {
        console.warn(`Could not reveal post ${postId}:`, error);
      }
    }

    return { postCount, linkCount };
  }

  function countLabel(count, singular, plural = `${singular}s`) {
    return `${count} ${count === 1 ? singular : plural}`;
  }

  function resultMessage(mediaCount, postCount, linkCount) {
    const parts = [];
    if (mediaCount) parts.push(countLabel(mediaCount, 'media item'));
    if (linkCount) {
      parts.push(
        `${countLabel(linkCount, 'link')} in ${countLabel(postCount, 'post')}`
      );
    }
    return `Revealed ${parts.join(', ')}`;
  }

  function updateButton(button) {
    const totalItems = revealedTotals.links + revealedTotals.media;
    if (!totalItems) {
      button.textContent = 'Reveal hidden content';
      button.title = 'Reveal links and media hidden from guests';
      return;
    }

    button.textContent = `${countLabel(totalItems, 'item')} revealed`;
    button.title = resultMessage(
      revealedTotals.media,
      revealedTotals.posts,
      revealedTotals.links
    );
  }

  async function revealAll({ notifyIfEmpty = true } = {}) {
    if (revealInProgress) return;
    revealInProgress = true;

    const button = document.querySelector('.rs-reveal-button');
    if (button) {
      button.disabled = true;
      button.textContent = 'Revealing...';
    }

    try {
      const mediaCount = revealLockedMedia();
      const { postCount, linkCount } = await revealGuestLinks();

      if (mediaCount || linkCount) {
        revealedTotals.media += mediaCount;
        revealedTotals.links += linkCount;
        revealedTotals.posts += postCount;
        showToast(resultMessage(mediaCount, postCount, linkCount));
      } else if (notifyIfEmpty && (revealedTotals.media || revealedTotals.links)) {
        showToast('Everything on this page is already revealed');
      } else if (notifyIfEmpty) {
        showToast('No hidden content found on this page');
      }
    } finally {
      revealInProgress = false;
      if (button) {
        button.disabled = false;
        updateButton(button);
      }
    }
  }

  function needsReveal() {
    return Boolean(
      document.querySelector(LOCKED_MEDIA) ||
      document.querySelector(HIDDEN_LINK)
    );
  }

  function scheduleReveal() {
    if (!needsReveal()) return;
    clearTimeout(revealTimer);
    revealTimer = setTimeout(() => {
      if (needsReveal()) revealAll({ notifyIfEmpty: false });
    }, 350);
  }

  function addRevealButton() {
    if (document.querySelector('.rs-reveal-button')) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'rs-reveal-button';
    button.addEventListener('click', () => revealAll());
    updateButton(button);
    document.body.append(button);
  }

  function handleNavigation() {
    rawPostCache.clear();
    revealedTotals = { links: 0, media: 0, posts: 0 };
    addRevealButton();
    const button = document.querySelector('.rs-reveal-button');
    if (button) updateButton(button);
    scheduleReveal();
  }

  function watchPage() {
    new MutationObserver(scheduleReveal).observe(document.body, {
      childList: true,
      subtree: true,
    });

    if (window.jQuery) {
      window.jQuery(window).on('action:ajaxify.end', handleNavigation);
    }
    window.addEventListener('popstate', handleNavigation);
  }

  function start() {
    addStyles();
    addRevealButton();
    watchPage();
    scheduleReveal();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
