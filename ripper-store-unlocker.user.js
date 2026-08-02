// ==UserScript==
// @name         RipperStore Unlocker
// @namespace    https://forum.ripper.store
// @version      2.5.0
// @description  Unlocks guest-hidden content and provides private local topic search.
// @author       VRCUploader Team
// @match        https://forum.ripper.store/*
// @downloadURL  https://raw.githubusercontent.com/VRCUploader/RipperStore-Unlocker/main/ripper-store-unlocker.user.js
// @updateURL    https://raw.githubusercontent.com/VRCUploader/RipperStore-Unlocker/main/ripper-store-unlocker.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const API_POSTS = '/api/v3/posts';
  const API_TOPICS = '/api/v3/topics';
  const HIDDEN_LINK = 'a.hide-to-guest';
  const LOCKED_MEDIA = 'a.login-required';
  const POST = '[data-pid], [component="post"]';
  const POST_CONTENT = '[component="post/content"]';
  const REVEALED = 'data-rs-revealed';

  const DATABASE_NAME = 'ripper-store-local-search';
  const DATABASE_VERSION = 2;
  const TOPICS_STORE = 'topics';
  const META_STORE = 'meta';

  const QUICK_UPDATE_INTERVAL = 6 * 60 * 60 * 1000;
  const FULL_UPDATE_INTERVAL = 7 * 24 * 60 * 60 * 1000;
  const STATS_REFRESH_INTERVAL = 24 * 60 * 60 * 1000;
  const RECENT_SITEMAP_COUNT = 8;
  const RECENT_FEED_PAGES = 10;
  const FEED_PAGE_SIZE = 20;
  const EXTRA_FEED_CATEGORIES = [{ id: 44, name: 'Gifts/Downloads' }];
  const CATEGORY_FEED_PAGES = 2;
  const FETCH_CONCURRENCY = 4;
  const FETCH_TIMEOUT = 20_000;
  const FETCH_ATTEMPTS = 3;
  const RESULT_PAGE_SIZE = 50;

  // longest first, so the largest unit that fits is the one reported
  const TIME_UNITS = [
    ['year', 365 * 24 * 60 * 60],
    ['month', 30 * 24 * 60 * 60],
    ['day', 24 * 60 * 60],
    ['hour', 60 * 60],
    ['minute', 60],
  ];

  const rawPostCache = new Map();
  let revealInProgress = false;
  let revealTimer;
  let toastTimer;
  let revealedTotals = { links: 0, media: 0, posts: 0 };

  const searchState = {
    database: null,
    topics: null,
    updating: false,
    updateTimer: null,
    sortMode: 'relevance',
    sortDirection: 'descending',
    allResults: [],
    resultScores: new Map(),
    displayLimit: RESULT_PAGE_SIZE,
    indexStatus: '',
    newestTopicsRun: null,
  };

  function el(tag, properties = {}, ...children) {
    const node = Object.assign(document.createElement(tag), properties);
    node.append(...children);
    return node;
  }

  function addStyles() {
    if (document.querySelector('#rs-reveal-styles')) return;

    document.head.append(el('style', {
      id: 'rs-reveal-styles',
      textContent: `
        .rs-toolbox {
          position: fixed;
          right: 16px;
          bottom: 16px;
          z-index: 99999;
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 8px;
        }
        .rs-toolbox-button {
          padding: 8px 12px;
          border: 0;
          border-radius: 8px;
          box-shadow: 0 4px 14px rgb(0 0 0 / 25%);
          color: #fff;
          font: 600 13px/1.2 system-ui, sans-serif;
          cursor: pointer;
        }
        .rs-toolbox-button:hover { filter: brightness(1.08); }
        .rs-toolbox-button:disabled { opacity: .6; cursor: wait; }
        .rs-reveal-button { background: #198754; }
        .rs-search-open { background: #0d6efd; }

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

        .rs-reveal-toast {
          position: absolute;
          right: 0;
          bottom: calc(100% + 8px);
          max-width: 320px;
          width: max-content;
          padding: 8px 12px;
          border-radius: 8px;
          background: #212529;
          color: #fff;
          font: 12px/1.35 system-ui, sans-serif;
          opacity: 0;
          transition: opacity .2s;
          pointer-events: none;
        }
        .rs-reveal-toast.is-visible { opacity: .95; }

        .rs-search-dialog {
          position: fixed;
          inset: 0;
          z-index: 100000;
          display: none;
          align-items: flex-start;
          justify-content: center;
          padding: 8vh 16px 16px;
          background: rgb(0 0 0 / 55%);
        }
        .rs-search-dialog.is-open { display: flex; }
        .rs-search-panel {
          display: flex;
          flex-direction: column;
          width: min(720px, 100%);
          max-height: 84vh;
          overflow: hidden;
          border-radius: 10px;
          background: var(--bs-body-bg, #fff);
          box-shadow: 0 12px 40px rgb(0 0 0 / 35%);
          color: var(--bs-body-color, #212529);
        }
        .rs-search-panel header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 16px 8px;
        }
        .rs-search-panel h2 { margin: 0; font-size: 1.2rem; }

        .rs-search-close,
        .rs-search-actions button { border: 0; background: transparent; cursor: pointer; }
        .rs-search-close { color: inherit; font-size: 1.7rem; }
        .rs-search-actions { display: flex; gap: 10px; flex: none; }
        .rs-search-actions button { color: #0d6efd; }

        .rs-search-input,
        .rs-search-sort select,
        .rs-search-load-more {
          border: 1px solid #adb5bd;
          background: var(--bs-body-bg, #fff);
          color: inherit;
        }
        .rs-search-input {
          display: block;
          width: calc(100% - 32px);
          margin: 4px 16px 10px;
          padding: 10px 12px;
          border-radius: 6px;
        }
        .rs-search-sort { display: inline-flex; align-items: center; gap: 6px; }
        .rs-search-sort select { padding: 2px 6px; border-radius: 4px; font: inherit; }

        .rs-search-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
          padding: 0 16px 10px;
          font-size: .8rem;
          font-variant-numeric: tabular-nums;
        }
        /* the status owns the leftover width so a growing message cannot reflow the controls */
        .rs-search-update-status {
          flex: 1 1 auto;
          min-width: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .rs-search-toolbar-controls { display: flex; align-items: center; gap: 12px; flex: none; }
        .rs-search-toolbar,
        .rs-search-result-meta,
        .rs-search-empty { color: var(--bs-secondary-color, #6c757d); }

        .rs-search-results {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          border-top: 1px solid rgb(128 128 128 / 25%);
        }
        .rs-search-result {
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: 10px 16px;
          border-bottom: 1px solid rgb(128 128 128 / 18%);
          color: inherit;
          text-decoration: none;
        }
        .rs-search-result:hover,
        .rs-search-load-more:hover { background: rgb(13 110 253 / 8%); }
        .rs-search-result-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 8px 14px;
          font-size: .78rem;
        }
        .rs-search-empty { margin: 0; padding: 24px 16px; text-align: center; }
        .rs-search-load-more {
          display: block;
          width: 100%;
          margin-top: 8px;
          padding: 10px 12px;
          border-radius: 6px;
          font: inherit;
          cursor: pointer;
        }
        .rs-search-results-summary {
          padding: 10px 16px 16px;
          border-top: 1px solid rgb(128 128 128 / 18%);
        }
      `,
    }));
  }

  function ensureToolbox() {
    let toolbox = document.querySelector('.rs-toolbox');
    if (!toolbox) {
      toolbox = el('div', { className: 'rs-toolbox' });
      document.body.append(toolbox);
    }
    return toolbox;
  }

  function showToast(message) {
    let toast = document.querySelector('.rs-reveal-toast');
    if (!toast) {
      toast = el('div', { className: 'rs-reveal-toast' });
      ensureToolbox().append(toast);
    }

    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2800);
  }

  function createLink(url, text = url, title = 'Revealed hidden link') {
    return el('a', {
      className: 'rs-revealed-link',
      href: url,
      target: '_blank',
      rel: 'noopener noreferrer',
      textContent: text,
      title,
    });
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

      const wrapper = lock.parentElement?.tagName === 'A' ? lock.parentElement : lock;
      const title = 'Revealed from the public upload URL';

      if (isImageUrl(url)) {
        const image = el('img', {
          className: 'rs-revealed-image img-fluid',
          src: url,
          alt: 'Revealed media',
          loading: 'lazy',
          title,
        });
        const link = createLink(url, '', 'Open revealed media');
        link.append(image);
        wrapper.replaceWith(link);
      } else {
        wrapper.replaceWith(createLink(url, url, title));
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

  async function fetchJson(url) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const body = await response.json();
    // NodeBB answers with HTTP 200 and an error envelope, so the status has to be checked too
    if (body.status?.code && body.status.code !== 'ok') {
      throw new Error(body.status.message || body.status.code);
    }

    return body;
  }

  async function fetchRawPost(postId) {
    if (rawPostCache.has(postId)) return rawPostCache.get(postId);

    const request = fetchJson(`${API_POSTS}/${postId}`)
      .then((body) => body.response?.content ?? body.content ?? '');
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
      // forum-hosted attachments are already rendered, so listing them again is noise
      if (absoluteUrl.startsWith(`${location.origin}/assets/`)) return false;
      return !visible.has(absoluteUrl);
    });
  }

  function appendExtraLinks(postContent, urls, title) {
    if (!urls.length || postContent.querySelector('.rs-extra-links')) return;

    const container = el(
      'div',
      { className: 'rs-extra-links' },
      el('strong', { textContent: 'Revealed links' })
    );

    for (const url of urls) {
      container.append(el('br'), createLink(url, url, title));
    }

    postContent.append(container);
  }

  function replaceHiddenLinks(postContent, urls, postId) {
    const placeholders = [...postContent.querySelectorAll(HIDDEN_LINK)];
    const replacementCount = Math.min(placeholders.length, urls.length);
    const title = `Revealed via ${API_POSTS}/${postId}`;

    for (let index = 0; index < replacementCount; index++) {
      placeholders[index].replaceWith(createLink(urls[index], urls[index], title));
    }

    // the raw post can hold more links than it has placeholders, so nothing is dropped
    appendExtraLinks(postContent, urls.slice(replacementCount), title);
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
      parts.push(`${countLabel(linkCount, 'link')} in ${countLabel(postCount, 'post')}`);
    }
    return `Unlocked ${parts.join(', ')}`;
  }

  function updateRevealButton(button) {
    const totalItems = revealedTotals.links + revealedTotals.media;
    if (!totalItems) {
      button.textContent = 'Unlock hidden content';
      button.title = 'Unlock links and media hidden from guests';
      return;
    }

    button.textContent = `${countLabel(totalItems, 'item')} unlocked`;
    button.title = resultMessage(revealedTotals.media, revealedTotals.posts, revealedTotals.links);
  }

  async function revealAll({ notifyIfEmpty = true } = {}) {
    if (revealInProgress) return;
    revealInProgress = true;

    const button = document.querySelector('.rs-reveal-button');
    if (button) {
      button.disabled = true;
      button.textContent = 'Unlocking...';
    }

    try {
      const mediaCount = revealLockedMedia();
      const { postCount, linkCount } = await revealGuestLinks();

      if (mediaCount || linkCount) {
        revealedTotals.media += mediaCount;
        revealedTotals.links += linkCount;
        revealedTotals.posts += postCount;
        showToast(resultMessage(mediaCount, postCount, linkCount));
      } else if (notifyIfEmpty) {
        showToast(revealedTotals.media || revealedTotals.links
          ? 'Everything on this page is already unlocked'
          : 'No hidden content found on this page');
      }
    } finally {
      revealInProgress = false;
      if (button) {
        button.disabled = false;
        updateRevealButton(button);
      }
    }
  }

  function needsReveal() {
    return Boolean(document.querySelector(LOCKED_MEDIA) || document.querySelector(HIDDEN_LINK));
  }

  function scheduleReveal() {
    if (!needsReveal()) return;
    clearTimeout(revealTimer);
    // debounced because NodeBB rewrites the post list in several bursts per navigation
    revealTimer = setTimeout(() => {
      if (needsReveal()) revealAll({ notifyIfEmpty: false });
    }, 350);
  }

  function addRevealButton() {
    let button = document.querySelector('.rs-reveal-button');
    if (!button) {
      button = el('button', {
        type: 'button',
        className: 'rs-toolbox-button rs-reveal-button',
      });
      button.addEventListener('click', () => revealAll());
      ensureToolbox().append(button);
    }
    updateRevealButton(button);
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  async function openDatabase() {
    if (searchState.database) return searchState.database;

    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = (event) => {
      const database = request.result;

      for (const [name, keyPath] of [[TOPICS_STORE, 'id'], [META_STORE, 'key']]) {
        if (!database.objectStoreNames.contains(name)) {
          database.createObjectStore(name, { keyPath });
        } else if (event.oldVersion < 2) {
          // v1 records predate the normalized title fields, so rebuild instead of migrating
          request.transaction.objectStore(name).clear();
        }
      }
    };

    searchState.database = await requestResult(request);
    return searchState.database;
  }

  async function readStore(storeName, read) {
    const database = await openDatabase();
    const transaction = database.transaction(storeName, 'readonly');
    return requestResult(read(transaction.objectStore(storeName)));
  }

  async function writeStore(storeName, write) {
    const database = await openDatabase();
    const transaction = database.transaction(storeName, 'readwrite');
    write(transaction.objectStore(storeName));
    await transactionDone(transaction);
  }

  async function readMeta(key) {
    const record = await readStore(META_STORE, (store) => store.get(key));
    return record?.value;
  }

  function writeMeta(entries) {
    return writeStore(META_STORE, (store) => {
      for (const [key, value] of Object.entries(entries)) store.put({ key, value });
    });
  }

  function topicCount() {
    return readStore(TOPICS_STORE, (store) => store.count());
  }

  function readAllTopics() {
    return readStore(TOPICS_STORE, (store) => store.getAll());
  }

  function mergeTopicRecord(existing, topic) {
    if (!existing) return topic;

    const merged = { ...existing };
    for (const [key, value] of Object.entries(topic)) {
      if (value != null) merged[key] = value;
    }

    // sitemap records only carry a slug-derived title, so they must not overwrite an API title
    if (existing.statsFetchedAt != null && topic.statsFetchedAt == null) {
      merged.title = existing.title;
      merged.normalizedTitle = existing.normalizedTitle;
    }

    return merged;
  }

  async function saveTopics(topics, replaceExisting) {
    await writeStore(TOPICS_STORE, (store) => {
      if (replaceExisting) {
        store.clear();
        for (const topic of topics) store.put(topic);
        return;
      }

      // merging inside the transaction keeps parallel batches from clobbering each other
      for (const topic of topics) {
        const request = store.get(topic.id);
        request.onsuccess = () => store.put(mergeTopicRecord(request.result, topic));
      }
    });

    if (searchState.topics) {
      const byId = new Map(searchState.topics.map((topic) => [topic.id, topic]));
      for (const topic of topics) {
        byId.set(topic.id, mergeTopicRecord(byId.get(topic.id), topic));
      }
      searchState.topics = [...byId.values()];
    }
  }

  // keeps a bulk index from firing hundreds of parallel requests at the forum
  async function inBatches(items, handleGroup) {
    for (let offset = 0; offset < items.length; offset += FETCH_CONCURRENCY) {
      await handleGroup(items.slice(offset, offset + FETCH_CONCURRENCY), offset);
    }
  }

  // one failed item must not discard the whole group, so failures resolve to null
  function settleGroup(items, run, describe) {
    return Promise.all(items.map(async (item) => {
      try {
        return await run(item);
      } catch (error) {
        console.warn(describe(item), error);
        return null;
      }
    }));
  }

  function needsStats(topic) {
    if (topic.votes == null || topic.views == null || topic.posts == null) return true;
    if (topic.lastposttime == null || !topic.statsFetchedAt) return true;
    return Date.now() - topic.statsFetchedAt >= STATS_REFRESH_INTERVAL;
  }

  async function fetchTopicStats(topic) {
    const body = await fetchJson(`${API_TOPICS}/${topic.id}`);
    const data = body.response ?? body;
    const title = String(data.title || topic.title || '');
    const slugPart = String(data.slug || topic.url?.split('/topic/')[1] || '').replace(/^\d+\//, '');
    const slugTitle = topic.slugTitle || readableTitle(slugPart || `topic-${topic.id}`);

    return {
      id: topic.id,
      title,
      normalizedTitle: normalizeText(title),
      slugTitle,
      normalizedSlugTitle: topic.normalizedSlugTitle || normalizeText(slugTitle),
      votes: Number(data.votes ?? data.upvotes ?? 0),
      views: Number(data.viewcount ?? 0),
      posts: Number(data.postcount ?? 0),
      lastposttime: Number(data.lastposttime ?? data.timestamp ?? 0),
      timestamp: Number(data.timestamp ?? 0),
      statsFetchedAt: Date.now(),
    };
  }

  async function enrichTopicStats(topics, isWanted = () => true) {
    const pending = topics.filter(needsStats);

    await inBatches(pending, async (group) => {
      // a search abandoned mid-flight would otherwise keep fetching stats nobody will see
      if (!isWanted()) return;

      const updates = await settleGroup(
        group,
        fetchTopicStats,
        (topic) => `Could not load stats for topic ${topic.id}:`
      );

      const saved = updates.filter(Boolean);
      if (!saved.length) return;

      await saveTopics(saved, false);
      for (const update of saved) {
        const topic = topics.find((entry) => entry.id === update.id);
        if (topic) Object.assign(topic, update);
      }
    });

    return topics;
  }

  function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  async function fetchXml(url) {
    let lastError;

    for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

      try {
        const response = await fetch(url, {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { Accept: 'application/xml, text/xml' },
          signal: controller.signal,
        });

        if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);

        const text = await response.text();
        const parsed = new DOMParser().parseFromString(text, 'application/xml');
        if (parsed.querySelector('parsererror')) {
          throw new Error(`${url} returned invalid XML`);
        }

        return parsed;
      } catch (error) {
        lastError = error;
        if (attempt < FETCH_ATTEMPTS) await wait(attempt * 1000);
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError;
  }

  function sitemapLocations(sitemap) {
    return [...sitemap.querySelectorAll('sitemap > loc, url > loc')]
      .map((node) => node.textContent.trim())
      .filter(Boolean);
  }

  function sitemapNumber(url) {
    return Number(url.match(/topics\.(\d+)\.xml$/)?.[1] || 0);
  }

  function readableTitle(slug) {
    let decoded = slug;
    try {
      decoded = decodeURIComponent(slug);
    } catch {
      // keep the encoded slug when it contains invalid escape sequences
    }

    return decoded.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function normalizeText(value) {
    return value
      .normalize('NFKD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase()
      .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
      .trim();
  }

  // the sitemap and the JSON feeds describe the same topics, only their extras differ
  function topicRecord(id, slugPart, rawTitle, origin = location.origin) {
    const slugTitle = readableTitle(slugPart);
    const title = String(rawTitle || slugTitle);

    return {
      id,
      title,
      normalizedTitle: normalizeText(title),
      slugTitle,
      normalizedSlugTitle: normalizeText(slugTitle),
      url: `${origin}/topic/${id}/${slugPart}`,
    };
  }

  function topicFromApiEntry(entry) {
    const id = Number(entry.tid ?? entry.id);
    const slugPart = String(entry.slug || '').replace(/^\d+\//, '') || `topic-${id}`;

    return {
      ...topicRecord(id, slugPart, entry.title),
      lastposttime: Number(entry.lastposttime ?? 0),
      timestamp: Number(entry.timestamp ?? 0),
      votes: Number(entry.upvotes ?? entry.votes ?? 0),
      views: Number(entry.viewcount ?? 0),
      posts: Number(entry.postcount ?? 0),
      statsFetchedAt: Date.now(),
    };
  }

  // walks a listing endpoint one request at a time, keeping whatever arrived before a bad page
  async function fetchFeedTopics(urls, { isLastPage = () => false, onPage = () => {} } = {}) {
    const topics = [];

    for (const url of urls) {
      let body;
      try {
        body = await fetchJson(url);
      } catch (error) {
        console.warn(`Could not read feed page ${url}:`, error);
        break;
      }

      const entries = body.topics || [];
      topics.push(...entries.map(topicFromApiEntry));
      onPage(entries.length);
      if (!entries.length || isLastPage(body, entries)) break;
    }

    return topics;
  }

  function pageUrls(count, buildUrl) {
    return Array.from({ length: count }, (unused, index) => buildUrl(index));
  }

  // opening the dialog starts a silent refresh, so an explicit update waits for that to land
  // instead of being dropped by the guard and never running at all
  async function indexNewestTopics({ queueIfBusy = false, ...options } = {}) {
    while (searchState.newestTopicsRun) {
      if (!queueIfBusy) return 0;
      await searchState.newestTopicsRun;
    }

    searchState.newestTopicsRun = fetchNewestTopics(options);
    try {
      return await searchState.newestTopicsRun;
    } finally {
      searchState.newestTopicsRun = null;
    }
  }

  // topics posted since the last sitemap build appear in no partition, so the live feeds catch them
  async function fetchNewestTopics({ rerunSearch = false, showProgress = false } = {}) {
    // the recent feed walks a row offset and the category feed walks page numbers, so each
    // side reports what it actually has
    const recentLimit = RECENT_FEED_PAGES * FEED_PAGE_SIZE;
    const categoryPageCount = EXTRA_FEED_CATEGORIES.length * CATEGORY_FEED_PAGES;
    const categoryLabel = EXTRA_FEED_CATEGORIES.map((category) => category.name).join(', ');
    let recentSeen = 0;
    let categoryPages = 0;
    const showFeedProgress = () => {
      if (showProgress) {
        setUpdateStatus(
          `Refreshing newest topics · recent ${recentSeen}/${recentLimit}` +
          ` · ${categoryLabel} page ${categoryPages}/${categoryPageCount}`
        );
      }
    };
    const countRecentTopics = (entryCount) => {
      recentSeen += entryCount;
      showFeedProgress();
    };
    const countCategoryPage = () => {
      categoryPages++;
      showFeedProgress();
    };

    showFeedProgress();

    try {
      const batches = await Promise.all([
        fetchFeedTopics(
          pageUrls(RECENT_FEED_PAGES, (index) => `/api/recent?start=${index * FEED_PAGE_SIZE}`),
          {
            isLastPage: (body, entries) => !body.nextStart || entries.length < FEED_PAGE_SIZE,
            onPage: countRecentTopics,
          }
        ),
        ...EXTRA_FEED_CATEGORIES.map(({ id }) => fetchFeedTopics(
          pageUrls(
            CATEGORY_FEED_PAGES,
            (index) => `/api/category/${id}/topics?page=${index + 1}`
          ),
          { onPage: countCategoryPage }
        )),
      ]);

      const topics = batches.flat();
      if (topics.length) await saveTopics(topics, false);
      if (rerunSearch && topics.length) runSearch();

      return topics.length;
    } catch (error) {
      console.warn('Newest topic refresh failed:', error);
      return 0;
    }
  }

  function parseTopicSitemap(sitemap) {
    const topics = [];

    for (const urlNode of sitemap.querySelectorAll('url')) {
      const sitemapUrl = urlNode.querySelector('loc')?.textContent.trim();
      if (!sitemapUrl) continue;

      let url;
      try {
        url = new URL(sitemapUrl);
      } catch {
        continue;
      }

      const match = url.pathname.match(/^\/topic\/(\d+)(?:\/(.*))?$/);
      if (!match) continue;

      const id = Number(match[1]);

      topics.push({
        ...topicRecord(id, match[2] || `topic-${id}`, '', url.origin),
        lastModified: urlNode.querySelector('lastmod')?.textContent.trim() || '',
      });
    }

    return topics;
  }

  function setUpdateStatus(message) {
    const status = document.querySelector('.rs-search-update-status');
    if (!status) return;

    status.textContent = message;
    // the toolbar clips overflow to stay on one row, so keep the untruncated text reachable
    status.title = message;
  }

  function setIndexButtonsDisabled(disabled) {
    for (const selector of ['.rs-search-update', '.rs-search-rebuild']) {
      const button = document.querySelector(selector);
      if (button) button.disabled = disabled;
    }
  }

  function formatResultsStatus() {
    const query = document.querySelector('.rs-search-input')?.value.trim();
    if (!query) return '';

    const total = searchState.allResults.length;
    const showing = getDisplayedResults().length;

    if (!total) return 'No results';
    if (total > showing) return `Showing ${formatCount(showing)} of ${formatCount(total)} results`;
    return total === 1 ? 'Showing 1 result' : `Showing all ${formatCount(total)} results`;
  }

  function updateToolbarStatus() {
    if (searchState.updating) return;

    const parts = [searchState.indexStatus, formatResultsStatus()].filter(Boolean);
    setUpdateStatus(parts.join(' · '));
  }

  function setIndexStatus(message) {
    searchState.indexStatus = message;
    updateToolbarStatus();
  }

  async function loadSitemapList() {
    const sitemap = await fetchXml('/sitemap.xml');
    return sitemapLocations(sitemap)
      .filter((url) => /\/sitemap\/topics\.\d+\.xml$/.test(url))
      .sort((a, b) => sitemapNumber(a) - sitemapNumber(b));
  }

  async function processSitemaps(sitemaps, { completed, total = sitemaps.length, savedCount = 0 } = {}) {
    await inBatches(sitemaps, async (group, offset) => {
      const reached = Math.min((completed?.size || offset) + group.length, total);
      // one fixed-shape write per round trip: anything finer is replaced before it paints
      setUpdateStatus(`Indexing sitemap ${reached} of ${total} · ${formatCount(savedCount)} topics`);

      const batches = await settleGroup(
        group,
        async (url) => parseTopicSitemap(await fetchXml(url)),
        (url) => `Could not index sitemap ${url}:`
      );

      const topics = batches.filter(Boolean).flat();
      if (topics.length) {
        await saveTopics(topics, false);
        savedCount += topics.length;
      }

      // recording progress per batch lets an interrupted full build resume where it stopped
      if (completed) {
        for (const url of group) completed.add(sitemapNumber(url));
        await writeMeta({
          completedFullSitemaps: [...completed].sort((a, b) => a - b),
        });
      }
    });
  }

  async function updateIndex({ forceFull = false, forceQuick = false } = {}) {
    if (searchState.updating) return;
    searchState.updating = true;
    setIndexButtonsDisabled(true);

    let succeeded = false;
    const startedAt = Date.now();

    try {
      const [
        lastQuickUpdate = 0, lastFullUpdate = 0, currentCount,
        savedSitemapCount = 0, savedCompletedSitemaps = [], fullBuildInProgress = false,
      ] = await Promise.all([
        readMeta('lastQuickUpdate'), readMeta('lastFullUpdate'), topicCount(),
        readMeta('fullBuildSitemapCount'), readMeta('completedFullSitemaps'),
        readMeta('fullBuildInProgress'),
      ]);

      const fullUpdateDue =
        forceFull ||
        currentCount === 0 ||
        (!forceQuick && startedAt - lastFullUpdate >= FULL_UPDATE_INTERVAL);
      const quickUpdateDue =
        forceQuick || fullUpdateDue || startedAt - lastQuickUpdate >= QUICK_UPDATE_INTERVAL;

      if (!quickUpdateDue) {
        succeeded = true;
        return;
      }

      setUpdateStatus('Loading sitemap list...');
      const allSitemaps = await loadSitemapList();

      if (fullUpdateDue) {
        const completedSitemaps = new Set(savedCompletedSitemaps);
        // saved progress only lines up while the sitemap layout is unchanged
        const shouldRestart =
          forceFull ||
          !fullBuildInProgress ||
          savedSitemapCount !== allSitemaps.length ||
          (currentCount === 0 && completedSitemaps.size > 0);

        if (shouldRestart) {
          await saveTopics([], true);
          completedSitemaps.clear();
          await writeMeta({
            fullBuildSitemapCount: allSitemaps.length,
            completedFullSitemaps: [],
            fullBuildInProgress: true,
          });
        }

        const pendingSitemaps = allSitemaps.filter(
          (url) => !completedSitemaps.has(sitemapNumber(url))
        );

        // a resumed build carries on from the counts it was interrupted at
        await processSitemaps(pendingSitemaps, {
          completed: completedSitemaps,
          total: allSitemaps.length,
          savedCount: shouldRestart ? 0 : currentCount,
        });
        await writeMeta({
          lastFullUpdate: startedAt,
          lastQuickUpdate: startedAt,
          sitemapCount: allSitemaps.length,
          fullBuildInProgress: false,
        });
      } else {
        const recentSitemaps = allSitemaps.slice(-RECENT_SITEMAP_COUNT);
        await processSitemaps(recentSitemaps, { savedCount: currentCount });
        await writeMeta({ lastQuickUpdate: startedAt, sitemapCount: allSitemaps.length });
      }

      await indexNewestTopics({ showProgress: true, queueIfBusy: true });

      succeeded = true;
      runSearch();
    } catch (error) {
      console.error('RipperStore index update failed:', error);
      const savedTopics = await topicCount();
      setUpdateStatus(`Update paused at ${formatCount(savedTopics)} topics: ${error.message}`);
    } finally {
      searchState.updating = false;
      setIndexButtonsDisabled(false);
      if (succeeded) await refreshIndexStatus();
    }
  }

  async function loadTopicCache() {
    if (!searchState.topics) searchState.topics = await readAllTopics();
    return searchState.topics;
  }

  function getSearchableText(topic) {
    const titles = [topic.normalizedTitle, topic.normalizedSlugTitle].filter(Boolean);
    return [...new Set(titles)].join(' ');
  }

  function searchScore(topic, normalizedQuery, tokens) {
    const searchable = getSearchableText(topic);
    if (String(topic.id) === normalizedQuery) return 1000;
    if (searchable === normalizedQuery) return 900;
    if (searchable.startsWith(normalizedQuery)) return 700;

    const words = searchable.split(' ');
    if (!tokens.every((token) => words.includes(token))) return -1;

    // titles that match early are usually about the query rather than mentioning it in passing
    return 500 - Math.min(...tokens.map((token) => words.indexOf(token)));
  }

  function getSortMode() {
    const selected = document.querySelector('.rs-search-sort-select')?.value;
    return selected || searchState.sortMode || 'relevance';
  }

  function getSortDirection() {
    const selected = document.querySelector('.rs-search-order-select')?.value;
    return selected || searchState.sortDirection || 'descending';
  }

  // null rather than a sentinel number, so a real value of zero stays distinguishable
  function getPostedValue(topic) {
    if (topic.timestamp) return topic.timestamp;

    const parsed = Date.parse(topic.lastModified || '');
    return Number.isNaN(parsed) ? null : parsed;
  }

  function getLastPostValue(topic) {
    return topic.lastposttime || null;
  }

  function getSortValue(topic, mode) {
    if (mode === 'created') return getPostedValue(topic);

    // sitemap-only topics have no reply time, so fall back to when they were posted
    if (mode === 'lastposttime') return getLastPostValue(topic) ?? getPostedValue(topic);

    return topic[mode] ?? null;
  }

  function sortTopics(topics, scores, mode = getSortMode(), direction = getSortDirection()) {
    const order = direction === 'ascending' ? -1 : 1;

    return [...topics].sort((left, right) => {
      if (mode !== 'relevance') {
        const leftValue = getSortValue(left, mode);
        const rightValue = getSortValue(right, mode);
        const leftMissing = leftValue === null;
        const rightMissing = rightValue === null;

        // topics with no value stay at the bottom whichever way the sort runs
        if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
        if (!leftMissing && leftValue !== rightValue) return order * (rightValue - leftValue);
      }

      return order * ((scores.get(right.id) || 0) - (scores.get(left.id) || 0) || right.id - left.id);
    });
  }

  async function searchTopics(query) {
    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) return { topics: [], scores: new Map() };

    const tokens = normalizedQuery.split(' ');
    const scores = new Map();
    const matches = (await loadTopicCache()).filter((topic) => {
      const score = searchScore(topic, normalizedQuery, tokens);
      if (score < 0) return false;
      scores.set(topic.id, score);
      return true;
    });

    return { topics: sortTopics(matches, scores), scores };
  }

  function getDisplayedResults() {
    return searchState.allResults.slice(0, searchState.displayLimit);
  }

  function formatCount(value) {
    return Number(value || 0).toLocaleString();
  }

  function formatTimeAgo(timestampMs) {
    const seconds = Math.floor((Date.now() - timestampMs) / 1000);

    for (const [unit, unitSeconds] of TIME_UNITS) {
      const value = Math.floor(seconds / unitSeconds);
      if (value >= 1) return `${countLabel(value, unit)} ago`;
    }

    return 'just now';
  }

  function formatPostedAt(timestampMs) {
    return new Date(timestampMs).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  function topicDetailsText(topic) {
    const parts = [`Topic ${topic.id}`];

    const postedMs = getPostedValue(topic);
    if (postedMs > 0) {
      parts.push(`created ${formatTimeAgo(postedMs)} on ${formatPostedAt(postedMs)}`);
    }

    const lastPostMs = getLastPostValue(topic);
    if (lastPostMs > 0 && lastPostMs !== postedMs) {
      parts.push(`last reply ${formatTimeAgo(lastPostMs)} on ${formatPostedAt(lastPostMs)}`);
    }

    for (const stat of ['votes', 'views', 'posts']) {
      if (topic[stat] != null) parts.push(`${formatCount(topic[stat])} ${stat}`);
    }

    return parts;
  }

  function appendResultsSummary(results, shownCount) {
    const total = searchState.allResults.length;
    if (total <= shownCount) return;

    const loadMore = el('button', {
      type: 'button',
      className: 'rs-search-load-more',
      textContent: `Load ${formatCount(Math.min(RESULT_PAGE_SIZE, total - shownCount))} more`,
    });
    loadMore.addEventListener('click', loadMoreResults);

    results.append(el('div', { className: 'rs-search-results-summary' }, loadMore));
  }

  function renderResults(topics, query) {
    const results = document.querySelector('.rs-search-results');
    if (!results) return;
    results.replaceChildren();

    if (!query.trim() || !topics.length) {
      const text = query.trim() ? 'No matching topics found.' : 'Search public topic titles.';
      results.append(el('p', { className: 'rs-search-empty', textContent: text }));
    } else {
      for (const topic of topics) {
        const link = el(
          'a',
          { className: 'rs-search-result', href: topic.url },
          el('strong', { textContent: topic.title }),
          el(
            'span',
            { className: 'rs-search-result-meta' },
            ...topicDetailsText(topic).map((part) => el('span', { textContent: part }))
          )
        );
        link.dataset.topicId = String(topic.id);
        results.append(link);
      }

      appendResultsSummary(results, topics.length);
    }

    updateToolbarStatus();
  }

  async function enrichAndRenderResults(query) {
    const mode = getSortMode();
    // sorting by a stat needs every candidate's numbers, relevance only needs what is on screen
    const toEnrich = mode === 'relevance' ? getDisplayedResults() : searchState.allResults;
    const isCurrentQuery = () => document.querySelector('.rs-search-input')?.value === query;
    await enrichTopicStats(toEnrich, isCurrentQuery);

    if (!isCurrentQuery()) return;

    if (mode !== 'relevance') {
      searchState.allResults = sortTopics(searchState.allResults, searchState.resultScores);
    }

    renderResults(getDisplayedResults(), query);
  }

  async function loadMoreResults() {
    const query = document.querySelector('.rs-search-input')?.value;
    if (!query?.trim()) return;

    const previousCount = searchState.displayLimit;
    searchState.displayLimit += RESULT_PAGE_SIZE;
    renderResults(getDisplayedResults(), query);

    if (getSortMode() !== 'relevance') return;

    const newlyVisible = searchState.allResults.slice(previousCount, searchState.displayLimit);
    if (newlyVisible.length) await enrichAndRenderResults(query);
  }

  async function runSearch() {
    const input = document.querySelector('.rs-search-input');
    if (!input) return;

    const query = input.value;
    searchState.displayLimit = RESULT_PAGE_SIZE;

    if (!query.trim()) {
      searchState.allResults = [];
      searchState.resultScores = new Map();
      renderResults([], query);
      return;
    }

    const { topics, scores } = await searchTopics(query);
    if (input.value !== query) return;

    searchState.allResults = topics;
    searchState.resultScores = scores;

    renderResults(getDisplayedResults(), query);
    await enrichAndRenderResults(query);
  }

  function scheduleSearch() {
    clearTimeout(scheduleSearch.timer);
    scheduleSearch.timer = setTimeout(runSearch, 120);
  }

  async function refreshIndexStatus() {
    const [count, lastQuickUpdate] = await Promise.all([
      topicCount(),
      readMeta('lastQuickUpdate'),
    ]);

    if (!count) {
      setIndexStatus('The local index has not been built yet.');
      return;
    }

    setIndexStatus(
      `${formatCount(count)} topics. Updated ${new Date(lastQuickUpdate).toLocaleString()}.`
    );
  }

  function closeSearch() {
    document.querySelector('.rs-search-dialog')?.classList.remove('is-open');
  }

  async function openSearch() {
    const dialog = document.querySelector('.rs-search-dialog');
    if (!dialog) return;

    dialog.classList.add('is-open');
    dialog.querySelector('.rs-search-input').focus();

    await refreshIndexStatus();
    if (await topicCount() === 0) {
      updateIndex();
      return;
    }

    // a running update finishes with its own refresh, so opening the dialog adds nothing
    if (searchState.updating) return;

    indexNewestTopics({ rerunSearch: true }).then((count) => {
      if (count) refreshIndexStatus();
    });
  }

  function addSearchInterface() {
    if (document.querySelector('.rs-search-dialog')) return;

    const openButton = el('button', {
      type: 'button',
      className: 'rs-toolbox-button rs-search-open',
      textContent: 'Local search',
      title: 'RipperStore Unlocker local topic search',
    });
    openButton.addEventListener('click', openSearch);

    const dialog = el('div', { className: 'rs-search-dialog' });
    dialog.innerHTML = `
      <section class="rs-search-panel" role="dialog" aria-modal="true" aria-label="RipperStore Unlocker search">
        <header>
          <h2>RipperStore Unlocker</h2>
          <button type="button" class="rs-search-close" aria-label="Close">&times;</button>
        </header>
        <input class="rs-search-input" type="search" placeholder="Search topic titles or enter a topic ID" autocomplete="off">
        <div class="rs-search-toolbar">
          <span class="rs-search-update-status">Loading index status...</span>
          <div class="rs-search-toolbar-controls">
            <label class="rs-search-sort">
              Sort
              <select class="rs-search-sort-select" title="Sort search results">
                <option value="relevance">Relevance</option>
                <option value="created" title="When the topic was first posted">Created</option>
                <option value="lastposttime" title="When the topic was last replied to">Last reply</option>
                <option value="votes">Votes</option>
                <option value="views">Views</option>
                <option value="posts">Posts</option>
              </select>
            </label>
            <label class="rs-search-sort">
              Order
              <select class="rs-search-order-select" title="Sort direction">
                <option value="descending">Descending</option>
                <option value="ascending">Ascending</option>
              </select>
            </label>
            <div class="rs-search-actions">
              <button type="button" class="rs-search-update" title="Refresh the newest sitemap partitions into the existing index.">Update index</button>
              <button type="button" class="rs-search-rebuild" title="Delete the local index and rebuild it from every topic sitemap.">Rebuild index</button>
            </div>
          </div>
        </div>
        <div class="rs-search-results"></div>
      </section>
    `;

    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) closeSearch();
    });
    dialog.querySelector('.rs-search-close').addEventListener('click', closeSearch);
    dialog.querySelector('.rs-search-input').addEventListener('input', scheduleSearch);
    for (const [selector, key] of [
      ['.rs-search-sort-select', 'sortMode'],
      ['.rs-search-order-select', 'sortDirection'],
    ]) {
      dialog.querySelector(selector).addEventListener('change', (event) => {
        searchState[key] = event.target.value;
        runSearch();
      });
    }
    dialog.querySelector('.rs-search-update').addEventListener('click', () => {
      updateIndex({ forceQuick: true });
    });
    dialog.querySelector('.rs-search-rebuild').addEventListener('click', () => {
      updateIndex({ forceFull: true });
    });

    ensureToolbox().prepend(openButton);
    document.body.append(dialog);
    renderResults([], '');
  }

  function scheduleUpdates() {
    clearInterval(searchState.updateTimer);
    searchState.updateTimer = setInterval(() => updateIndex(), QUICK_UPDATE_INTERVAL);
    // delayed so the first page load is not competing with the index build
    setTimeout(() => updateIndex(), 2000);
  }

  function handleKeys(event) {
    if (event.key === 'Escape') closeSearch();
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      openSearch();
    }
  }

  function handleNavigation() {
    rawPostCache.clear();
    revealedTotals = { links: 0, media: 0, posts: 0 };
    addRevealButton();
    addSearchInterface();
    scheduleReveal();
  }

  function watchPage() {
    new MutationObserver(scheduleReveal).observe(document.body, {
      childList: true,
      subtree: true,
    });

    // NodeBB swaps pages client side, so ajaxify is the only reliable navigation signal
    if (window.jQuery) {
      window.jQuery(window).on('action:ajaxify.end', handleNavigation);
    }
    window.addEventListener('popstate', handleNavigation);
  }

  function start() {
    addStyles();
    addRevealButton();
    addSearchInterface();
    watchPage();
    scheduleReveal();
    scheduleUpdates();
    document.addEventListener('keydown', handleKeys);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
