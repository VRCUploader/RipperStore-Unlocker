// ==UserScript==
// @name         RipperStore Unlocker
// @namespace    https://forum.ripper.store
// @version      2.2.0
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
  const FETCH_CONCURRENCY = 4;
  const FETCH_TIMEOUT = 20_000;
  const FETCH_ATTEMPTS = 3;
  const RESULT_LIMIT = 100;

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
  };

  function addStyles() {
    if (document.querySelector('#rs-reveal-styles')) return;

    const style = document.createElement('style');
    style.id = 'rs-reveal-styles';
    style.textContent = `
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

      .rs-toolbox-button {
        padding: 8px 12px;
        border: 0;
        border-radius: 8px;
        box-shadow: 0 4px 14px rgb(0 0 0 / 25%);
        color: #fff;
        font: 600 13px/1.2 system-ui, sans-serif;
        cursor: pointer;
      }

      .rs-toolbox-button:hover {
        filter: brightness(1.08);
      }

      .rs-toolbox-button:disabled {
        opacity: .6;
        cursor: wait;
      }

      .rs-reveal-button {
        background: #198754;
      }

      .rs-search-open {
        background: #0d6efd;
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

      .rs-reveal-toast.is-visible {
        opacity: .95;
      }

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

      .rs-search-dialog.is-open {
        display: flex;
      }

      .rs-search-panel {
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

      .rs-search-panel h2 {
        margin: 0;
        font-size: 1.2rem;
      }

      .rs-search-close {
        border: 0;
        background: transparent;
        color: inherit;
        font-size: 1.7rem;
        cursor: pointer;
      }

      .rs-search-input {
        display: block;
        width: calc(100% - 32px);
        margin: 4px 16px 10px;
        padding: 10px 12px;
        border: 1px solid #adb5bd;
        border-radius: 6px;
        background: var(--bs-body-bg, #fff);
        color: inherit;
      }

      .rs-search-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
        padding: 0 16px 10px;
        color: var(--bs-secondary-color, #6c757d);
        font-size: .8rem;
      }

      .rs-search-toolbar-controls {
        display: flex;
        align-items: center;
        gap: 12px;
        flex: none;
      }

      .rs-search-sort {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }

      .rs-search-sort select {
        padding: 2px 6px;
        border: 1px solid #adb5bd;
        border-radius: 4px;
        background: var(--bs-body-bg, #fff);
        color: inherit;
        font: inherit;
      }

      .rs-search-actions {
        display: flex;
        gap: 10px;
        flex: none;
      }

      .rs-search-actions button {
        border: 0;
        background: transparent;
        color: #0d6efd;
        cursor: pointer;
      }

      .rs-search-results {
        max-height: 62vh;
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

      .rs-search-result:hover {
        background: rgb(13 110 253 / 8%);
      }

      .rs-search-result-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 14px;
        color: var(--bs-secondary-color, #6c757d);
        font-size: .78rem;
      }

      .rs-search-result-meta b {
        font-weight: 600;
        color: inherit;
      }

      .rs-search-empty {
        margin: 0;
        padding: 24px 16px;
        color: var(--bs-secondary-color, #6c757d);
        text-align: center;
      }
    `;
    document.head.append(style);
  }

  function ensureToolbox() {
    let toolbox = document.querySelector('.rs-toolbox');
    if (!toolbox) {
      toolbox = document.createElement('div');
      toolbox.className = 'rs-toolbox';
      document.body.append(toolbox);
    }
    return toolbox;
  }

  function showToast(message) {
    let toast = document.querySelector('.rs-reveal-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'rs-reveal-toast';
      ensureToolbox().append(toast);
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
      } else if (notifyIfEmpty && (revealedTotals.media || revealedTotals.links)) {
        showToast('Everything on this page is already unlocked');
      } else if (notifyIfEmpty) {
        showToast('No hidden content found on this page');
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
    button.className = 'rs-toolbox-button rs-reveal-button';
    button.addEventListener('click', () => revealAll());
    updateRevealButton(button);
    ensureToolbox().append(button);
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

      if (!database.objectStoreNames.contains(TOPICS_STORE)) {
        database.createObjectStore(TOPICS_STORE, { keyPath: 'id' });
      } else if (event.oldVersion < 2) {
        request.transaction.objectStore(TOPICS_STORE).clear();
      }

      if (!database.objectStoreNames.contains(META_STORE)) {
        database.createObjectStore(META_STORE, { keyPath: 'key' });
      } else if (event.oldVersion < 2) {
        request.transaction.objectStore(META_STORE).clear();
      }
    };

    searchState.database = await requestResult(request);
    return searchState.database;
  }

  async function readMeta(key) {
    const database = await openDatabase();
    const transaction = database.transaction(META_STORE, 'readonly');
    const record = await requestResult(transaction.objectStore(META_STORE).get(key));
    return record?.value;
  }

  async function writeMeta(entries) {
    const database = await openDatabase();
    const transaction = database.transaction(META_STORE, 'readwrite');
    const store = transaction.objectStore(META_STORE);

    for (const [key, value] of Object.entries(entries)) {
      store.put({ key, value });
    }

    await transactionDone(transaction);
  }

  async function topicCount() {
    const database = await openDatabase();
    const transaction = database.transaction(TOPICS_STORE, 'readonly');
    return requestResult(transaction.objectStore(TOPICS_STORE).count());
  }

  async function readAllTopics() {
    const database = await openDatabase();
    const transaction = database.transaction(TOPICS_STORE, 'readonly');
    return requestResult(transaction.objectStore(TOPICS_STORE).getAll());
  }

  function mergeTopicRecord(existing, topic) {
    if (!existing) return topic;

    return {
      ...existing,
      ...topic,
      votes: topic.votes ?? existing.votes,
      views: topic.views ?? existing.views,
      posts: topic.posts ?? existing.posts,
      statsFetchedAt: topic.statsFetchedAt ?? existing.statsFetchedAt,
    };
  }

  async function saveTopics(topics, replaceExisting) {
    const database = await openDatabase();
    const transaction = database.transaction(TOPICS_STORE, 'readwrite');
    const store = transaction.objectStore(TOPICS_STORE);

    if (replaceExisting) {
      store.clear();
      for (const topic of topics) store.put(topic);
    } else {
      for (const topic of topics) {
        const request = store.get(topic.id);
        request.onsuccess = () => {
          store.put(mergeTopicRecord(request.result, topic));
        };
      }
    }

    await transactionDone(transaction);

    if (searchState.topics) {
      const byId = new Map(searchState.topics.map((topic) => [topic.id, topic]));
      for (const topic of topics) {
        byId.set(topic.id, mergeTopicRecord(byId.get(topic.id), topic));
      }
      searchState.topics = [...byId.values()];
    }
  }

  function needsStats(topic) {
    if (topic.votes == null || topic.views == null || topic.posts == null) return true;
    if (!topic.statsFetchedAt) return true;
    return Date.now() - topic.statsFetchedAt >= STATS_REFRESH_INTERVAL;
  }

  async function fetchTopicStats(topic) {
    const response = await fetch(`${API_TOPICS}/${topic.id}`, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const body = await response.json();
    if (body.status?.code && body.status.code !== 'ok') {
      throw new Error(body.status.message || body.status.code);
    }

    const data = body.response ?? body;
    return {
      id: topic.id,
      votes: Number(data.votes ?? data.upvotes ?? 0),
      views: Number(data.viewcount ?? 0),
      posts: Number(data.postcount ?? 0),
      statsFetchedAt: Date.now(),
    };
  }

  async function enrichTopicStats(topics) {
    const pending = topics.filter(needsStats);
    if (!pending.length) return topics;

    for (let offset = 0; offset < pending.length; offset += FETCH_CONCURRENCY) {
      const group = pending.slice(offset, offset + FETCH_CONCURRENCY);
      const updates = await Promise.all(
        group.map(async (topic) => {
          try {
            return await fetchTopicStats(topic);
          } catch (error) {
            console.warn(`Could not load stats for topic ${topic.id}:`, error);
            return null;
          }
        })
      );

      const saved = updates.filter(Boolean);
      if (saved.length) await saveTopics(saved, false);

      for (const update of saved) {
        const topic = topics.find((entry) => entry.id === update.id);
        if (!topic) continue;
        Object.assign(topic, update);
      }
    }

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

        if (!response.ok) {
          throw new Error(`${url} returned HTTP ${response.status}`);
        }

        const text = await response.text();
        const document = new DOMParser().parseFromString(text, 'application/xml');
        if (document.querySelector('parsererror')) {
          throw new Error(`${url} returned invalid XML`);
        }

        return document;
      } catch (error) {
        lastError = error;
        if (attempt < FETCH_ATTEMPTS) await wait(attempt * 1000);
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError;
  }

  function sitemapLocations(document) {
    return [...document.querySelectorAll('sitemap > loc, url > loc')]
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
      // Keep the encoded slug when it contains invalid escape sequences.
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

  function parseTopicSitemap(document) {
    const topics = [];

    for (const urlNode of document.querySelectorAll('url')) {
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
      const slug = match[2] || `topic-${id}`;
      const title = readableTitle(slug);
      const lastModified = urlNode.querySelector('lastmod')?.textContent.trim() || '';

      topics.push({
        id,
        title,
        normalizedTitle: normalizeText(title),
        url: `${url.origin}/topic/${id}/${slug}`,
        lastModified,
      });
    }

    return topics;
  }

  function setUpdateStatus(message) {
    const status = document.querySelector('.rs-search-update-status');
    if (status) status.textContent = message;
  }

  async function loadSitemapList() {
    const document = await fetchXml('/sitemap.xml');
    return sitemapLocations(document)
      .filter((url) => /\/sitemap\/topics\.\d+\.xml$/.test(url))
      .sort((a, b) => sitemapNumber(a) - sitemapNumber(b));
  }

  async function processSitemaps(sitemaps, completedSitemaps, totalSitemaps) {
    for (let offset = 0; offset < sitemaps.length; offset += FETCH_CONCURRENCY) {
      const group = sitemaps.slice(offset, offset + FETCH_CONCURRENCY);
      const completedCount = completedSitemaps?.size || offset;

      setUpdateStatus(
        `Indexing sitemaps ${completedCount + 1} to ` +
        `${Math.min(completedCount + group.length, totalSitemaps)} of ${totalSitemaps}...`
      );

      const batches = await Promise.all(
        group.map(async (url) => parseTopicSitemap(await fetchXml(url)))
      );

      await saveTopics(batches.flat(), false);

      if (completedSitemaps) {
        for (const url of group) completedSitemaps.add(sitemapNumber(url));
        await writeMeta({
          completedFullSitemaps: [...completedSitemaps].sort((a, b) => a - b),
        });
      }
    }
  }

  async function updateIndex({ forceFull = false, forceQuick = false } = {}) {
    if (searchState.updating) return;
    searchState.updating = true;

    const startedAt = Date.now();

    try {
      const [
        lastQuickUpdate = 0,
        lastFullUpdate = 0,
        currentCount,
        savedSitemapCount = 0,
        savedCompletedSitemaps = [],
        fullBuildInProgress = false,
      ] = await Promise.all([
        readMeta('lastQuickUpdate'),
        readMeta('lastFullUpdate'),
        topicCount(),
        readMeta('fullBuildSitemapCount'),
        readMeta('completedFullSitemaps'),
        readMeta('fullBuildInProgress'),
      ]);

      const fullUpdateDue =
        forceFull ||
        currentCount === 0 ||
        (!forceQuick && startedAt - lastFullUpdate >= FULL_UPDATE_INTERVAL);
      const quickUpdateDue =
        forceQuick ||
        fullUpdateDue ||
        startedAt - lastQuickUpdate >= QUICK_UPDATE_INTERVAL;

      if (!quickUpdateDue) {
        await refreshIndexStatus();
        return;
      }

      setUpdateStatus('Loading sitemap list...');
      const allSitemaps = await loadSitemapList();

      if (fullUpdateDue) {
        const completedSitemaps = new Set(savedCompletedSitemaps);
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

        if (completedSitemaps.size) {
          setUpdateStatus(
            `Resuming full index with ${completedSitemaps.size} of ` +
            `${allSitemaps.length} sitemaps complete...`
          );
        }

        await processSitemaps(
          pendingSitemaps,
          completedSitemaps,
          allSitemaps.length
        );

        await writeMeta({
          lastFullUpdate: startedAt,
          lastQuickUpdate: startedAt,
          sitemapCount: allSitemaps.length,
          fullBuildInProgress: false,
        });
      } else {
        const recentSitemaps = allSitemaps.slice(-RECENT_SITEMAP_COUNT);
        await processSitemaps(recentSitemaps, null, recentSitemaps.length);
        await writeMeta({
          lastQuickUpdate: startedAt,
          sitemapCount: allSitemaps.length,
        });
      }

      await refreshIndexStatus();
      runSearch();
    } catch (error) {
      console.error('RipperStore index update failed:', error);
      const savedTopics = await topicCount();
      setUpdateStatus(
        `Update paused at ${savedTopics.toLocaleString()} topics: ${error.message}`
      );
    } finally {
      searchState.updating = false;
    }
  }

  async function loadTopicCache() {
    if (!searchState.topics) searchState.topics = await readAllTopics();
    return searchState.topics;
  }

  function searchScore(topic, normalizedQuery, tokens) {
    if (String(topic.id) === normalizedQuery) return 1000;
    if (topic.normalizedTitle === normalizedQuery) return 900;
    if (topic.normalizedTitle.startsWith(normalizedQuery)) return 700;
    if (!tokens.every((token) => topic.normalizedTitle.includes(token))) return -1;

    const firstMatch = Math.min(
      ...tokens.map((token) => topic.normalizedTitle.indexOf(token))
    );
    return 500 - firstMatch;
  }

  function getSortMode() {
    return (
      document.querySelector('.rs-search-sort-select')?.value ||
      searchState.sortMode ||
      'relevance'
    );
  }

  function compareTopics(a, b, mode) {
    if (mode !== 'relevance') {
      const left = a.topic[mode] ?? -1;
      const right = b.topic[mode] ?? -1;
      if (right !== left) return right - left;
    }

    return b.score - a.score || b.topic.id - a.topic.id;
  }

  function sortTopicList(topics, scores, mode = getSortMode()) {
    return [...topics].sort((left, right) => {
      if (mode !== 'relevance') {
        const leftValue = left[mode] ?? -1;
        const rightValue = right[mode] ?? -1;
        if (rightValue !== leftValue) return rightValue - leftValue;
      }

      return (
        (scores.get(right.id) || 0) - (scores.get(left.id) || 0) ||
        right.id - left.id
      );
    });
  }

  async function searchTopics(query) {
    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) {
      return { topics: [], scores: new Map() };
    }

    const tokens = normalizedQuery.split(' ');
    const mode = getSortMode();
    const matches = (await loadTopicCache())
      .map((topic) => ({
        topic,
        score: searchScore(topic, normalizedQuery, tokens),
      }))
      .filter((result) => result.score >= 0)
      .sort((a, b) => compareTopics(a, b, mode))
      .slice(0, RESULT_LIMIT);

    const scores = new Map(
      matches.map((result) => [result.topic.id, result.score])
    );

    return {
      topics: matches.map((result) => result.topic),
      scores,
    };
  }

  function formatCount(value) {
    return Number(value || 0).toLocaleString();
  }

  function topicDetailsText(topic) {
    const parts = [`Topic ${topic.id}`];

    if (topic.votes != null) parts.push(`${formatCount(topic.votes)} votes`);
    if (topic.views != null) parts.push(`${formatCount(topic.views)} views`);
    if (topic.posts != null) parts.push(`${formatCount(topic.posts)} posts`);

    return parts;
  }

  function renderResults(topics, query) {
    const results = document.querySelector('.rs-search-results');
    if (!results) return;
    results.replaceChildren();

    if (!query.trim()) {
      const message = document.createElement('p');
      message.className = 'rs-search-empty';
      message.textContent = 'Search public topic titles.';
      results.append(message);
      return;
    }

    if (!topics.length) {
      const message = document.createElement('p');
      message.className = 'rs-search-empty';
      message.textContent = 'No matching topics found.';
      results.append(message);
      return;
    }

    for (const topic of topics) {
      const link = document.createElement('a');
      link.className = 'rs-search-result';
      link.href = topic.url;
      link.dataset.topicId = String(topic.id);

      const title = document.createElement('strong');
      title.textContent = topic.title;

      const details = document.createElement('span');
      details.className = 'rs-search-result-meta';

      for (const part of topicDetailsText(topic)) {
        const item = document.createElement('span');
        item.textContent = part;
        details.append(item);
      }

      link.append(title, details);
      results.append(link);
    }
  }

  async function runSearch() {
    const input = document.querySelector('.rs-search-input');
    if (!input) return;

    const query = input.value;
    if (!query.trim()) {
      renderResults([], query);
      return;
    }

    const { topics, scores } = await searchTopics(query);
    if (input.value !== query) return;

    renderResults(topics, query);
    await enrichTopicStats(topics);
    if (input.value !== query) return;

    const sorted = sortTopicList(topics, scores);
    renderResults(sorted, query);
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
      setUpdateStatus('The local index has not been built yet.');
      return;
    }

    const updated = new Date(lastQuickUpdate).toLocaleString();
    setUpdateStatus(`${count.toLocaleString()} topics. Updated ${updated}.`);
  }

  function closeSearch() {
    document.querySelector('.rs-search-dialog')?.classList.remove('is-open');
  }

  async function openSearch() {
    const dialog = document.querySelector('.rs-search-dialog');
    if (!dialog) return;

    dialog.classList.add('is-open');
    const input = dialog.querySelector('.rs-search-input');
    input.focus();

    await refreshIndexStatus();
    if (await topicCount() === 0) updateIndex();
  }

  function addSearchInterface() {
    if (document.querySelector('.rs-search-dialog')) return;

    const openButton = document.createElement('button');
    openButton.type = 'button';
    openButton.className = 'rs-toolbox-button rs-search-open';
    openButton.textContent = 'Local search';
    openButton.title = 'RipperStore Unlocker local topic search';
    openButton.addEventListener('click', openSearch);

    const dialog = document.createElement('div');
    dialog.className = 'rs-search-dialog';
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
                <option value="votes">Votes</option>
                <option value="views">Views</option>
                <option value="posts">Posts</option>
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
    dialog.querySelector('.rs-search-sort-select').addEventListener('change', (event) => {
      searchState.sortMode = event.target.value;
      runSearch();
    });
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
    const button = document.querySelector('.rs-reveal-button');
    if (button) updateRevealButton(button);
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
    ensureToolbox();
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
