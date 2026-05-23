// ==UserScript==
// @name         DevScope 开发者工具 v6.2.1
// @namespace    devtools-sidebar-native
// @version      6.2.1
// @description  完整独立调试工具 - 修复上下文菜单/元素面板/复制源码
// @author       Developer
// @run-at       document-end
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==

(function() {
    'use strict';

    // ============ SVG 图标 ============
    const SVG = {
        menu: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
        close: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>',
        sun: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>',
        moon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>',
        settings: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>',
    };

    // ============ 全局变量 ============
    let isOpen = false;
    let activeTab = 'console';
    let activeToolTab = 'regex';
    let activeResourceTab = 'local';
    let isDarkTheme = GM_getValue('devtools-dark-theme', false);
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    let visualWidth = GM_getValue('devtools-visual-width', isMobile ? 320 : 420);
    let sidebarMode = GM_getValue('devtools-sidebar-mode', isMobile ? 'overlay' : 'push');
    let sidebarZoom = GM_getValue('devtools-sidebar-zoom', isMobile ? 0.9 : 1);
    let sidebarOpacity = GM_getValue('devtools-sidebar-opacity', 1);
    let autoShowInspector = GM_getValue('devtools-auto-inspector', false);
    let activeLogFilters = { log: true, warn: true, error: true, info: true };
    let searchQuery = '';
    let logs = [];
    let networkRequests = [];
    let selectedElement = null;
    let isSelectingElement = false;
    let elementIdCounter = 0;
    const elementIdToElementMap = new Map();
    const elementToIdMap = new Map();
    let expandedObjects = new Set();
    let elementTreeRendered = false;
    let expandedNodes = new Set();
    let totalNodesRendered = 0;
    const MAX_NODES = 15000;
    let networkResponseMap = new Map();
    let longPressTimer = null;
    let longPressTriggered = false;
    let scrollRaf = null;
    let cmdHistory = [];
    let cmdIndex = -1;

    // 跨页面日志存储键
    const LOG_STORAGE_KEY = '__devscope_logs__';
    const NET_STORAGE_KEY = '__devscope_network__';
    // POST 表单预取开关（默认 false 避免重复提交）
    let prefetchPostForms = GM_getValue('devtools-prefetch-post', false);

    // ============ 工具函数 ============
    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function isSafeUrl(url) {
        try {
            const u = new URL(url, location.href);
            return ['http:', 'https:', 'data:'].includes(u.protocol);
        } catch { return false; }
    }

    function safeStringify(obj) {
        try {
            return JSON.stringify(obj, null, 2);
        } catch {
            return String(obj);
        }
    }

    function formDataToString(fd) {
        try {
            const entries = [];
            fd.forEach((value, key) => entries.push(key + '=' + (typeof value === 'string' ? value : '[File]')));
            return entries.join('&');
        } catch { return '[FormData]'; }
    }

    // 恢复跳转前日志
    function restoreCrossPageLogs() {
        try {
            const stored = sessionStorage.getItem(LOG_STORAGE_KEY);
            if (stored) {
                logs = [...JSON.parse(stored), ...logs];
                sessionStorage.removeItem(LOG_STORAGE_KEY);
                renderLogs();
            }
        } catch(e) {}
        try {
            const storedNet = sessionStorage.getItem(NET_STORAGE_KEY);
            if (storedNet) {
                const parsed = JSON.parse(storedNet);
                networkRequests = [...parsed, ...networkRequests];
                parsed.forEach(r => { if (r.id && r.responseBody) networkResponseMap.set(r.id, r.responseBody); });
                sessionStorage.removeItem(NET_STORAGE_KEY);
                renderNetworkRequests();
            }
        } catch(e) {}
    }

    // 保存日志到 sessionStorage（跳转前调用）
    function saveLogsForNavigation() {
        try {
            sessionStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(logs.slice(-200)));
        } catch(e) {}
        try {
            const netCopy = networkRequests.slice(-200).map(r => ({...r}));
            sessionStorage.setItem(NET_STORAGE_KEY, JSON.stringify(netCopy));
        } catch(e) {}
    }

    // networkRequests 上限控制
    function trimNetworkRequests() {
        while (networkRequests.length > 300) {
            const removed = networkRequests.shift();
            networkResponseMap.delete(removed.id);
        }
    }

    // ============ 样式 ============
    function createStyles() {
        const style = document.createElement('style');
        style.id = 'devtools-native-styles';
        style.textContent = `
            .devtools-toggle-btn {
                position: fixed; top: 50%; right: 0; transform: translateY(-50%);
                z-index: 2147483647 !important; background: #333; color: #fff; border: none;
                padding: 8px 3px; border-radius: 4px 0 0 4px; cursor: pointer; font-size: 16px;
                font-family: sans-serif; line-height: 1; text-align: center; width: 16px;
                transition: right 0.3s, background 0.2s; pointer-events: auto;
            }
            .devtools-toggle-btn:hover { background: #555; }
            .devtools-sidebar {
                position: fixed; top: 0; height: 100vh; background: var(--bg-sidebar, #fff);
                z-index: 2147483646 !important; transition: right 0.3s; display: flex; flex-direction: column;
                box-shadow: -2px 0 10px rgba(0,0,0,0.2); font-family: 'Microsoft YaHei', sans-serif;
                border-left: 1px solid var(--border, #ccc); backdrop-filter: blur(4px);
            }
            .devtools-header {
                background: var(--bg-header, #f5f5f5); padding: 12px 16px;
                border-bottom: 1px solid var(--border, #ccc); display: flex;
                justify-content: space-between; align-items: center; flex-shrink: 0;
            }
            .devtools-header h3 { color: var(--text-primary, #333); font-size: 14px; font-weight: 600; margin: 0; }
            .devtools-header-right { display: flex; gap: 8px; align-items: center; }
            .devtools-theme-btn, .devtools-close-btn {
                background: none; border: none; color: var(--text-secondary, #666);
                font-size: 18px; cursor: pointer; padding: 4px; display: flex; align-items: center;
            }
            .devtools-theme-btn:hover, .devtools-close-btn:hover { color: var(--text-primary, #000); }
            .devtools-tabs {
                display: flex; background: var(--bg-tabs, #fafafa); border-bottom: 1px solid var(--border, #ccc);
                flex-shrink: 0; overflow-x: auto;
            }
            .devtools-tab {
                padding: 10px 14px; color: var(--text-secondary, #666); cursor: pointer; font-size: 12px;
                border-bottom: 2px solid transparent; transition: 0.2s; white-space: nowrap;
                display: flex; align-items: center; gap: 4px;
            }
            .devtools-tab:hover { color: var(--text-primary, #333); }
            .devtools-tab.active {
                color: var(--text-primary, #000); border-bottom-color: var(--border-active, #000);
                background: var(--bg-panel, #fff);
            }
            .devtools-content {
                flex: 1; overflow: hidden; color: var(--text-primary, #333); font-size: 12px;
            }
            .devtools-panel { display: none; height: 100%; overflow: hidden; }
            .devtools-panel.active { display: flex; flex-direction: column; }

            /* 控制台 */
            .devtools-console-wrapper { flex: 1; display: flex; flex-direction: column; padding: 8px; overflow: hidden; }
            .devtools-console-header {
                display: flex; gap: 6px; padding: 8px; border-bottom: 1px solid var(--border-light, #eee);
                margin-bottom: 8px; flex-wrap: wrap; flex-shrink: 0;
            }
            .devtools-console-btn {
                padding: 4px 10px; background: var(--bg-btn, #f0f0f0); color: var(--text-primary, #333);
                border: 1px solid var(--border, #ccc); border-radius: 3px; cursor: pointer; font-size: 11px;
            }
            .devtools-console-btn:hover { background: var(--bg-btn-hover, #e0e0e0); }
            .devtools-console-btn.active { background: var(--bg-btn-active, #000); color: #fff; }
            .devtools-search-box {
                flex: 1; min-width: 120px; padding: 4px 8px; border: 1px solid var(--border, #ccc);
                border-radius: 3px; font-size: 11px; background: var(--bg-panel, #fff); color: var(--text-primary, #333);
            }
            .devtools-console-logs {
                flex: 1; overflow-y: auto; min-height: 0; margin-bottom: 8px;
            }
            .devtools-console-input-wrapper {
                flex-shrink: 0; display: flex; gap: 8px; padding-top: 8px;
                border-top: 1px solid var(--border-light, #eee);
            }
            .devtools-console-input {
                flex: 1; padding: 6px 8px; border: 1px solid var(--border, #ccc); border-radius: 3px;
                font-family: Consolas, monospace; font-size: 12px; background: var(--bg-panel, #fff);
                color: var(--text-primary, #333);
            }
            .devtools-log-item {
                padding: 4px 8px; border-bottom: 1px solid var(--border-light, #eee);
                word-break: break-all; background: var(--bg-panel, #fff);
            }
            .devtools-log-item.log { color: var(--text-primary, #333); }
            .devtools-log-item.warn { color: var(--text-warn, #996600); background: var(--bg-warn, #fffbe6); }
            .devtools-log-item.error { color: var(--text-error, #c00); background: var(--bg-error, #fff5f5); }
            .devtools-log-item.info { color: var(--text-info, #0066cc); background: var(--bg-info, #f0f7ff); }
            .devtools-log-toggle { display: inline-block; margin-right: 6px; cursor: pointer; user-select: none; }

            /* 元素 */
            .devtools-elements-wrapper { flex: 1; display: flex; flex-direction: column; padding: 8px; overflow: hidden; }
            .devtools-elements-header {
                display: flex; gap: 8px; padding: 8px; border-bottom: 1px solid var(--border-light, #eee);
                margin-bottom: 8px; flex-shrink: 0;
            }
            .devtools-element-selector {
                padding: 4px 12px; background: var(--bg-btn, #f0f0f0); color: var(--text-primary, #333);
                border: 1px solid var(--border, #ccc); border-radius: 3px; cursor: pointer; font-size: 11px;
            }
            .devtools-element-selector.active { background: var(--bg-btn-active, #000); color: #fff; }
            .devtools-element-container { display: flex; flex: 1; overflow: hidden; }
            .devtools-element-tree {
                flex: 1; overflow-y: auto; font-family: Consolas, monospace; font-size: 11px;
                color: var(--text-primary, #333);
            }
            .devtools-tree-node { padding: 2px 4px; cursor: pointer; user-select: none; word-break: break-all; white-space: pre-wrap; }
            .devtools-tree-node:hover { background: rgba(0, 120, 212, 0.08); }
            .devtools-tree-node.selected { background: rgba(0, 120, 212, 0.15); color: inherit; }
            .devtools-tree-toggle { display: inline-block; width: 16px; text-align: center; color: var(--text-secondary, #666); }
            .devtools-tree-children { margin-left: 16px; display: none; }
            .devtools-tree-children.open { display: block; }
            .devtools-tag-name { color: #569cd6; }
            .devtools-attr-name { color: #9cdcfe; }
            .devtools-attr-value { color: #ce9178; }
            .devtools-element-inspector {
                width: 220px; border-left: 1px solid var(--border-light, #eee);
                padding: 8px; overflow-y: auto; display: none;
            }
            .devtools-element-inspector.visible { display: block; }
            .devtools-inspector-title { font-weight: 600; margin-bottom: 8px; font-size: 12px; display: flex; justify-content: space-between; align-items: center; }
            .devtools-inspector-close { cursor: pointer; color: var(--text-secondary, #666); font-size: 18px; line-height: 1; padding: 0 4px; }
            .devtools-inspector-section { margin-bottom: 12px; }
            .devtools-inspector-prop { display: flex; margin-bottom: 4px; }
            .devtools-inspector-key { color: var(--text-attr, #666); min-width: 80px; }
            .devtools-inspector-val { word-break: break-all; }
            .devtools-highlight-overlay {
                position: fixed; z-index: 2147483644 !important; pointer-events: none;
                background: rgba(0, 120, 212, 0.08); border: 1px solid rgba(0, 120, 212, 0.5);
                box-sizing: border-box;
            }

            /* 网络 */
            .devtools-network-wrapper { flex: 1; display: flex; flex-direction: column; padding: 8px; overflow: hidden; }
            .devtools-network-header {
                display: flex; gap: 8px; padding: 8px; border-bottom: 1px solid var(--border-light, #eee);
                margin-bottom: 8px; flex-shrink: 0; flex-wrap: wrap; align-items: center;
            }
            .devtools-network-details {
                padding: 10px; background: var(--bg-details, #fafafa); border-bottom: 1px solid var(--border-light, #eee);
                max-height: 40%; overflow-y: auto; flex-shrink: 0; display: none;
            }
            .devtools-network-details-full {
                padding: 10px; background: var(--bg-panel, #fff); overflow-y: auto; flex: 1; display: none;
            }
            .devtools-network-details-full .devtools-details-back {
                display: inline-block; padding: 4px 12px; margin-bottom: 8px; border-radius: 4px;
                background: var(--bg-hover, #f0f0f0); color: var(--text-primary, #333);
                cursor: pointer; font-size: 12px; border: 1px solid var(--border, #ccc);
            }
            .devtools-network-details-full .devtools-details-back:hover { background: var(--border-light, #e0e0e0); }
            .devtools-details-tabs { display: flex; gap: 4px; margin: 8px 0; border-bottom: 1px solid var(--border-light, #eee); }
            .devtools-details-tab { padding: 4px 12px; cursor: pointer; font-size: 11px; color: var(--text-secondary, #666); border-bottom: 2px solid transparent; }
            .devtools-details-tab.active { color: var(--text-primary, #000); border-bottom-color: var(--border-active, #000); }
            .devtools-details-tab-content { display: none; }
            .devtools-details-tab-content.active { display: block; }
            .devtools-network-list-wrapper { flex: 1; overflow-y: auto; }
            .devtools-network-item { padding: 4px 8px; border-bottom: 1px solid var(--border-light, #eee);
                display: flex; gap: 6px; font-size: 11px; background: var(--bg-panel, #fff); cursor: pointer;
                align-items: flex-start;
            }
            .devtools-network-item:hover { background: var(--bg-hover, #f5f5f5); }
            .devtools-network-method { min-width: 50px; font-weight: bold; flex-shrink: 0; }
            .devtools-network-url { flex: 1; overflow: hidden; word-break: break-all; white-space: pre-wrap; color: var(--text-secondary, #666); }
            .devtools-network-status { min-width: 40px; text-align: right; }
            .devtools-network-time { min-width: 50px; text-align: right; color: var(--text-secondary, #999); }

            /* 工具 */
            .devtools-tools-wrapper { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
            .devtools-tools-tabs {
                display: flex; border-bottom: 1px solid var(--border-light, #eee); flex-shrink: 0; overflow-x: auto;
            }
            .devtools-tools-tab {
                padding: 8px 10px; color: var(--text-secondary, #666); cursor: pointer; font-size: 11px;
                border-bottom: 2px solid transparent; white-space: nowrap;
            }
            .devtools-tools-tab.active { color: var(--text-primary, #000); border-bottom-color: var(--border-active, #000); background: var(--bg-panel, #fff); }
            .devtools-tools-content { flex: 1; overflow: auto; padding: 8px; }

            /* 资源 */
            .devtools-resources-wrapper { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
            .devtools-resource-tabs {
                display: flex; border-bottom: 1px solid var(--border-light, #eee); flex-shrink: 0; overflow-x: auto;
            }
            .devtools-resource-tab {
                padding: 8px 10px; color: var(--text-secondary, #666); cursor: pointer; font-size: 11px;
                border-bottom: 2px solid transparent; white-space: nowrap;
            }
            .devtools-resource-tab.active { color: var(--text-primary, #000); border-bottom-color: var(--border-active, #000); background: var(--bg-panel, #fff); }
            .devtools-resource-content { flex: 1; overflow: auto; padding: 8px; }
            .devtools-resource-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
            .devtools-resource-title { font-size: 13px; font-weight: 600; }
            .devtools-storage-table { width: 100%; border-collapse: collapse; font-size: 11px; }
            .devtools-storage-table th, .devtools-storage-table td {
                border: 1px solid var(--border-light, #eee); padding: 5px 7px; text-align: left; word-break: break-all;
            }
            .devtools-storage-table th { background: var(--bg-header, #f5f5f5); font-weight: 600; position: sticky; top: 0; }
            .devtools-storage-table td { background: var(--bg-panel, #fff); }
            .devtools-storage-table tr:hover td { background: var(--bg-hover, #f9f9f9); }
            .devtools-action-btn {
                padding: 2px 6px; margin: 0 2px; background: var(--bg-btn, #f0f0f0);
                border: 1px solid var(--border, #ccc); border-radius: 2px; cursor: pointer; font-size: 10px;
            }
            .devtools-action-btn:hover { background: var(--bg-btn-hover, #e0e0e0); }
            .devtools-resource-list { font-size: 11px; }
            .devtools-resource-link {
                display: block; padding: 5px 8px; color: var(--text-link, #0066cc);
                text-decoration: none; border-bottom: 1px solid var(--border-light, #eee); word-break: break-all;
            }
            .devtools-image-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 8px; }
            .devtools-image-item { border: 1px solid var(--border-light, #eee); padding: 4px; }
            .devtools-image-item img { width: 100%; height: auto; display: block; }
            .devtools-add-row {
                margin-top: 8px; padding: 5px 10px; background: var(--bg-btn, #f0f0f0);
                border: 1px solid var(--border, #ccc); border-radius: 3px; cursor: pointer; font-size: 11px;
            }
            .devtools-add-row:hover { background: var(--bg-btn-hover, #e0e0e0); }

            .devtools-input-group { margin-bottom: 10px; }
            .devtools-input-label { display: block; font-size: 11px; font-weight: 600; margin-bottom: 4px; }
            .devtools-textarea {
                width: 100%; min-height: 70px; padding: 6px; border: 1px solid var(--border, #ccc);
                border-radius: 3px; font-size: 11px; font-family: Consolas, monospace;
                background: var(--bg-panel, #fff); color: var(--text-primary, #333);
                box-sizing: border-box; resize: vertical;
            }
            .devtools-input {
                width: 100%; padding: 5px 7px; border: 1px solid var(--border, #ccc); border-radius: 3px;
                font-size: 11px; font-family: Consolas, monospace; background: var(--bg-panel, #fff);
                color: var(--text-primary, #333); box-sizing: border-box;
            }
            .devtools-tool-btn {
                padding: 5px 12px; background: var(--bg-btn, #f0f0f0); color: var(--text-primary, #333);
                border: 1px solid var(--border, #ccc); border-radius: 3px; cursor: pointer; font-size: 11px;
            }
            .devtools-tool-btn.primary { background: var(--bg-btn-active, #000); color: #fff; }
            .devtools-result-box {
                margin-top: 10px; padding: 10px; background: var(--bg-hover, #f5f5f5);
                border: 1px solid var(--border-light, #eee); border-radius: 3px;
                font-family: Consolas, monospace; font-size: 11px; max-height: 200px; overflow: auto;
                white-space: pre-wrap; word-break: break-all;
            }
            .devtools-match { background: #ff0; color: #000; padding: 0 2px; border-radius: 2px; }
            .devtools-group { color: #0066cc; }

            .devtools-selector-result {
                padding: 4px 8px; border-bottom: 1px solid var(--border-light, #eee);
                cursor: pointer; font-family: Consolas, monospace; font-size: 10px;
            }
            .devtools-selector-result:hover { background: var(--bg-hover, #f5f5f5); }
            .devtools-selector-result.selected { background: var(--bg-selected, #000); color: #fff; }

            /* 上下文菜单 */
            .devtools-context-menu {
                position: fixed; z-index: 2147483648 !important; background: var(--bg-panel, #fff);
                border: 1px solid var(--border, #ccc); border-radius: 4px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15); min-width: 180px;
                padding: 4px 0; font-size: 12px; font-family: 'Microsoft YaHei', sans-serif; display: none;
            }
            .devtools-context-menu.show { display: block; }
            .devtools-context-menu-item {
                padding: 8px 14px; cursor: pointer; color: var(--text-primary, #333);
                white-space: nowrap; user-select: none;
            }
            .devtools-context-menu-item:hover { background: var(--bg-btn-active, #000); color: #fff; }
            .devtools-context-menu-sep { height: 1px; background: var(--border-light, #eee); margin: 4px 0; }
            .devtools-context-menu-backdrop {
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                z-index: 2147483645 !important; display: none;
            }
            .devtools-context-menu-backdrop.show { display: block; }

            /* 设置面板 */
            .devtools-settings-panel {
                display: none; position: absolute; top: 100%; right: 0;
                background: var(--bg-panel, #fff); border: 1px solid var(--border, #ccc);
                border-top: none; border-radius: 0 0 6px 6px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15); padding: 14px 16px;
                z-index: 2147483647; min-width: 320px; font-size: 12px;
            }
            .devtools-settings-panel.show { display: block; }
            .devtools-setting-row {
                display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;
            }
            .devtools-setting-label { color: var(--text-primary, #333); font-weight: 600; font-size: 12px; }
            .devtools-setting-label small { display: block; font-weight: 400; color: var(--text-secondary, #999); font-size: 10px; margin-top: 2px; }
            .devtools-setting-control { display: flex; align-items: center; gap: 8px; }
            .devtools-setting-select {
                padding: 4px 8px; border: 1px solid var(--border, #ccc); border-radius: 3px;
                font-size: 11px; background: var(--bg-panel, #fff); color: var(--text-primary, #333); cursor: pointer;
            }
            .devtools-setting-range { width: 100px; accent-color: #0078d4; }
            .devtools-setting-range-val { font-size: 11px; color: var(--text-secondary, #666); min-width: 40px; text-align: right; font-family: Consolas, monospace; }
            .devtools-zoom-btn {
                padding: 2px 8px; font-size: 14px; font-weight: bold; cursor: pointer;
                background: var(--bg-btn, #f0f0f0); color: var(--text-primary, #333);
                border: 1px solid var(--border, #ccc); border-radius: 3px; line-height: 1;
            }
            .devtools-zoom-btn:hover { background: var(--bg-btn-hover, #e0e0e0); }

            .devtools-body-pushed { margin-right: 420px; }

            /* 性能面板 */
            .devtools-performance-metric { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid var(--border-light, #eee); }
            .devtools-performance-metric span:first-child { color: var(--text-secondary, #666); }
            .devtools-performance-metric span:last-child { font-weight: 600; }

            /* 暗色主题 */
            .devtools-sidebar.dark-theme,
            body.dark-theme {
                --bg-sidebar: #1e1e1e; --bg-panel: #252526; --bg-header: #2d2d2d; --bg-tabs: #333333;
                --bg-btn: #3c3c3c; --bg-btn-hover: #4c4c4c; --bg-btn-active: #0e639c; --bg-hover: #2a2d2e; --bg-selected: #094771;
                --bg-details: #2d2d2d; --bg-warn: #454137; --bg-error: #4b1818; --bg-info: #0f3a60;
                --text-primary: #cccccc; --text-secondary: #969696; --text-tag: #9cdcfe; --text-attr: #9cdcfe;
                --text-link: #3794ff; --text-warn: #dcdcaa; --text-error: #f44747; --text-info: #4ec9b0;
                --border: #454545; --border-light: #3c3c3c; --border-active: #0078d4;
            }
        `;
        document.head.appendChild(style);
    }

    // ============ UI 构建 ============
    function createSidebar() {
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'devtools-toggle-btn';
        toggleBtn.id = 'devtools-toggle-btn';
        toggleBtn.innerHTML = SVG.menu;
        toggleBtn.addEventListener('click', toggleSidebar);
        document.body.appendChild(toggleBtn);

        const sidebar = document.createElement('div');
        sidebar.className = 'devtools-sidebar';
        sidebar.id = 'devtools-sidebar';

        // 头部
        const header = document.createElement('div');
        header.className = 'devtools-header';
        header.style.position = 'relative';
        header.innerHTML = `
            <h3>DevScope 开发者工具</h3>
            <div class="devtools-header-right">
                <button class="devtools-theme-btn" id="devtools-settings-btn" title="设置">${SVG.settings}</button>
                <button class="devtools-theme-btn" id="devtools-theme-btn" title="切换主题">${SVG.moon}</button>
                <button class="devtools-close-btn" id="devtools-close-btn" title="关闭">${SVG.close}</button>
            </div>
            <div class="devtools-settings-panel" id="devtools-settings-panel">
                <div class="devtools-setting-row">
                    <span class="devtools-setting-label">显示模式<small>推挤 / 覆盖</small></span>
                    <select class="devtools-setting-select" id="devtools-setting-mode">
                        <option value="push" ${sidebarMode === 'push' ? 'selected' : ''}>推挤式</option>
                        <option value="overlay" ${sidebarMode === 'overlay' ? 'selected' : ''}>覆盖式</option>
                    </select>
                </div>
                <div class="devtools-setting-row">
                    <span class="devtools-setting-label">面板宽度<small>视觉宽度(px)，最大1000px</small></span>
                    <div class="devtools-setting-control">
                        <input type="range" class="devtools-setting-range" id="devtools-setting-width" min="300" max="1000" step="10" value="${visualWidth}">
                        <span class="devtools-setting-range-val" id="devtools-setting-width-val">${visualWidth}px</span>
                    </div>
                </div>
                <div class="devtools-setting-row">
                    <span class="devtools-setting-label">布局缩放<small>整体布局缩放 (0.50~1.50)</small></span>
                    <div class="devtools-setting-control">
                        <button class="devtools-zoom-btn" id="devtools-zoom-minus">-</button>
                        <input type="range" class="devtools-setting-range" id="devtools-setting-zoom" min="0.5" max="1.5" step="0.01" value="${sidebarZoom}">
                        <button class="devtools-zoom-btn" id="devtools-zoom-plus">+</button>
                        <span class="devtools-setting-range-val" id="devtools-setting-zoom-val">${sidebarZoom.toFixed(2)}x</span>
                    </div>
                </div>
                <div class="devtools-setting-row">
                    <span class="devtools-setting-label">背景透明度<small>越低越透明</small></span>
                    <div class="devtools-setting-control">
                        <input type="range" class="devtools-setting-range" id="devtools-setting-opacity" min="0.3" max="1" step="0.05" value="${sidebarOpacity}">
                        <span class="devtools-setting-range-val" id="devtools-setting-opacity-val">${sidebarOpacity}</span>
                    </div>
                </div>
                <div class="devtools-setting-row">
                    <span class="devtools-setting-label">自动显示元素信息</span>
                    <div class="devtools-setting-control">
                        <input type="checkbox" id="devtools-setting-auto-inspector" ${autoShowInspector ? 'checked' : ''}>
                    </div>
                </div>
                <div class="devtools-setting-row">
                    <span class="devtools-setting-label">预取 POST 表单<small>可能重复提交，仅幂等操作开启</small></span>
                    <div class="devtools-setting-control">
                        <input type="checkbox" id="devtools-setting-prefetch-post" ${prefetchPostForms ? 'checked' : ''}>
                    </div>
                </div>
                <div class="devtools-setting-row">
                    <span class="devtools-setting-label">启用函数调用跟踪<small>记录 addEventListener/setTimeout</small></span>
                    <div class="devtools-setting-control">
                        <input type="checkbox" id="devtools-setting-fn-trace" ${GM_getValue('devtools-fn-trace', false) ? 'checked' : ''}>
                    </div>
                </div>
                <div class="devtools-setting-row">
                    <span class="devtools-setting-label">启用 DOM 变化监听<small>记录节点/属性变化</small></span>
                    <div class="devtools-setting-control">
                        <input type="checkbox" id="devtools-setting-dom-observe" ${GM_getValue('devtools-dom-observe', false) ? 'checked' : ''}>
                    </div>
                </div>
                <div class="devtools-setting-row" style="justify-content:flex-end;margin-top:10px;padding-top:10px;border-top:1px solid var(--border-light,#eee);">
                    <button class="devtools-console-btn" id="devtools-reset-settings">重置所有设置</button>
                </div>
            </div>
        `;
        sidebar.appendChild(header);

        // 应用保存的主题设置
        if (isDarkTheme) {
            sidebar.classList.add('dark-theme');
            document.body.classList.add('dark-theme');
            const themeBtn = document.getElementById('devtools-theme-btn');
            if (themeBtn) themeBtn.innerHTML = SVG.sun;
        }

        // 标签栏
        const tabsContainer = document.createElement('div');
        tabsContainer.className = 'devtools-tabs';
        ['控制台', '元素', '网络', '工具', '资源', '性能'].forEach((label, i) => {
            const ids = ['console', 'elements', 'network', 'tools', 'resources', 'performance'];
            const btn = document.createElement('div');
            btn.className = 'devtools-tab' + (i === 0 ? ' active' : '');
            btn.dataset.tab = ids[i];
            btn.innerHTML = label;
            btn.addEventListener('click', () => switchTab(ids[i]));
            tabsContainer.appendChild(btn);
        });
        sidebar.appendChild(tabsContainer);

        const content = document.createElement('div');
        content.className = 'devtools-content';

        // 控制台面板
        const consolePanel = document.createElement('div');
        consolePanel.className = 'devtools-panel active';
        consolePanel.id = 'devtools-panel-console';
        consolePanel.innerHTML = `
            <div class="devtools-console-wrapper">
                <div class="devtools-console-header">
                    <button class="devtools-console-btn active" data-filter="all">全部</button>
                    <button class="devtools-console-btn active" data-filter="log">日志</button>
                    <button class="devtools-console-btn active" data-filter="warn">警告</button>
                    <button class="devtools-console-btn active" data-filter="error">错误</button>
                    <button class="devtools-console-btn active" data-filter="info">信息</button>
                    <input type="text" class="devtools-search-box" id="devtools-console-search" placeholder="搜索日志...">
                    <button class="devtools-console-btn" id="devtools-console-clear">清除</button>
                </div>
                <div class="devtools-console-logs" id="devtools-console-logs"></div>
                <div class="devtools-console-input-wrapper">
                    <span style="color: #666; font-family: monospace; padding: 6px 0;">></span>
                    <input type="text" class="devtools-console-input" id="devtools-console-input" placeholder="输入命令按Enter执行，↑↓切换历史...">
                </div>
            </div>
        `;
        content.appendChild(consolePanel);

        // 元素面板
        const elementsPanel = document.createElement('div');
        elementsPanel.className = 'devtools-panel';
        elementsPanel.id = 'devtools-panel-elements';
        elementsPanel.innerHTML = `
            <div class="devtools-elements-wrapper">
                <div class="devtools-elements-header">
                    <button class="devtools-element-selector" id="devtools-element-selector-btn">选择元素</button>
                    <button class="devtools-console-btn" id="devtools-elements-refresh">刷新树</button>
                    <button class="devtools-console-btn" id="devtools-copy-page-source-btn">复制源码</button>
                </div>
                <div class="devtools-element-container">
                    <div class="devtools-element-tree" id="devtools-element-tree"></div>
                    <div class="devtools-element-inspector" id="devtools-element-inspector">
                        <div class="devtools-inspector-title">
                            <span>元素信息</span>
                            <span class="devtools-inspector-close" id="devtools-inspector-close">×</span>
                        </div>
                        <div id="devtools-inspector-content">
                            <div style="color:#999;">点击元素并选择"查看元素信息"</div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        content.appendChild(elementsPanel);

        // 网络面板
        const networkPanel = document.createElement('div');
        networkPanel.className = 'devtools-panel';
        networkPanel.id = 'devtools-panel-network';
        networkPanel.innerHTML = `
            <div class="devtools-network-wrapper">
                <div class="devtools-network-header" id="devtools-network-toolbar">
                    <button class="devtools-console-btn" id="devtools-network-clear">清除</button>
                    <button class="devtools-console-btn" id="devtools-network-pause">暂停</button>
                    <select id="devtools-network-type-filter" class="devtools-console-btn" style="margin-left:4px;">
                        <option value="all">全部</option>
                        <option value="XHR">XHR</option>
                        <option value="JS">JS</option>
                        <option value="CSS">CSS</option>
                        <option value="Img">Img</option>
                        <option value="WS">WS</option>
                        <option value="Beacon">Beacon</option>
                        <option value="SSE">SSE</option>
                        <option value="Nav">Navigation</option>
                        <option value="Other">Other</option>
                    </select>
                    <input type="text" class="devtools-search-box" id="devtools-network-search" placeholder="搜索URL..." style="min-width:80px;max-width:150px;">
                </div>
                <div class="devtools-network-details" id="devtools-network-details" style="display: none;"></div>
                <div class="devtools-network-details-full" id="devtools-network-details-full" style="display: none;"></div>
                <div class="devtools-network-list-wrapper" id="devtools-network-list-wrapper">
                    <div id="devtools-network-list"></div>
                </div>
            </div>
        `;
        content.appendChild(networkPanel);

        // 工具面板
        const toolsPanel = document.createElement('div');
        toolsPanel.className = 'devtools-panel';
        toolsPanel.id = 'devtools-panel-tools';
        toolsPanel.innerHTML = `
            <div class="devtools-tools-wrapper">
                <div class="devtools-tools-tabs">
                    <div class="devtools-tools-tab active" data-tab="regex">正则</div>
                    <div class="devtools-tools-tab" data-tab="selector">选择器</div>
                    <div class="devtools-tools-tab" data-tab="json">JSON</div>
                    <div class="devtools-tools-tab" data-tab="string">字符串</div>
                    <div class="devtools-tools-tab" data-tab="request">请求</div>
                </div>
                <div class="devtools-tools-content" id="devtools-tools-content"></div>
            </div>
        `;
        content.appendChild(toolsPanel);

        // 资源面板
        const resourcesPanel = document.createElement('div');
        resourcesPanel.className = 'devtools-panel';
        resourcesPanel.id = 'devtools-panel-resources';
        resourcesPanel.innerHTML = `
            <div class="devtools-resources-wrapper">
                <div class="devtools-resource-tabs">
                    <div class="devtools-resource-tab active" data-tab="local">本地存储</div>
                    <div class="devtools-resource-tab" data-tab="session">会话存储</div>
                    <div class="devtools-resource-tab" data-tab="cookie">Cookie</div>
                    <div class="devtools-resource-tab" data-tab="ua">UserAgent</div>
                    <div class="devtools-resource-tab" data-tab="script">脚本</div>
                    <div class="devtools-resource-tab" data-tab="stylesheet">样式表</div>
                    <div class="devtools-resource-tab" data-tab="iframe">框架</div>
                    <div class="devtools-resource-tab" data-tab="image">图片</div>
                    <div class="devtools-resource-tab" data-tab="cache">缓存</div>
                </div>
                <div class="devtools-resource-content" id="devtools-resource-content"></div>
            </div>
        `;
        content.appendChild(resourcesPanel);

        // 性能面板
        const performancePanel = document.createElement('div');
        performancePanel.className = 'devtools-panel';
        performancePanel.id = 'devtools-panel-performance';
        performancePanel.innerHTML = `
            <div class="devtools-performance-wrapper">
                <div id="devtools-performance-content"></div>
            </div>
        `;
        content.appendChild(performancePanel);

        sidebar.appendChild(content);
        document.body.appendChild(sidebar);

        const highlightOverlay = document.createElement('div');
        highlightOverlay.className = 'devtools-highlight-overlay';
        highlightOverlay.id = 'devtools-highlight-overlay';
        highlightOverlay.style.display = 'none';
        document.body.appendChild(highlightOverlay);

        const contextBackdrop = document.createElement('div');
        contextBackdrop.className = 'devtools-context-menu-backdrop';
        contextBackdrop.id = 'devtools-context-backdrop';
        document.body.appendChild(contextBackdrop);

        const contextMenu = document.createElement('div');
        contextMenu.className = 'devtools-context-menu';
        contextMenu.id = 'devtools-context-menu';
        contextMenu.innerHTML = `
            <div class="devtools-context-menu-item" data-action="copyElement">复制元素</div>
            <div class="devtools-context-menu-item" data-action="copyOuterHTML">复制 outerHTML</div>
            <div class="devtools-context-menu-item" data-action="copySelector">复制 selector</div>
            <div class="devtools-context-menu-item" data-action="copyJSPath">复制 JS 路径</div>
            <div class="devtools-context-menu-item" data-action="copyStyles">复制样式</div>
            <div class="devtools-context-menu-sep"></div>
            <div class="devtools-context-menu-item" data-action="copyXPath">复制 XPath</div>
            <div class="devtools-context-menu-item" data-action="copyFullXPath">复制完整的 XPath</div>
            <div class="devtools-context-menu-sep"></div>
            <div class="devtools-context-menu-item" data-action="inspectElement">查看元素信息</div>
        `;
        document.body.appendChild(contextMenu);

        // 元素信息关闭按钮
        document.getElementById('devtools-inspector-close').addEventListener('click', () => {
            document.getElementById('devtools-element-inspector').classList.remove('visible');
        });

        initEventListeners();
        initTreeEventDelegation();
        initContextMenuEvents();
    }

    // ============ 事件监听 ============
    function initEventListeners() {
        document.getElementById('devtools-settings-btn').addEventListener('click', e => {
            e.stopPropagation();
            document.getElementById('devtools-settings-panel').classList.toggle('show');
        });
        document.getElementById('devtools-setting-mode').addEventListener('change', e => {
            sidebarMode = e.target.value;
            GM_setValue('devtools-sidebar-mode', sidebarMode);
            applySidebarSettings();
        });
        document.getElementById('devtools-setting-width').addEventListener('input', e => {
            visualWidth = parseInt(e.target.value);
            document.getElementById('devtools-setting-width-val').textContent = visualWidth + 'px';
            GM_setValue('devtools-visual-width', visualWidth);
            applySidebarSettings();
        });
        document.getElementById('devtools-setting-zoom').addEventListener('input', e => {
            sidebarZoom = parseFloat(e.target.value);
            document.getElementById('devtools-setting-zoom-val').textContent = sidebarZoom.toFixed(2) + 'x';
            GM_setValue('devtools-sidebar-zoom', sidebarZoom);
            applySidebarSettings();
        });
        document.getElementById('devtools-zoom-minus').addEventListener('click', () => adjustZoom(-0.01));
        document.getElementById('devtools-zoom-plus').addEventListener('click', () => adjustZoom(0.01));
        document.getElementById('devtools-setting-opacity').addEventListener('input', e => {
            sidebarOpacity = parseFloat(e.target.value);
            document.getElementById('devtools-setting-opacity-val').textContent = sidebarOpacity;
            GM_setValue('devtools-sidebar-opacity', sidebarOpacity);
            applySidebarSettings();
        });
        document.getElementById('devtools-setting-auto-inspector').addEventListener('change', e => {
            autoShowInspector = e.target.checked;
            GM_setValue('devtools-auto-inspector', autoShowInspector);
        });
        document.getElementById('devtools-setting-prefetch-post').addEventListener('change', e => {
            prefetchPostForms = e.target.checked;
            GM_setValue('devtools-prefetch-post', prefetchPostForms);
        });
        document.getElementById('devtools-setting-fn-trace').addEventListener('change', e => {
            GM_setValue('devtools-fn-trace', e.target.checked);
        });
        document.getElementById('devtools-setting-dom-observe').addEventListener('change', e => {
            GM_setValue('devtools-dom-observe', e.target.checked);
        });
        document.getElementById('devtools-reset-settings').addEventListener('click', () => {
            if (confirm('确定要重置所有设置吗？')) {
                GM_setValue('devtools-sidebar-mode', isMobile ? 'overlay' : 'push');
                GM_setValue('devtools-visual-width', isMobile ? 320 : 420);
                GM_setValue('devtools-sidebar-zoom', isMobile ? 0.9 : 1);
                GM_setValue('devtools-sidebar-opacity', 1);
                GM_setValue('devtools-dark-theme', false);
                GM_setValue('devtools-auto-inspector', false);
                GM_setValue('devtools-prefetch-post', false);
                GM_setValue('devtools-fn-trace', false);
                GM_setValue('devtools-dom-observe', false);
                location.reload();
            }
        });
        document.addEventListener('click', e => {
            const panel = document.getElementById('devtools-settings-panel');
            const btn = document.getElementById('devtools-settings-btn');
            if (panel && !panel.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
                panel.classList.remove('show');
            }
        });
        document.getElementById('devtools-theme-btn').addEventListener('click', toggleTheme);
        document.getElementById('devtools-close-btn').addEventListener('click', toggleSidebar);
        document.getElementById('devtools-console-search').addEventListener('input', e => {
            searchQuery = e.target.value.toLowerCase();
            renderLogs();
        });
        document.getElementById('devtools-console-clear').addEventListener('click', clearConsole);

        const consoleInput = document.getElementById('devtools-console-input');
        consoleInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                const cmd = consoleInput.value.trim();
                if (cmd) {
                    cmdHistory.push(cmd);
                    if (cmdHistory.length > 100) cmdHistory.shift();
                    cmdIndex = cmdHistory.length;
                    executeConsoleCommand(cmd);
                    consoleInput.value = '';
                }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (cmdHistory.length > 0) {
                    cmdIndex = Math.max(0, cmdIndex - 1);
                    consoleInput.value = cmdHistory[cmdIndex] || '';
                }
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (cmdHistory.length > 0) {
                    cmdIndex = Math.min(cmdHistory.length, cmdIndex + 1);
                    consoleInput.value = cmdHistory[cmdIndex] || '';
                }
            }
        });

        document.querySelectorAll('[data-filter]').forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.dataset.filter === 'all') {
                    const allActive = Object.values(activeLogFilters).every(v => v);
                    Object.keys(activeLogFilters).forEach(key => activeLogFilters[key] = !allActive);
                    document.querySelectorAll('[data-filter]').forEach(b => {
                        b.classList.toggle('active', b.dataset.filter === 'all' ? !allActive : activeLogFilters[b.dataset.filter]);
                    });
                } else {
                    activeLogFilters[btn.dataset.filter] = !activeLogFilters[btn.dataset.filter];
                    btn.classList.toggle('active', activeLogFilters[btn.dataset.filter]);
                }
                renderLogs();
            });
        });
        document.getElementById('devtools-element-selector-btn').addEventListener('click', toggleElementSelection);
        document.getElementById('devtools-elements-refresh').addEventListener('click', () => {
            elementTreeRendered = false;
            renderElementTree();
        });
        document.getElementById('devtools-copy-page-source-btn').addEventListener('click', () => {
            copyToClipboard(document.documentElement.outerHTML);
        });
        document.getElementById('devtools-network-clear').addEventListener('click', clearNetwork);

        let isNetworkPaused = false;
        document.getElementById('devtools-network-pause').addEventListener('click', function() {
            isNetworkPaused = !isNetworkPaused;
            this.textContent = isNetworkPaused ? '继续' : '暂停';
            window.__networkPaused = isNetworkPaused;
        });

        document.getElementById('devtools-network-type-filter').addEventListener('change', renderNetworkRequests);
        document.getElementById('devtools-network-search').addEventListener('input', renderNetworkRequests);

        // 网络列表点击查看详情
        const networkList = document.getElementById('devtools-network-list');
        networkList.addEventListener('click', function(e) {
            const item = e.target.closest('.devtools-network-item');
            if (!item) return;
            const reqId = item.dataset.reqId;
            if (reqId) window.devtoolsShowNetworkDetails(reqId);
        });

        document.querySelectorAll('.devtools-tools-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.devtools-tools-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                activeToolTab = tab.dataset.tab;
                renderToolContent();
            });
        });
        document.querySelectorAll('.devtools-resource-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.devtools-resource-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                activeResourceTab = tab.dataset.tab;
                renderResourceContent();
            });
        });
    }

    // ============ 元素树事件 ============
    function initTreeEventDelegation() {
        const tree = document.getElementById('devtools-element-tree');
        if (!tree) return;

        tree.addEventListener('click', e => {
            const node = e.target.closest('.devtools-tree-node');
            if (!node) return;
            e.stopPropagation();
            if (longPressTriggered) { longPressTriggered = false; return; }

            const id = node.dataset.elementId;
            const element = findElementById(id);
            if (element) {
                highlightElement(element);
                selectTreeNode(node);
                const inspPanel = document.getElementById('devtools-element-inspector');
                if (inspPanel && inspPanel.classList.contains('visible')) {
                    renderElementInspector(element);
                } else if (autoShowInspector) {
                    renderElementInspector(element);
                }
            }

            const toggle = node.querySelector('.devtools-tree-toggle');
            const children = node.nextElementSibling;
            if (toggle && children && children.classList.contains('devtools-tree-children')) {
                if (toggle.textContent === '▶') {
                    toggle.textContent = '▼';
                    children.classList.add('open');
                    expandedNodes.add(id);
                } else {
                    toggle.textContent = '▶';
                    children.classList.remove('open');
                    expandedNodes.delete(id);
                }
            }
        });

        tree.addEventListener('contextmenu', e => {
            const node = e.target.closest('.devtools-tree-node');
            if (!node) return;
            e.preventDefault();
            e.stopPropagation();
            const id = node.dataset.elementId;
            const element = findElementById(id);
            if (element) {
                highlightElement(element);
                selectTreeNode(node);
                showContextMenu(e.clientX, e.clientY, element);
            }
        });

        tree.addEventListener('touchstart', e => {
            const node = e.target.closest('.devtools-tree-node');
            if (!node) return;
            longPressTriggered = false;
            clearTimeout(longPressTimer);
            longPressTimer = setTimeout(() => {
                longPressTriggered = true;
                const id = node.dataset.elementId;
                const element = findElementById(id);
                if (element) {
                    highlightElement(element);
                    selectTreeNode(node);
                    const touch = e.touches[0];
                    showContextMenu(touch.clientX, touch.clientY, element);
                }
            }, 500);
        }, { passive: true });

        tree.addEventListener('touchend', () => clearTimeout(longPressTimer));
        tree.addEventListener('touchmove', () => clearTimeout(longPressTimer), { passive: true });
    }

    // ============ 上下文菜单 ============
    function initContextMenuEvents() {
        const menu = document.getElementById('devtools-context-menu');
        const backdrop = document.getElementById('devtools-context-backdrop');

        menu?.addEventListener('click', e => {
            const item = e.target.closest('.devtools-context-menu-item');
            if (!item) return;
            const action = item.dataset.action;
            const el = window.__contextElement;
            if (action === 'inspectElement' && el) {
                renderElementInspector(el);
            } else if (action && el) {
                performCopyAction(action, el);
            }
            hideContextMenu();
        });

        // 全局点击关闭
        document.addEventListener('click', e => {
            if (menu && menu.classList.contains('show')) {
                if (!menu.contains(e.target)) {
                    hideContextMenu();
                }
            }
        });

    }

    function showContextMenu(x, y, element) {
        window.__contextElement = element;
        const menu = document.getElementById('devtools-context-menu');
        const backdrop = document.getElementById('devtools-context-backdrop');
        if (!menu || !backdrop) return;
        menu.classList.add('show');
        backdrop.classList.add('show');
        const menuW = menu.offsetWidth;
        const menuH = menu.offsetHeight;
        let posX = x, posY = y;
        if (x + menuW > window.innerWidth) posX = window.innerWidth - menuW - 4;
        if (y + menuH > window.innerHeight) posY = window.innerHeight - menuH - 4;
        posX = Math.max(4, posX);
        posY = Math.max(4, posY);
        menu.style.left = posX + 'px';
        menu.style.top = posY + 'px';
    }

    function hideContextMenu() {
        document.getElementById('devtools-context-menu')?.classList.remove('show');
        document.getElementById('devtools-context-backdrop')?.classList.remove('show');
        window.__contextElement = null;
    }

    function performCopyAction(action, element) {
        let text = '';
        try {
            switch (action) {
                case 'copyElement': case 'copyOuterHTML': text = element.outerHTML; break;
                case 'copySelector': text = getUniqueSelector(element); break;
                case 'copyJSPath': text = getJSPath(element); break;
                case 'copyStyles': text = getComputedStyles(element); break;
                case 'copyXPath': text = getXPath(element, false); break;
                case 'copyFullXPath': text = getXPath(element, true); break;
            }
        } catch (e) { text = '获取失败: ' + e.message; }
        if (text) copyToClipboard(text);
    }

    function copyToClipboard(text) {
        if (!text) { showToast('复制失败：无内容'); return; }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => showToast('已复制')).catch(() => fallbackCopy(text));
        } else fallbackCopy(text);
    }

    function fallbackCopy(text) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;z-index:-1;';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        textarea.setSelectionRange(0, 999999);
        let success = false;
        try { success = document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(textarea);
        if (success) showToast('已复制'); else showToast('复制失败，请手动复制');
    }

    function showToast(msg) {
        const existing = document.getElementById('devtools-toast');
        if (existing) existing.remove();
        const toast = document.createElement('div');
        toast.id = 'devtools-toast';
        toast.textContent = msg;
        toast.style.cssText = 'position:fixed;bottom:60px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.8);color:#fff;padding:8px 20px;border-radius:20px;font-size:12px;z-index:2147483648;pointer-events:none;transition:opacity 0.3s;font-family:sans-serif;';
        document.body.appendChild(toast);
        setTimeout(() => { toast.style.opacity = '0'; }, 1200);
        setTimeout(() => { toast.remove(); }, 1500);
    }

    // ============ 侧边栏控制 ============
    function applySidebarSettings() {
        const sidebar = document.getElementById('devtools-sidebar');
        const toggleBtn = document.getElementById('devtools-toggle-btn');
        const settingsPanel = document.getElementById('devtools-settings-panel');
        const actualWidth = Math.round(visualWidth / sidebarZoom);
        if (sidebar) {
            sidebar.style.setProperty('width', actualWidth + 'px', 'important');
            sidebar.style.setProperty('zoom', sidebarZoom, 'important');
            sidebar.style.setProperty('opacity', sidebarOpacity, 'important');
            sidebar.style.setProperty('right', isOpen ? '0px' : '-' + actualWidth + 'px', 'important');
        }
        if (toggleBtn) {
            toggleBtn.style.setProperty('right', isOpen ? (visualWidth / sidebarZoom) + 'px' : '0px', 'important');
        }
        // 设置面板反向缩放，使其不受 sidebar zoom 影响
        if (settingsPanel) {
            if (sidebarZoom !== 1) {
                settingsPanel.style.setProperty('zoom', (1 / sidebarZoom).toFixed(3), 'important');
            } else {
                settingsPanel.style.removeProperty('zoom');
            }
        }
        if (isOpen && sidebarMode === 'push') {
            document.body.classList.add('devtools-body-pushed');
            document.body.style.marginRight = visualWidth + 'px';
        } else {
            document.body.classList.remove('devtools-body-pushed');
            document.body.style.marginRight = '';
        }
    }

    function toggleSidebar() {
        isOpen = !isOpen;
        const sidebar = document.getElementById('devtools-sidebar');
        const toggleBtn = document.getElementById('devtools-toggle-btn');
        if (isOpen) {
            sidebar.classList.add('open');
            toggleBtn.classList.add('open');
            toggleBtn.innerHTML = SVG.close;
            applySidebarSettings();
            if (activeTab === 'elements' && !elementTreeRendered) { renderElementTree(); elementTreeRendered = true; }
            if (activeTab === 'tools') renderToolContent();
            if (activeTab === 'resources') renderResourceContent();
            if (activeTab === 'performance') renderPerformanceContent();
        } else {
            sidebar.classList.remove('open');
            toggleBtn.classList.remove('open');
            toggleBtn.innerHTML = SVG.menu;
            const actualWidth = Math.round(visualWidth / sidebarZoom);
            sidebar.style.setProperty('right', '-' + actualWidth + 'px', 'important');
            toggleBtn.style.setProperty('right', '0px', 'important');
            document.body.classList.remove('devtools-body-pushed');
            document.body.style.marginRight = '';
            stopElementSelection();
        }
    }

    function toggleTheme() {
        isDarkTheme = !isDarkTheme;
        GM_setValue('devtools-dark-theme', isDarkTheme);
        const sidebar = document.getElementById('devtools-sidebar');
        const themeBtn = document.getElementById('devtools-theme-btn');
        if (isDarkTheme) {
            sidebar.classList.add('dark-theme');
            document.body.classList.add('dark-theme');
            themeBtn.innerHTML = SVG.sun;
        } else {
            sidebar.classList.remove('dark-theme');
            document.body.classList.remove('dark-theme');
            themeBtn.innerHTML = SVG.moon;
        }
    }

    function switchTab(tabId) {
        activeTab = tabId;
        document.querySelectorAll('.devtools-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
        document.querySelectorAll('.devtools-panel').forEach(p => p.classList.toggle('active', p.id === 'devtools-panel-' + tabId));
        // 切换离开元素面板时，清除高亮覆盖层
        if (tabId !== 'elements') {
            const overlay = document.getElementById('devtools-highlight-overlay');
            if (overlay) overlay.style.display = 'none';
            stopElementSelection();
        }
        if (tabId === 'elements' && !elementTreeRendered) { renderElementTree(); elementTreeRendered = true; }
        if (tabId === 'tools') renderToolContent();
        if (tabId === 'resources') renderResourceContent();
        if (tabId === 'performance') renderPerformanceContent();
    }

    function adjustZoom(delta) {
        const slider = document.getElementById('devtools-setting-zoom');
        const valSpan = document.getElementById('devtools-setting-zoom-val');
        let newZoom = Math.round((sidebarZoom + delta) * 100) / 100;
        newZoom = Math.max(0.5, Math.min(1.5, newZoom));
        sidebarZoom = newZoom;
        slider.value = newZoom;
        valSpan.textContent = newZoom.toFixed(2) + 'x';
        GM_setValue('devtools-sidebar-zoom', newZoom);
        applySidebarSettings();
    }

    // ============ 控制台 ============
    function hijackConsole() {
        ['log', 'warn', 'error', 'info'].forEach(type => {
            const original = console[type];
            console[type] = function(...args) {
                addLog(type, args);
                original.apply(console, args);
            };
        });
    }

    function addLog(type, args) {
        const message = args.map(arg => typeof arg === 'object' ? safeStringify(arg) : String(arg)).join(' ');
        logs.push({ type, message, time: new Date().toLocaleTimeString(), id: 'log-' + Date.now() + Math.random() });
        if (logs.length > 500) logs.shift();
        renderLogs();
    }

    function renderLogs() {
        const container = document.getElementById('devtools-console-logs');
        if (!container) return;
        const filtered = logs.filter(log => {
            if (!activeLogFilters[log.type]) return false;
            if (searchQuery && !log.message.toLowerCase().includes(searchQuery)) return false;
            return true;
        });
        container.innerHTML = filtered.map(log => {
            const isExpanded = expandedObjects.has(log.id);
            const isObject = log.message.startsWith('{') || log.message.startsWith('[');
            const displayMessage = isExpanded
                ? '<pre style="margin:4px 0 0 20px;white-space:pre-wrap;font-size:11px;">' + escapeHtml(log.message) + '</pre>'
                : escapeHtml(log.message.length > 500 ? log.message.slice(0, 500) + '...' : log.message);
            const toggleHtml = isObject
                ? '<span class="devtools-log-toggle" onclick="event.stopPropagation();window.devtoolsToggleObject(\'' + log.id.replace(/'/g, "\\'") + '\')">' + (isExpanded ? '▼' : '▶') + '</span>'
                : '';
            return '<div class="devtools-log-item ' + escapeHtml(log.type) + '"><span style="color:#666;margin-right:8px;font-size:10px;">[' + escapeHtml(log.time) + ']</span>' + toggleHtml + '<span>' + displayMessage + '</span></div>';
        }).join('');
        container.scrollTop = container.scrollHeight;
    }

    window.devtoolsToggleObject = function(id) {
        if (expandedObjects.has(id)) expandedObjects.delete(id);
        else expandedObjects.add(id);
        renderLogs();
    };

    function executeConsoleCommand(command) {
        if (!command.trim()) return;
        try {
            const result = (function() { return eval(command); }).call(window);
            addLog('log', ['->', result]);
        } catch (e) {
            addLog('error', ['[错误]', e.toString()]);
        }
    }

    function clearConsole() {
        logs = [];
        expandedObjects.clear();
        renderLogs();
    }

    // ============ 网络监控 ============
    function hijackNetwork() {
        const originalFetch = window.fetch;
        window.fetch = function(...args) {
            if (window.__networkPaused) return originalFetch.apply(this, args);
            const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
            const method = (args[1]?.method) || 'GET';
            const startTime = Date.now();
            const id = Date.now() + Math.random().toString(36).substr(2, 9);
            const requestData = {
                id, method, url, status: 'pending', startTime, endTime: null, duration: null,
                type: 'xhr',
                requestHeaders: args[1]?.headers ? safeStringify(args[1].headers) : null,
                requestBody: args[1]?.body ? (typeof args[1].body === 'string' ? args[1].body : safeStringify(args[1].body)) : null
            };
            networkRequests.push(requestData);
            trimNetworkRequests();
            renderNetworkRequests();
            return originalFetch.apply(this, args).then(async response => {
                const req = networkRequests.find(r => r.id === id);
                if (req) {
                    req.status = response.status;
                    req.endTime = Date.now();
                    req.duration = req.endTime - req.startTime;
                    try {
                        const cloned = response.clone();
                        const text = await cloned.text();
                        req.responseHeaders = safeStringify(Object.fromEntries(cloned.headers.entries()));
                        req.responseBody = text;
                        networkResponseMap.set(id, text);
                    } catch {}
                }
                renderNetworkRequests();
                return response;
            }).catch(error => {
                const req = networkRequests.find(r => r.id === id);
                if (req) {
                    req.status = '错误';
                    req.endTime = Date.now();
                    req.duration = req.endTime - req.startTime;
                }
                renderNetworkRequests();
                throw error;
            });
        };

        const originalOpen = XMLHttpRequest.prototype.open;
        const originalSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function(method, url) {
            this._requestMethod = method;
            this._requestUrl = url;
            this._requestId = Date.now() + Math.random().toString(36).substr(2, 9);
            return originalOpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function(body) {
            if (window.__networkPaused) return originalSend.apply(this, arguments);
            const startTime = Date.now();
            const id = this._requestId;
            const requestData = {
                id, method: this._requestMethod || 'GET', url: this._requestUrl,
                status: 'pending', startTime, endTime: null, duration: null,
                type: 'xhr',
                requestBody: body ? (typeof body === 'string' ? body : safeStringify(body)) : null
            };
            networkRequests.push(requestData);
            trimNetworkRequests();
            renderNetworkRequests();
            const self = this;
            this.addEventListener('load', function() {
                const req = networkRequests.find(r => r.id === id);
                if (req) {
                    req.status = self.status;
                    req.endTime = Date.now();
                    req.duration = req.endTime - req.startTime;
                    req.responseBody = self.responseText;
                    networkResponseMap.set(id, self.responseText);
                    try {
                        const headers = {};
                        self.getAllResponseHeaders().split(/\r?\n/).forEach(line => {
                            const parts = line.split(': ');
                            if (parts.length > 1) headers[parts[0]] = parts[1];
                        });
                        req.responseHeaders = safeStringify(headers);
                    } catch {}
                }
                renderNetworkRequests();
            });
            this.addEventListener('error', function() {
                const req = networkRequests.find(r => r.id === id);
                if (req) {
                    req.status = '错误';
                    req.endTime = Date.now();
                    req.duration = req.endTime - req.startTime;
                }
                renderNetworkRequests();
            });
            return originalSend.apply(this, arguments);
        };

        // ==== WebSocket 监控 ====
        const OrigWebSocket = window.WebSocket;
        window.WebSocket = function(url, protocols) {
            const ws = protocols ? new OrigWebSocket(url, protocols) : new OrigWebSocket(url);
            const id = Date.now() + Math.random().toString(36).substr(2, 9);
            const startTime = Date.now();
            const req = {
                id, method: 'WS', url, status: 'pending', startTime,
                type: 'websocket', messages: []
            };
            networkRequests.push(req);
            trimNetworkRequests();
            renderNetworkRequests();
            const origSend = ws.send;
            ws.send = function(data) {
                req.messages.push({ direction: 'sent', data: typeof data === 'string' ? data : safeStringify(data), time: Date.now() });
                origSend.call(ws, data);
            };
            ws.addEventListener('message', e => {
                req.messages.push({ direction: 'received', data: typeof e.data === 'string' ? e.data : safeStringify(e.data), time: Date.now() });
                renderNetworkRequests();
            });
            ws.addEventListener('close', e => {
                req.status = 'closed'; req.endTime = Date.now(); req.duration = req.endTime - startTime;
                renderNetworkRequests();
            });
            ws.addEventListener('error', () => { req.status = 'error'; });
            return ws;
        };

        // ==== Beacon 监控 ====
        const origSendBeacon = navigator.sendBeacon;
        navigator.sendBeacon = function(url, data) {
            const id = Date.now() + Math.random().toString(36).substr(2, 9);
            networkRequests.push({
                id, method: 'POST', url, status: 'sent', startTime: Date.now(),
                type: 'beacon', requestBody: data ? (typeof data === 'string' ? data : safeStringify(data)) : null
            });
            trimNetworkRequests();
            renderNetworkRequests();
            return origSendBeacon.apply(navigator, arguments);
        };

        // ==== SSE 监控 ====
        const OrigEventSource = window.EventSource;
        window.EventSource = function(url, opts) {
            const es = new OrigEventSource(url, opts);
            const id = Date.now() + Math.random().toString(36).substr(2, 9);
            const req = { id, method: 'GET', url, status: 'open', startTime: Date.now(), type: 'sse', messages: [] };
            networkRequests.push(req);
            trimNetworkRequests();
            renderNetworkRequests();
            es.addEventListener('message', e => {
                req.messages.push({ data: e.data, time: Date.now() });
                renderNetworkRequests();
            });
            es.addEventListener('error', () => { req.status = 'error'; renderNetworkRequests(); });
            return es;
        };

        // ==== 资源加载监控（Performance API） ====
        if (window.PerformanceObserver) {
            try {
            const po = new PerformanceObserver(list => {
                list.getEntries().forEach(entry => {
                    if (entry.name.startsWith('http')) {
                        const id = entry.name + '-' + entry.startTime;
                        if (!networkRequests.some(r => r.id === id)) {
                            networkRequests.push({
                                id, method: 'GET', url: entry.name,
                                status: entry.transferSize ? 200 : 0,
                                startTime: entry.startTime, duration: entry.duration,
                                type: 'resource',
                                initiatorType: entry.initiatorType,
                                transferSize: entry.transferSize,
                                encodedBodySize: entry.encodedBodySize,
                                decodedBodySize: entry.decodedBodySize
                            });
                            trimNetworkRequests();
                            renderNetworkRequests();
                        }
                    }
                });
            });
            po.observe({ type: 'resource', buffered: true });
            
            // 立即获取已存在的资源条目（页面初始加载的资源）
            performance.getEntriesByType('resource').forEach(entry => {
                if (entry.name.startsWith('http')) {
                    const id = entry.name + '-' + entry.startTime;
                    if (!networkRequests.some(r => r.id === id)) {
                        networkRequests.push({
                            id, method: 'GET', url: entry.name,
                            status: entry.transferSize ? 200 : 0,
                            startTime: entry.startTime, duration: entry.duration,
                            type: 'resource',
                            initiatorType: entry.initiatorType,
                            transferSize: entry.transferSize,
                            encodedBodySize: entry.encodedBodySize,
                            decodedBodySize: entry.decodedBodySize
                        });
                    }
                }
            });
            trimNetworkRequests();
            renderNetworkRequests();
            } catch(e) {}
        }
    }

    function renderNetworkRequests() {
        const container = document.getElementById('devtools-network-list');
        if (!container) return;
        const typeFilter = document.getElementById('devtools-network-type-filter')?.value || 'all';
        const searchText = (document.getElementById('devtools-network-search')?.value || '').toLowerCase();

        const filtered = networkRequests.filter(req => {
            if (typeFilter !== 'all') {
                // 特殊类型
                if (typeFilter === 'WS' && req.type !== 'websocket') return false;
                if (typeFilter === 'Beacon' && req.type !== 'beacon') return false;
                if (typeFilter === 'SSE' && req.type !== 'sse') return false;
                if (typeFilter === 'Nav' && req.type !== 'navigation') return false;

                if (typeFilter === 'XHR' || typeFilter === 'JS' || typeFilter === 'CSS' || typeFilter === 'Img' || typeFilter === 'Other') {
                    if (req.type === 'xhr' || req.type === 'websocket' || req.type === 'sse' || req.type === 'beacon' || req.type === 'navigation') {
                        // 对于明确的请求类型，直接按类型判断
                        if (typeFilter === 'XHR' && req.type === 'xhr') return true;
                        if (typeFilter === 'Other' && req.type !== 'xhr') return true;
                        return false;
                    }
                    // 资源类请求
                    if (req.type === 'resource') {
                        const initType = req.initiatorType || '';
                        if (typeFilter === 'JS') return initType === 'script' || /\.js(\?|$)/.test(req.url);
                        if (typeFilter === 'CSS') return initType === 'css' || /\.css(\?|$)/.test(req.url);
                        if (typeFilter === 'Img') return initType === 'img' || initType === 'image' || /\.(png|jpg|jpeg|gif|svg|webp|ico)(\?|$)/.test(req.url);
                        if (typeFilter === 'Other') {
                            // 不是 JS/CSS/Img 的资源（如 font, media 等）
                            if (initType === 'script' || initType === 'css' || initType === 'img' || initType === 'image') return false;
                            if (/\.(js|css|png|jpg|jpeg|gif|svg|webp|ico)(\?|$)/.test(req.url)) return false;
                            return true;
                        }
                        if (typeFilter === 'XHR') return false; // 资源类不属于 XHR
                    }
                }
            }
            if (searchText && !req.url.toLowerCase().includes(searchText)) return false;
            return true;
        });

        container.innerHTML = filtered.map(req => {
            return '<div class="devtools-network-item" data-req-id="' + req.id.replace(/"/g, '&quot;') + '"><span class="devtools-network-method">' + escapeHtml(req.method) + '</span><span class="devtools-network-url">' + escapeHtml(req.url) + '</span></div>';
        }).join('');
    }

    window.devtoolsShowNetworkDetails = function(id) {
        const req = networkRequests.find(r => r.id === id);
        if (!req) return;
        // 隐藏网络列表和筛选栏，显示全屏详情
        document.getElementById('devtools-network-list-wrapper').style.display = 'none';
        document.getElementById('devtools-network-toolbar').style.display = 'none';
        const fullDiv = document.getElementById('devtools-network-details-full');
        fullDiv.style.display = 'block';

        const summaryTab = '<div class="devtools-details-tab-content active" id="devtools-net-tab-summary"><div class="devtools-details-item"><div class="devtools-details-label">状态码</div><div class="devtools-details-value">' + escapeHtml(req.status) + '</div></div><div class="devtools-details-item"><div class="devtools-details-label">耗时</div><div class="devtools-details-value">' + escapeHtml(req.duration ? req.duration + 'ms' : '-') + '</div></div><div class="devtools-details-item"><div class="devtools-details-label">类型</div><div class="devtools-details-value">' + escapeHtml(req.type || 'xhr') + '</div></div><div class="devtools-details-item"><div class="devtools-details-label">URL</div><div class="devtools-details-value" style="word-break:break-all;">' + escapeHtml(req.url) + '</div></div></div>';
        const requestTab = '<div class="devtools-details-tab-content" id="devtools-net-tab-request">' + (req.requestHeaders ? '<div class="devtools-details-item"><div class="devtools-details-label">请求头</div><div class="devtools-details-value"><pre style="margin:0;white-space:pre-wrap;font-size:10px;">' + escapeHtml(req.requestHeaders) + '</pre></div></div>' : '') + (req.requestBody ? '<div class="devtools-details-item"><div class="devtools-details-label">请求体</div><div class="devtools-details-value"><pre style="margin:0;white-space:pre-wrap;font-size:10px;">' + escapeHtml(req.requestBody) + '</pre></div></div>' : '') + '</div>';
        const responseBodyDisplay = escapeHtml(req.responseBody && req.responseBody.length > 5000 ? req.responseBody.substring(0, 5000) + '\n\n[内容已截断...]' : (req.responseBody || '无响应体'));
        const responseTab = '<div class="devtools-details-tab-content" id="devtools-net-tab-response">' + (req.responseHeaders ? '<div class="devtools-details-item"><div class="devtools-details-label">响应头</div><div class="devtools-details-value"><pre style="margin:0;white-space:pre-wrap;font-size:10px;">' + escapeHtml(req.responseHeaders) + '</pre></div></div>' : '') + '<div class="devtools-details-item"><div class="devtools-details-label">响应体</div><div class="devtools-details-value"><pre style="margin:0;white-space:pre-wrap;font-size:10px;max-height:400px;overflow:auto;">' + responseBodyDisplay + '</pre></div></div></div>';

        fullDiv.innerHTML = '<div class="devtools-details-back" id="devtools-net-back">← 返回列表</div><div class="devtools-details-header"><span class="devtools-details-title">' + escapeHtml(req.method) + ' ' + escapeHtml(req.url.length > 60 ? req.url.substring(0, 60) + '...' : req.url) + '</span></div><div class="devtools-details-tabs"><div class="devtools-details-tab active" onclick="window.devtoolsSwitchNetTab(\'summary\',this)">概要</div><div class="devtools-details-tab" onclick="window.devtoolsSwitchNetTab(\'request\',this)">请求</div><div class="devtools-details-tab" onclick="window.devtoolsSwitchNetTab(\'response\',this)">响应</div></div>' + summaryTab + requestTab + responseTab;

        document.getElementById('devtools-net-back').addEventListener('click', window.devtoolsHideNetworkDetails);
    };

    window.devtoolsSwitchNetTab = function(tab, el) {
        el.parentElement.querySelectorAll('.devtools-details-tab').forEach(t => t.classList.remove('active'));
        el.classList.add('active');
        document.querySelectorAll('#devtools-network-details-full .devtools-details-tab-content').forEach(c => c.classList.remove('active'));
        document.getElementById('devtools-net-tab-' + tab).classList.add('active');
    };

    window.devtoolsHideNetworkDetails = function() {
        document.getElementById('devtools-network-details-full').style.display = 'none';
        document.getElementById('devtools-network-list-wrapper').style.display = '';
        document.getElementById('devtools-network-toolbar').style.display = '';
    };

    function hijackNavigation() {
        try {
        // 保存原始方法引用
        const origAssign = window.location.assign.bind(window.location);
        const origReplace = window.location.replace.bind(window.location);
        const origReload = window.location.reload.bind(window.location);
        const origFormSubmit = HTMLFormElement.prototype.submit;

        // 保存原始 href 属性描述符
        const origHrefDesc = Object.getOwnPropertyDescriptor(window.location, 'href');
        if (!origHrefDesc || !origHrefDesc.get || !origHrefDesc.set) return;
        const origGetHref = origHrefDesc.get;
        const origSetHref = origHrefDesc.set;

        // 劫持 location.assign
        window.location.assign = function(url) {
            const id = Date.now() + Math.random().toString(36).substr(2, 9);
            networkRequests.push({ id, method: 'GET', url, status: 'navigating', startTime: Date.now(), type: 'navigation' });
            trimNetworkRequests();
            renderNetworkRequests();
            saveLogsForNavigation();
            origAssign(url);
        };
        // 劫持 location.replace
        window.location.replace = function(url) {
            const id = Date.now() + Math.random().toString(36).substr(2, 9);
            networkRequests.push({ id, method: 'GET', url, status: 'navigating', startTime: Date.now(), type: 'navigation' });
            trimNetworkRequests();
            renderNetworkRequests();
            saveLogsForNavigation();
            origReplace(url);
        };
        // 劫持 location.reload
        window.location.reload = function(force) {
            const id = Date.now() + Math.random().toString(36).substr(2, 9);
            networkRequests.push({ id, method: 'GET', url: origGetHref.call(window.location), status: 'navigating', startTime: Date.now(), type: 'navigation' });
            renderNetworkRequests();
            saveLogsForNavigation();
            origReload(force);
        };
        // 劫持 location.href setter （使用原始描述符）
        Object.defineProperty(window.location, 'href', {
            get: function() { return origGetHref.call(window.location); },
            set: function(url) {
                const id = Date.now() + Math.random().toString(36).substr(2, 9);
                networkRequests.push({ id, method: 'GET', url, status: 'navigating', startTime: Date.now(), type: 'navigation' });
                trimNetworkRequests();
                renderNetworkRequests();
                saveLogsForNavigation();
                origSetHref.call(window.location, url);
            },
            configurable: true
        });
        // 劫持 window.open
        const origOpen = window.open;
        window.open = function(url, target, features) {
            const id = Date.now() + Math.random().toString(36).substr(2, 9);
            networkRequests.push({
                id, method: 'GET', url, status: 'opened', startTime: Date.now(),
                type: 'navigation', windowName: target
            });
            trimNetworkRequests();
            renderNetworkRequests();
            return origOpen.call(window, url, target, features);
        };
        // 劫持 <a> 点击（仅左键、非修饰键、target=_self 或无）
        document.addEventListener('click', function(e) {
            const a = e.target.closest('a');
            if (a && a.href && !a.hasAttribute('data-devtools-ignore') && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.button) {
                if (a.target && a.target !== '_self') return;
                e.preventDefault();
                // 直接记录导航请求，不额外 fetch
                const id = Date.now() + Math.random().toString(36).substr(2, 9);
                networkRequests.push({
                    id, method: 'GET', url: a.href, status: 'navigating',
                    startTime: Date.now(), type: 'navigation'
                });
                renderNetworkRequests();
                saveLogsForNavigation();
                origAssign(a.href); // 直接跳转，不额外 fetch
            }
        }, true);
        // 劫持 <form> 提交
        document.addEventListener('submit', function(e) {
            const form = e.target;
            if (form.tagName !== 'FORM' || form.hasAttribute('data-devtools-ignore')) return;
            e.preventDefault();
            const method = (form.method || 'GET').toUpperCase();
            const url = form.action || window.location.href;
            if (prefetchPostForms && method === 'POST') {
                const body = new FormData(form);
                captureNavigation(method, url, null, body, () => { origFormSubmit.call(form); });
            } else {
                const id = Date.now() + Math.random().toString(36).substr(2, 9);
                const bodyStr = method !== 'GET' ? formDataToString(new FormData(form)) : null;
                networkRequests.push({
                    id, method, url, status: 'submitted', startTime: Date.now(),
                    type: 'navigation', requestBody: bodyStr
                });
                trimNetworkRequests();
                saveLogsForNavigation();
                origFormSubmit.call(form);
            }
        }, true);
        // 劫持 history API（记录 SPA 路由）
        const origPush = history.pushState;
        history.pushState = function(state, title, url) {
            addLog('info', ['[Router] pushState:', url, state]);
            origPush.apply(history, arguments);
        };
        const origReplaceState = history.replaceState;
        history.replaceState = function(state, title, url) {
            addLog('info', ['[Router] replaceState:', url, state]);
            origReplaceState.apply(history, arguments);
        };
        window.addEventListener('popstate', e => addLog('info', ['[Router] popstate to:', document.location.href]));
        } catch(e) { /* 跨域 iframe 等环境可能无法劫持 location */ }
    }

    function captureNavigation(method, url, headers, body, navigateFn) {
        const id = Date.now() + Math.random().toString(36).substr(2, 9);
        const req = {
            id, method, url, status: 'pending', startTime: Date.now(),
            type: 'navigation', requestBody: body ? safeStringify(body) : null
        };
        networkRequests.push(req);
        trimNetworkRequests();
        renderNetworkRequests();
        const sameOrigin = (new URL(url, window.location.href)).origin === window.location.origin;
        if (sameOrigin && method === 'GET') {
            fetch(url, { method, headers })
                .then(async res => {
                    const text = await res.text();
                    req.status = res.status;
                    req.endTime = Date.now();
                    req.duration = req.endTime - req.startTime;
                    req.responseBody = text;
                    networkResponseMap.set(id, text);
                    try { req.responseHeaders = safeStringify(Object.fromEntries(res.headers.entries())); } catch {}
                    renderNetworkRequests();
                })
                .catch(err => {
                    req.status = 'error'; req.responseBody = err.toString(); renderNetworkRequests();
                })
                .finally(() => {
                    saveLogsForNavigation();
                    navigateFn();
                });
        } else if (typeof GM_xmlhttpRequest === 'function') {
            // 使用 GM_xmlhttpRequest 捕获跨域/非GET 响应体
            try {
                const options = {
                    method: method,
                    url: url,
                    data: body || null,
                    anonymous: true,
                    timeout: 5000,
                    onload: function(response) {
                        req.status = response.status;
                        req.endTime = Date.now();
                        req.duration = req.endTime - req.startTime;
                        req.responseBody = response.responseText || '';
                        networkResponseMap.set(id, req.responseBody);
                        try { req.responseHeaders = response.responseHeaders || ''; } catch {}
                        renderNetworkRequests();
                        saveLogsForNavigation();
                        navigateFn();
                    },
                    onerror: function(error) {
                        req.status = 'error';
                        req.endTime = Date.now();
                        req.duration = req.endTime - req.startTime;
                        req.responseBody = '请求失败: ' + (error.statusText || '未知错误');
                        renderNetworkRequests();
                        saveLogsForNavigation();
                        navigateFn();
                    },
                    ontimeout: function() {
                        req.status = 'timeout';
                        req.endTime = Date.now();
                        req.duration = req.endTime - req.startTime;
                        req.responseBody = '请求超时';
                        renderNetworkRequests();
                        saveLogsForNavigation();
                        navigateFn();
                    }
                };
                // 如果是 FormData 则不设置 headers（让 GM 自动生成 multipart 边界）
                if (!(body instanceof FormData) && headers) {
                    options.headers = headers;
                }
                GM_xmlhttpRequest(options);
            } catch(e) {
                req.status = 'navigating';
                req.endTime = Date.now();
                req.duration = req.endTime - req.startTime;
                req.responseBody = '无法获取响应体';
                renderNetworkRequests();
                saveLogsForNavigation();
                navigateFn();
            }
        } else {
            req.status = 'navigating';
            req.endTime = Date.now();
            req.duration = req.endTime - req.startTime;
            req.responseBody = '无法获取响应体（跨域或非GET）';
            renderNetworkRequests();
            saveLogsForNavigation();
            navigateFn();
        }
    }

    function clearNetwork() {
        networkRequests = [];
        networkResponseMap.clear();
        renderNetworkRequests();
        document.getElementById('devtools-network-details').style.display = 'none';
    }

    function hijackFunctions() {
        const origAdd = EventTarget.prototype.addEventListener;
        EventTarget.prototype.addEventListener = function(type, listener, options) {
            addLog('info', ['[DevScope] addEventListener:', this, type, listener.toString().substring(0, 100)]);
            return origAdd.call(this, type, listener, options);
        };
        const origSetTimeout = window.setTimeout;
        window.setTimeout = function(fn, delay, ...args) {
            addLog('info', ['[DevScope] setTimeout:', delay + 'ms']);
            return origSetTimeout.call(window, fn, delay, ...args);
        };
    }

    function observeDOM() {
        const observer = new MutationObserver(mutations => {
            for (const m of mutations) {
                if (m.type === 'childList') {
                    addLog('info', ['[DOM] 节点变化:', m.target, m.addedNodes.length, 'added']);
                } else if (m.type === 'attributes') {
                    addLog('info', ['[DOM] 属性变化:', m.target, m.attributeName]);
                }
            }
        });
        observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    }

    // ============ 元素检查 ============
    function renderElementTree() {
        const container = document.getElementById('devtools-element-tree');
        if (!container) return;
        totalNodesRendered = 0;
        container.innerHTML = renderTreeNode(document.documentElement, 0);
        if (totalNodesRendered >= MAX_NODES) {
            container.innerHTML += '<div style="padding:8px;color:#999;font-size:11px;text-align:center;">已限制显示 ' + MAX_NODES + ' 个节点</div>';
        }
        applyExpandedState();
    }

    function renderTreeNode(element, level) {
        const tagName = element.tagName?.toLowerCase() || '';
        if (!tagName || level > 15 || totalNodesRendered >= MAX_NODES) return '';
        totalNodesRendered++;
        const hasChildren = element.children && element.children.length > 0 && level < 15 && totalNodesRendered < MAX_NODES;
        const elementId = getElementId(element);
        const isExpanded = expandedNodes.has(elementId);
        const attrs = getAttributes(element);
        let html = `<div class="devtools-tree-node" data-element-id="${elementId}" data-level="${level}">${hasChildren ? `<span class="devtools-tree-toggle">${isExpanded?'▼':'▶'}</span>` : '<span class="devtools-tree-toggle"> </span>'}<span class="devtools-tag-name">&lt;${tagName}</span>${attrs}<span class="devtools-tag-name">&gt;</span></div>`;

        if (hasChildren) {
            html += `<div class="devtools-tree-children ${isExpanded?'open':''}">`;
            const maxChildren = Math.min(element.children.length, 100);
            for (let i = 0; i < maxChildren; i++) {
                if (totalNodesRendered >= MAX_NODES) {
                    html += '<div style="padding:2px 4px;color:#999;font-size:10px;">节点过多，已截断</div>';
                    break;
                }
                html += renderTreeNode(element.children[i], level + 1);
            }
            html += `</div>`;
        }
        return html;
    }

    function getAttributes(element) {
        let attrs = '';
        const limit = Math.min(element.attributes.length, 8);
        for (let i = 0; i < limit; i++) {
            const attr = element.attributes[i];
            attrs += ` <span class="devtools-attr-name">${escapeHtml(attr.name)}</span>=<span class="devtools-attr-value">"${escapeHtml(attr.value)}"</span>`;
        }
        return attrs;
    }

    function getElementId(element) {
        if (!element.__devtoolsId) {
            element.__devtoolsId = 'el-' + (++elementIdCounter);
        }
        const id = element.__devtoolsId;
        elementIdToElementMap.set(id, element);
        elementToIdMap.set(element, id);
        return id;
    }

    function applyExpandedState() {
        document.querySelectorAll('.devtools-tree-node').forEach(node => {
            const id = node.dataset.elementId;
            const children = node.nextElementSibling;
            const toggle = node.querySelector('.devtools-tree-toggle');
            if (expandedNodes.has(id) && children && children.classList.contains('devtools-tree-children')) {
                children.classList.add('open');
                if (toggle) toggle.textContent = '▼';
            }
        });
    }

    function selectTreeNode(node) {
        document.querySelectorAll('.devtools-tree-node').forEach(n => n.classList.remove('selected'));
        node.classList.add('selected');
    }

    function highlightElement(element) {
        const overlay = document.getElementById('devtools-highlight-overlay');
        if (!element || !overlay) return;
        const rect = element.getBoundingClientRect();
        overlay.style.display = 'block';
        overlay.style.top = rect.top + 'px';
        overlay.style.left = rect.left + 'px';
        overlay.style.width = rect.width + 'px';
        overlay.style.height = rect.height + 'px';
        selectedElement = element;
    }

    function renderElementInspector(element) {
        const container = document.getElementById('devtools-inspector-content');
        const inspPanel = document.getElementById('devtools-element-inspector');
        if (inspPanel) inspPanel.classList.add('visible');
        if (!container) return;
        let html = '<div class="devtools-inspector-section">';
        html += '<div class="devtools-inspector-title" style="margin-bottom:8px;">基本信息</div>';
        html += `<div class="devtools-inspector-prop"><span class="devtools-inspector-key">标签:</span><span class="devtools-inspector-val">&lt;${element.tagName.toLowerCase()}&gt;</span></div>`;
        html += `<div class="devtools-inspector-prop"><span class="devtools-inspector-key">id:</span><span class="devtools-inspector-val">${element.id || '-'}</span></div>`;
        html += `<div class="devtools-inspector-prop"><span class="devtools-inspector-key">class:</span><span class="devtools-inspector-val">${element.className || '-'}</span></div>`;
        html += `<div class="devtools-inspector-prop"><span class="devtools-inspector-key">位置:</span><span class="devtools-inspector-val">${Math.round(element.getBoundingClientRect().left)}, ${Math.round(element.getBoundingClientRect().top)}</span></div>`;
        html += `<div class="devtools-inspector-prop"><span class="devtools-inspector-key">尺寸:</span><span class="devtools-inspector-val">${Math.round(element.offsetWidth)}×${Math.round(element.offsetHeight)}</span></div>`;
        html += '</div>';
        if (element.attributes.length > 0) {
            html += '<div class="devtools-inspector-section">';
            html += '<div class="devtools-inspector-title" style="margin-bottom:8px;">属性</div>';
            for (let i = 0; i < Math.min(element.attributes.length, 15); i++) {
                const attr = element.attributes[i];
                html += `<div class="devtools-inspector-prop"><span class="devtools-inspector-key">${escapeHtml(attr.name)}:</span><span class="devtools-inspector-val">${escapeHtml(attr.value.length>100?attr.value.substring(0,100)+'...':attr.value)}</span></div>`;
            }
            html += '</div>';
        }
        if (element.textContent) {
            html += '<div class="devtools-inspector-section">';
            html += '<div class="devtools-inspector-title" style="margin-bottom:8px;">文本内容</div>';
            const text = element.textContent.trim();
            html += `<div style="word-break:break-all;font-size:10px;">${escapeHtml(text.length>200?text.substring(0,200)+'...':text)}</div>`;
            html += '</div>';
        }
        container.innerHTML = html;
    }

    function toggleElementSelection() {
        if (isSelectingElement) stopElementSelection();
        else startElementSelection();
    }

    function startElementSelection() {
        stopElementSelection();
        isSelectingElement = true;
        document.body.style.cursor = 'crosshair';
        const btn = document.getElementById('devtools-element-selector-btn');
        if (btn) btn.classList.add('active');
        document.addEventListener('mousemove', onElementHoverMove, true);
        document.addEventListener('click', onElementClick, true);
        document.addEventListener('keydown', onEscapeKeydown);
    }

    function stopElementSelection() {
        isSelectingElement = false;
        document.body.style.cursor = '';
        const btn = document.getElementById('devtools-element-selector-btn');
        if (btn) btn.classList.remove('active');
        document.removeEventListener('mousemove', onElementHoverMove, true);
        document.removeEventListener('click', onElementClick, true);
        document.removeEventListener('keydown', onEscapeKeydown);
        // 无条件清除高亮覆盖层
        const overlay = document.getElementById('devtools-highlight-overlay');
        if (overlay) overlay.style.display = 'none';
    }

    function onEscapeKeydown(e) { if (e.key === 'Escape') stopElementSelection(); }

    function onElementHoverMove(e) {
        if (!isSelectingElement) return;
        if (e.target.closest && (e.target.closest('#devtools-sidebar') || e.target.closest('#devtools-toggle-btn'))) return;
        if (window.__highlightRaf) cancelAnimationFrame(window.__highlightRaf);
        window.__highlightRaf = requestAnimationFrame(() => highlightElement(e.target));
    }

    function onElementClick(e) {
        if (!isSelectingElement) return;
        if (e.target.closest && (e.target.closest('#devtools-sidebar') || e.target.closest('#devtools-toggle-btn'))) return;
        e.preventDefault();
        e.stopPropagation();
        const element = e.target;
        try {
            highlightElement(element);
            if (!elementTreeRendered) { renderElementTree(); elementTreeRendered = true; }
            scrollToElementInTree(element);
            if (autoShowInspector) renderElementInspector(element);
            if (activeTab !== 'elements') switchTab('elements');
        } catch (err) { console.error('元素定位失败:', err); }
        setTimeout(() => stopElementSelection(), 300);
    }

    function scrollToElementInTree(element) {
        const elementId = getElementId(element);
        let node = document.querySelector('.devtools-tree-node[data-element-id="' + elementId + '"]');
        if (!node) node = renderPathToElement(element);
        if (!node) return;
        expandParentNodes(node);
        node.scrollIntoView({ behavior: 'smooth', block: 'center' });
        selectTreeNode(node);
    }

    function renderPathToElement(targetElement) {
        const path = [];
        let current = targetElement;
        while (current && current !== document.documentElement) {
            path.unshift(current);
            current = current.parentElement;
        }
        if (current) path.unshift(current);
        path.forEach(el => getElementId(el));
        for (let i = 0; i < path.length - 1; i++) expandedNodes.add(getElementId(path[i]));
        const container = document.getElementById('devtools-element-tree');
        if (!container) return null;
        totalNodesRendered = 0;
        container.innerHTML = renderTreeNode(document.documentElement, 0);
        if (totalNodesRendered >= MAX_NODES) {
            container.innerHTML += '<div style="padding:8px;color:#999;font-size:11px;text-align:center;">已限制显示 ' + MAX_NODES + ' 个节点</div>';
        }
        applyExpandedState();
        return document.querySelector('.devtools-tree-node[data-element-id="' + getElementId(targetElement) + '"]');
    }

    function expandParentNodes(node) {
        let count = 0;
        let parent = node.parentElement;
        while (parent && parent.classList.contains('devtools-tree-children') && count < 15) {
            parent.classList.add('open');
            const prev = parent.previousElementSibling;
            if (prev && prev.classList.contains('devtools-tree-node')) {
                const toggle = prev.querySelector('.devtools-tree-toggle');
                if (toggle) toggle.textContent = '▼';
                expandedNodes.add(prev.dataset.elementId);
            }
            parent = parent.parentElement;
            count++;
        }
    }

    function findElementById(id) {
        return elementIdToElementMap.get(id) || null;
    }

    function getUniqueSelector(el) {
        if (el.id) return '#' + CSS.escape(el.id);
        if (el === document.body) return 'body';
        if (el === document.documentElement) return 'html';
        const path = [];
        let current = el;
        while (current && current !== document.documentElement) {
            let selector = current.tagName.toLowerCase();
            if (current.id) { selector = '#' + CSS.escape(current.id); path.unshift(selector); break; }
            if (current.className && typeof current.className === 'string') {
                const classes = current.className.trim().split(/\s+/).filter(c => c && !c.startsWith('__'));
                if (classes.length > 0) selector += '.' + classes.map(c => CSS.escape(c)).join('.');
            }
            const parent = current.parentElement;
            if (parent) {
                const siblings = Array.from(parent.children).filter(s => s.tagName === current.tagName);
                if (siblings.length > 1) selector += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
            }
            path.unshift(selector);
            current = current.parentElement;
        }
        return path.join(' > ');
    }

    function getJSPath(el) {
        if (el === document.documentElement) return 'document.documentElement';
        if (el === document.body) return 'document.body';
        if (el.id) return "document.getElementById('" + el.id + "')";
        const path = [];
        let current = el;
        while (current && current !== document.documentElement && current !== document.body) {
            const parent = current.parentElement;
            if (!parent) break;
            if (current.id) { path.unshift("document.getElementById('" + current.id + "')"); break; }
            const children = Array.from(parent.children);
            path.unshift('.children[' + children.indexOf(current) + ']');
            current = parent;
        }
        let base = 'document';
        if (current === document.body) base = 'document.body';
        else if (current === document.documentElement) base = 'document.documentElement';
        return base + path.join('');
    }

    function getComputedStyles(el) {
        const computed = window.getComputedStyle(el);
        const props = ['display','position','width','height','margin','padding','background','background-color','color','font-size','font-weight','font-family','line-height','text-align','border','border-radius','box-shadow','opacity','z-index','overflow','flex-direction','justify-content','align-items','gap','top','left','right','bottom','transform','transition','max-width','min-width','max-height','min-height'];
        return props.map(p => {
            const val = computed.getPropertyValue(p);
            return (val && val !== 'none' && val !== 'normal' && val !== '0px' && val !== 'auto') ? p + ': ' + val + ';' : '';
        }).filter(Boolean).join('\n');
    }

    function getXPath(el, full) {
        if (el === document.documentElement) return '/html';
        if (el === document.body) return full ? '/html/body' : '//body';
        const parts = [];
        let current = el;
        while (current && current !== document.documentElement) {
            let index = 1;
            const parent = current.parentElement;
            let hasSameTagSiblings = false;
            if (parent) {
                const siblings = parent.children;
                for (let i = 0; i < siblings.length; i++) {
                    if (siblings[i] === current) break;
                    if (siblings[i].tagName === current.tagName) index++;
                }
                hasSameTagSiblings = parent.querySelectorAll(':scope > ' + current.tagName).length > 1;
            }
            parts.unshift(hasSameTagSiblings ? current.tagName.toLowerCase() + '[' + index + ']' : current.tagName.toLowerCase());
            current = current.parentElement;
        }
        parts.unshift('html');
        return full ? '/' + parts.join('/') : (parts.indexOf('body') >= 0 ? '//' + parts.slice(parts.indexOf('body')).join('/') : '//' + parts.join('/'));
    }

    // ============ 工具面板 ============
    function renderToolContent() {
        const container = document.getElementById('devtools-tools-content');
        if (!container) return;
        switch (activeToolTab) {
            case 'regex': renderRegexTool(); break;
            case 'selector': renderSelectorTool(); break;
            case 'json': renderJsonTool(); break;
            case 'string': renderStringTool(); break;
            case 'request': renderRequestTool(); break;
        }
    }

    window.devtoolsCopyToolResult = function(containerId) {
        const container = document.getElementById(containerId);
        if (container) {
            const text = container.innerText || container.textContent;
            navigator.clipboard.writeText(text).then(() => showToast('已复制')).catch(() => showToast('复制失败'));
        }
    };

    function renderRegexTool() {
        const container = document.getElementById('devtools-tools-content');
        container.innerHTML = '<div class="devtools-input-group"><label class="devtools-input-label">正则表达式</label><input type="text" class="devtools-input" id="devtools-regex-pattern" placeholder="例如: \\d+ 或 /\\w+/gi"></div><div class="devtools-input-group"><label class="devtools-input-label">测试文本</label><textarea class="devtools-textarea" id="devtools-regex-text" placeholder="输入要测试的文本..."></textarea></div><button class="devtools-tool-btn primary" onclick="window.devtoolsTestRegex()">测试</button><div id="devtools-regex-result"></div>';
    }

    window.devtoolsTestRegex = function() {
        const pattern = document.getElementById('devtools-regex-pattern').value;
        const text = document.getElementById('devtools-regex-text').value;
        const resultDiv = document.getElementById('devtools-regex-result');
        if (!pattern || !text) { resultDiv.innerHTML = '<div class="devtools-result-box" style="color:#c00;">请输入正则表达式和测试文本</div>'; return; }
        try {
            let regex;
            if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
                const parts = pattern.match(/^\/(.+)\/([gimsuy]*)$/);
                if (parts) {
                    const flags = parts[2].includes('g') ? parts[2] : parts[2] + 'g';
                    regex = new RegExp(parts[1], flags);
                } else {
                    regex = new RegExp(pattern, 'g');
                }
            } else {
                regex = new RegExp(pattern, 'g');
            }
            const matches = [];
            let match;
            while ((match = regex.exec(text)) !== null) {
                matches.push({ full: match[0], index: match.index, groups: match.slice(1) });
                if (matches.length > 100) break;
            }
            if (matches.length === 0) { resultDiv.innerHTML = '<div class="devtools-result-box">无匹配结果</div>'; return; }
            let html = '<div class="devtools-result-box">找到 ' + matches.length + ' 个匹配</div>';
            matches.forEach((m, i) => {
                html += '<div style="margin:4px 0;padding:6px;background:var(--bg-hover,#f5f5f5);border-radius:3px;"><div><strong>匹配 ' + (i+1) + ':</strong> <span class="devtools-match">' + escapeHtml(m.full) + '</span></div><div>位置: ' + m.index + '</div>' + (m.groups.length ? '<div>捕获组: ' + m.groups.map((g,j) => '<span class="devtools-group">[' + (j+1) + '] ' + escapeHtml(g || '空') + '</span>').join(' ') + '</div>' : '') + '</div>';
            });
            html += '<button class="devtools-console-btn" onclick="window.devtoolsCopyToolResult(\'devtools-regex-result\')" style="margin-top:8px;">复制结果</button>';
            resultDiv.innerHTML = html;
        } catch (e) { resultDiv.innerHTML = '<div class="devtools-result-box" style="color:#c00;">正则表达式错误: ' + escapeHtml(e.message) + '</div>'; }
    };

    function renderSelectorTool() {
        const container = document.getElementById('devtools-tools-content');
        container.innerHTML = '<div class="devtools-input-group"><label class="devtools-input-label">CSS选择器或XPath</label><input type="text" class="devtools-input" id="devtools-selector-input" placeholder="例如: div.content 或 //div[@class=\'content\']"></div><div style="margin-bottom:10px;"><button class="devtools-tool-btn primary" onclick="window.devtoolsTestSelector()">查询</button><button class="devtools-tool-btn" onclick="window.devtoolsClearSelectorHighlight()">清除高亮</button></div><div id="devtools-selector-result"></div>';
    }

    window.devtoolsTestSelector = function() {
        const input = document.getElementById('devtools-selector-input').value.trim();
        const resultDiv = document.getElementById('devtools-selector-result');
        if (!input) { resultDiv.innerHTML = '<div class="devtools-result-box" style="color:#c00;">请输入选择器</div>'; return; }
        try {
            let elements = [];
            if (input.startsWith('//') || input.startsWith('./') || input.startsWith('../')) {
                elements = document.evaluate(input, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                elements = Array.from({ length: elements.snapshotLength }, (_, i) => elements.snapshotItem(i));
            } else elements = document.querySelectorAll(input);
            window.__selectorElements = elements;
            if (elements.length === 0) { resultDiv.innerHTML = '<div class="devtools-result-box">无匹配元素</div>'; return; }
            let html = '<div class="devtools-result-box">找到 ' + elements.length + ' 个元素</div>';
            Array.from(elements).forEach((el, i) => {
                const tag = el.tagName.toLowerCase();
                const id = el.id ? '#' + el.id : '';
                const cls = el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '';
                html += '<div class="devtools-selector-result" onclick="window.devtoolsHighlightSelectorElement(this, ' + i + ')" data-index="' + i + '">[' + (i+1) + '] &lt;' + tag + id + cls + '&gt; - ' + escapeHtml((el.textContent || '').substring(0, 50)) + '</div>';
            });
            html += '<button class="devtools-console-btn" onclick="window.devtoolsCopyToolResult(\'devtools-selector-result\')" style="margin-top:8px;">复制结果</button>';
            resultDiv.innerHTML = html;
        } catch (e) { resultDiv.innerHTML = '<div class="devtools-result-box" style="color:#c00;">选择器错误: ' + escapeHtml(e.message) + '</div>'; }
    };

    window.devtoolsHighlightSelectorElement = function(el, index) {
        document.querySelectorAll('.devtools-selector-result').forEach(e => e.classList.remove('selected'));
        el.classList.add('selected');
        const element = window.__selectorElements && window.__selectorElements[index];
        if (element) { element.scrollIntoView({ behavior: 'smooth', block: 'center' }); highlightElement(element); }
    };

    window.devtoolsClearSelectorHighlight = function() {
        const overlay = document.getElementById('devtools-highlight-overlay');
        if (overlay) overlay.style.display = 'none';
        document.getElementById('devtools-selector-result').innerHTML = '';
    };

    function renderJsonTool() {
        const container = document.getElementById('devtools-tools-content');
        container.innerHTML = '<div class="devtools-input-group"><label class="devtools-input-label">输入JSON</label><textarea class="devtools-textarea" id="devtools-json-input" placeholder="粘贴JSON文本..."></textarea></div><div style="margin-bottom:10px;"><button class="devtools-tool-btn primary" onclick="window.devtoolsFormatJson()">格式化</button><button class="devtools-tool-btn" onclick="window.devtoolsMinifyJson()">压缩</button><button class="devtools-tool-btn" onclick="window.devtoolsCopyJson()">复制</button></div><div id="devtools-json-result"></div>';
    }

    window.devtoolsFormatJson = function() {
        const input = document.getElementById('devtools-json-input').value;
        const resultDiv = document.getElementById('devtools-json-result');
        try {
            const parsed = JSON.parse(input);
            const formatted = JSON.stringify(parsed, null, 2);
            resultDiv.innerHTML = '<div class="devtools-result-box"><pre style="margin:0;white-space:pre-wrap;font-size:10px;">' + escapeHtml(formatted) + '</pre></div><button class="devtools-console-btn" onclick="window.devtoolsCopyToolResult(\'devtools-json-result\')" style="margin-top:8px;">复制结果</button>';
            window.__formattedJson = formatted;
        } catch (e) { resultDiv.innerHTML = '<div class="devtools-result-box" style="color:#c00;">JSON解析错误: ' + escapeHtml(e.message) + '</div>'; }
    };

    window.devtoolsMinifyJson = function() {
        const input = document.getElementById('devtools-json-input').value;
        const resultDiv = document.getElementById('devtools-json-result');
        try {
            const parsed = JSON.parse(input);
            const minified = JSON.stringify(parsed);
            resultDiv.innerHTML = '<div class="devtools-result-box"><pre style="margin:0;white-space:pre-wrap;word-break:break-all;font-size:10px;">' + escapeHtml(minified) + '</pre></div><button class="devtools-console-btn" onclick="window.devtoolsCopyToolResult(\'devtools-json-result\')" style="margin-top:8px;">复制结果</button>';
            window.__formattedJson = minified;
        } catch (e) { resultDiv.innerHTML = '<div class="devtools-result-box" style="color:#c00;">JSON解析错误: ' + escapeHtml(e.message) + '</div>'; }
    };

    window.devtoolsCopyJson = function() {
        if (window.__formattedJson) {
            navigator.clipboard.writeText(window.__formattedJson).then(() => showToast('已复制')).catch(() => showToast('复制失败'));
        } else {
            const input = document.getElementById('devtools-json-input').value;
            try { const parsed = JSON.parse(input); navigator.clipboard.writeText(JSON.stringify(parsed, null, 2)).then(() => showToast('已复制')).catch(() => showToast('复制失败')); } catch (e) { showToast('无效的JSON'); }
        }
    };

    function renderStringTool() {
        const container = document.getElementById('devtools-tools-content');
        container.innerHTML = '<div class="devtools-input-group"><label class="devtools-input-label">输入字符串</label><textarea class="devtools-textarea" id="devtools-string-input" placeholder="输入要处理的字符串..."></textarea></div><div style="margin-bottom:10px;"><button class="devtools-tool-btn" onclick="window.devtoolsStringOp(\'base64Encode\')">Base64编码</button><button class="devtools-tool-btn" onclick="window.devtoolsStringOp(\'base64Decode\')">Base64解码</button><button class="devtools-tool-btn" onclick="window.devtoolsStringOp(\'urlEncode\')">URL编码</button><button class="devtools-tool-btn" onclick="window.devtoolsStringOp(\'urlDecode\')">URL解码</button><button class="devtools-tool-btn" onclick="window.devtoolsStringOp(\'htmlEncode\')">HTML编码</button><button class="devtools-tool-btn" onclick="window.devtoolsStringOp(\'htmlDecode\')">HTML解码</button><button class="devtools-tool-btn" onclick="window.devtoolsStringOp(\'md5\')">MD5</button><button class="devtools-tool-btn" onclick="window.devtoolsStringOp(\'sha256\')">SHA256</button><button class="devtools-tool-btn" onclick="window.devtoolsStringOp(\'escapeUnicode\')">Unicode转义</button><button class="devtools-tool-btn" onclick="window.devtoolsStringOp(\'unescapeUnicode\')">Unicode还原</button></div><div id="devtools-string-result"></div>';
    }

    window.devtoolsStringOp = function(op) {
        const input = document.getElementById('devtools-string-input').value;
        const resultDiv = document.getElementById('devtools-string-result');
        let result = '';
        try {
            switch (op) {
                case 'base64Encode': result = btoa(unescape(encodeURIComponent(input))); break;
                case 'base64Decode': result = decodeURIComponent(escape(atob(input))); break;
                case 'urlEncode': result = encodeURIComponent(input); break;
                case 'urlDecode': result = decodeURIComponent(input); break;
                case 'htmlEncode': result = escapeHtml(input); break;
                case 'htmlDecode': result = input.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&'); break;
                case 'md5': result = window.devtoolsMD5(input); break;
                case 'sha256': window.devtoolsSha256(input).then(r => { resultDiv.innerHTML = '<div class="devtools-result-box"><pre style="margin:0;word-break:break-all;font-size:10px;">' + escapeHtml(r) + '</pre></div><button class="devtools-console-btn" onclick="window.devtoolsCopyToolResult(\'devtools-string-result\')" style="margin-top:8px;">复制结果</button>'; }).catch(e => { resultDiv.innerHTML = '<div class="devtools-result-box" style="color:#c00;">SHA256 失败: ' + escapeHtml(e.message || e) + '</div>'; }); return;
                case 'escapeUnicode': result = input.split('').map(c => c.charCodeAt(0) > 127 ? '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0') : c).join(''); break;
                case 'unescapeUnicode': result = input.replace(/\\u([0-9a-fA-F]{4})/g, (_, p) => String.fromCharCode(parseInt(p, 16))); break;
            }
            resultDiv.innerHTML = '<div class="devtools-result-box"><pre style="margin:0;word-break:break-all;font-size:10px;">' + escapeHtml(result) + '</pre></div><button class="devtools-console-btn" onclick="window.devtoolsCopyToolResult(\'devtools-string-result\')" style="margin-top:8px;">复制结果</button>';
            window.__stringResult = result;
        } catch (e) { resultDiv.innerHTML = '<div class="devtools-result-box" style="color:#c00;">操作失败: ' + escapeHtml(e.message) + '</div>'; }
    };

    window.devtoolsMD5 = function(string) {
        function rotateLeft(lValue, iShiftBits) { return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits)); }
        function addUnsigned(lX, lY) {
            let lX4, lY4, lX8, lY8, lResult;
            lX8 = (lX & 0x80000000); lY8 = (lY & 0x80000000);
            lX4 = (lX & 0x40000000); lY4 = (lY & 0x40000000);
            lResult = (lX & 0x3FFFFFFF) + (lY & 0x3FFFFFFF);
            if (lX4 & lY4) return (lResult ^ 0x80000000 ^ lX8 ^ lY8);
            if (lX4 | lY4) { if (lResult & 0x40000000) return (lResult ^ 0xC0000000 ^ lX8 ^ lY8); else return (lResult ^ 0x40000000 ^ lX8 ^ lY8); }
            return (lResult ^ lX8 ^ lY8);
        }
        function F(x,y,z) { return (x & y) | ((~x) & z); }
        function G(x,y,z) { return (x & z) | (y & (~z)); }
        function H(x,y,z) { return (x ^ y ^ z); }
        function I(x,y,z) { return (y ^ (x | (~z))); }
        function FF(a,b,c,d,x,s,ac) { return addUnsigned(rotateLeft(addUnsigned(addUnsigned(a, F(b,c,d)), addUnsigned(x, ac)), s), b); }
        function GG(a,b,c,d,x,s,ac) { return addUnsigned(rotateLeft(addUnsigned(addUnsigned(a, G(b,c,d)), addUnsigned(x, ac)), s), b); }
        function HH(a,b,c,d,x,s,ac) { return addUnsigned(rotateLeft(addUnsigned(addUnsigned(a, H(b,c,d)), addUnsigned(x, ac)), s), b); }
        function II(a,b,c,d,x,s,ac) { return addUnsigned(rotateLeft(addUnsigned(addUnsigned(a, I(b,c,d)), addUnsigned(x, ac)), s), b); }
        function convertToWordArray(string) {
            let lWordCount, lMessageLength = string.length, lNumberOfWordsTemp1 = lMessageLength + 8, lNumberOfWordsTemp2 = (lNumberOfWordsTemp1 - (lNumberOfWordsTemp1 % 64)) / 64, lNumberOfWords = (lNumberOfWordsTemp2 + 1) * 16, lWordArray = new Array(lNumberOfWords - 1), lBytePosition = 0, lByteCount = 0;
            while (lByteCount < lMessageLength) { lWordCount = (lByteCount - (lByteCount % 4)) / 4; lBytePosition = (lByteCount % 4) * 8; lWordArray[lWordCount] = lWordArray[lWordCount] | (string.charCodeAt(lByteCount) << lBytePosition); lByteCount++; }
            lWordCount = (lByteCount - (lByteCount % 4)) / 4; lBytePosition = (lByteCount % 4) * 8; lWordArray[lWordCount] = lWordArray[lWordCount] | (0x80 << lBytePosition);
            lWordArray[lNumberOfWords - 2] = lMessageLength << 3; lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29; return lWordArray;
        }
        function wordToHex(lValue) {
            let wordToHexValue = '', wordToHexValueTemp = '', lByte, lForLoop = 0;
            while (lForLoop <= 3) { lByte = (lValue >>> (lForLoop * 8)) & 255; wordToHexValueTemp = '0' + lByte.toString(16); wordToHexValue = wordToHexValue + wordToHexValueTemp.substr(wordToHexValueTemp.length - 2, 2); lForLoop++; }
            return wordToHexValue;
        }
        let x = convertToWordArray(string), a = 0x67452301, b = 0xEFCDAB89, c = 0x98BADCFE, d = 0x10325476;
        const S11 = 7, S12 = 12, S13 = 17, S14 = 22, S21 = 5, S22 = 9, S23 = 14, S24 = 20, S31 = 4, S32 = 11, S33 = 16, S34 = 23, S41 = 6, S42 = 10, S43 = 15, S44 = 21;
        for (let k = 0; k < x.length; k += 16) {
            let AA = a, BB = b, CC = c, DD = d;
            a = FF(a,b,c,d,x[k],S11,0xD76AA478); d = FF(d,a,b,c,x[k+1],S12,0xE8C7B756); c = FF(c,d,a,b,x[k+2],S13,0x242070DB); b = FF(b,c,d,a,x[k+3],S14,0xC1BDCEEE);
            a = FF(a,b,c,d,x[k+4],S11,0xF57C0FAF); d = FF(d,a,b,c,x[k+5],S12,0x4787C62A); c = FF(c,d,a,b,x[k+6],S13,0xA8304613); b = FF(b,c,d,a,x[k+7],S14,0xFD469501);
            a = FF(a,b,c,d,x[k+8],S11,0x698098D8); d = FF(d,a,b,c,x[k+9],S12,0x8B44F7AF); c = FF(c,d,a,b,x[k+10],S13,0xFFFF5BB1); b = FF(b,c,d,a,x[k+11],S14,0x895CD7BE);
            a = FF(a,b,c,d,x[k+12],S11,0x6B901122); d = FF(d,a,b,c,x[k+13],S12,0xFD987193); c = FF(c,d,a,b,x[k+14],S13,0xA679438E); b = FF(b,c,d,a,x[k+15],S14,0x49B40821);
            a = GG(a,b,c,d,x[k+1],S21,0xF61E2562); d = GG(d,a,b,c,x[k+6],S22,0xC040B340); c = GG(c,d,a,b,x[k+11],S23,0x265E5A51); b = GG(b,c,d,a,x[k],S24,0xE9B6C7AA);
            a = GG(a,b,c,d,x[k+5],S21,0xD62F105D); d = GG(d,a,b,c,x[k+10],S22,0x02441453); c = GG(c,d,a,b,x[k+15],S23,0xD8A1E681); b = GG(b,c,d,a,x[k+4],S24,0xE7D3FBC8);
            a = GG(a,b,c,d,x[k+9],S21,0x21E1CDE6); d = GG(d,a,b,c,x[k+14],S22,0xC33707D6); c = GG(c,d,a,b,x[k+3],S23,0xF4D50D87); b = GG(b,c,d,a,x[k+8],S24,0x455A14ED);
            a = GG(a,b,c,d,x[k+13],S21,0xA9E3E905); d = GG(d,a,b,c,x[k+2],S22,0xFCEFA3F8); c = GG(c,d,a,b,x[k+7],S23,0x676F02D9); b = GG(b,c,d,a,x[k+12],S24,0x8D2A4C8A);
            a = HH(a,b,c,d,x[k+5],S31,0xFFFA3942); d = HH(d,a,b,c,x[k+8],S32,0x8771F681); c = HH(c,d,a,b,x[k+11],S33,0x6D9D6122); b = HH(b,c,d,a,x[k+14],S34,0xFDE5380C);
            a = HH(a,b,c,d,x[k+1],S31,0xA4BEEA44); d = HH(d,a,b,c,x[k+4],S32,0x4BDECFA9); c = HH(c,d,a,b,x[k+7],S33,0xF6BB4B60); b = HH(b,c,d,a,x[k+10],S34,0xBEBFBC70);
            a = HH(a,b,c,d,x[k+13],S31,0x289B7EC6); d = HH(d,a,b,c,x[k],S32,0xEAA127FA); c = HH(c,d,a,b,x[k+3],S33,0xD4EF3085); b = HH(b,c,d,a,x[k+6],S34,0x04881D05);
            a = HH(a,b,c,d,x[k+9],S31,0xD9D4D039); d = HH(d,a,b,c,x[k+12],S32,0xE6DB99E5); c = HH(c,d,a,b,x[k+15],S33,0x1FA27CF8); b = HH(b,c,d,a,x[k+2],S34,0xC4AC5665);
            a = II(a,b,c,d,x[k],S41,0xF4292244); d = II(d,a,b,c,x[k+7],S42,0x432AFF97); c = II(c,d,a,b,x[k+14],S43,0xAB9423A7); b = II(b,c,d,a,x[k+5],S44,0xFC93A039);
            a = II(a,b,c,d,x[k+12],S41,0x655B59C3); d = II(d,a,b,c,x[k+3],S42,0x8F0CCC92); c = II(c,d,a,b,x[k+10],S43,0xFFEFF47D); b = II(b,c,d,a,x[k+1],S44,0x85845DD1);
            a = II(a,b,c,d,x[k+8],S41,0x6FA87E4F); d = II(d,a,b,c,x[k+15],S42,0xFE2CE6E0); c = II(c,d,a,b,x[k+6],S43,0xA3014314); b = II(b,c,d,a,x[k+13],S44,0x4E0811A1);
            a = II(a,b,c,d,x[k+4],S41,0xF7537E82); d = II(d,a,b,c,x[k+11],S42,0xBD3AF235); c = II(c,d,a,b,x[k+2],S43,0x2AD7D2BB); b = II(b,c,d,a,x[k+9],S44,0xEB86D391);
            a = addUnsigned(a, AA); b = addUnsigned(b, BB); c = addUnsigned(c, CC); d = addUnsigned(d, DD);
        }
        return (wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d)).toLowerCase();
    };

    window.devtoolsSha256 = async function(text) {
        const msgBuffer = new TextEncoder().encode(text);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    };

    function renderRequestTool() {
        const container = document.getElementById('devtools-tools-content');
        container.innerHTML = '<div style="margin-bottom:10px;"><select id="devtools-request-method" class="devtools-console-btn"><option value="GET">GET</option><option value="POST">POST</option><option value="PUT">PUT</option><option value="DELETE">DELETE</option><option value="PATCH">PATCH</option><option value="HEAD">HEAD</option></select><input type="text" class="devtools-input" id="devtools-request-url" placeholder="输入URL" style="width:calc(100% - 80px);margin-left:4px;"></div><div class="devtools-input-group"><label class="devtools-input-label">请求头 (JSON格式)</label><textarea class="devtools-textarea" id="devtools-request-headers" placeholder=\'{"Content-Type": "application/json"}\'></textarea></div><div class="devtools-input-group"><label class="devtools-input-label">请求体</label><textarea class="devtools-textarea" id="devtools-request-body" placeholder="请求体内容..."></textarea></div><button class="devtools-tool-btn primary" onclick="window.devtoolsSendRequest()">发送请求</button><div id="devtools-request-response"></div>';
    }

    window.devtoolsSendRequest = async function() {
        const method = document.getElementById('devtools-request-method').value;
        const url = document.getElementById('devtools-request-url').value;
        const headersText = document.getElementById('devtools-request-headers').value;
        const body = document.getElementById('devtools-request-body').value;
        const responseDiv = document.getElementById('devtools-request-response');
        if (!url) { responseDiv.innerHTML = '<div class="devtools-result-box" style="color:#c00;">请输入URL</div>'; return; }
        responseDiv.innerHTML = '<div class="devtools-result-box">正在发送请求...</div>';
        let headers = {};
        try { if (headersText.trim()) headers = JSON.parse(headersText); } catch (e) { responseDiv.innerHTML = '<div class="devtools-result-box" style="color:#c00;">请求头格式错误: ' + escapeHtml(e.message) + '</div>'; return; }
        const options = { method, headers };
        if (body && !['GET', 'HEAD'].includes(method)) options.body = body;
        const startTime = Date.now();
        try {
            const response = await fetch(url, options);
            const duration = Date.now() - startTime;
            const responseText = await response.text();
            let formattedText = responseText;
            try { const json = JSON.parse(responseText); formattedText = JSON.stringify(json, null, 2); } catch {}
            responseDiv.innerHTML = '<div style="margin-bottom:8px;padding:8px;background:var(--bg-hover,#f5f5f5);border-radius:3px;font-size:11px;"><div><strong>状态:</strong> ' + response.status + ' ' + response.statusText + '</div><div><strong>耗时:</strong> ' + duration + 'ms</div><div><strong>大小:</strong> ' + responseText.length + ' 字节</div></div><pre style="padding:8px;background:var(--bg-hover,#f5f5f5);border:1px solid var(--border-light,#eee);border-radius:3px;font-size:10px;white-space:pre-wrap;word-break:break-all;max-height:300px;overflow:auto;">' + escapeHtml(formattedText) + '</pre><button class="devtools-console-btn" onclick="window.devtoolsCopyToolResult(\'devtools-request-response\')" style="margin-top:8px;">复制结果</button>';
        } catch (e) { responseDiv.innerHTML = '<div class="devtools-result-box" style="color:#c00;">请求失败: ' + escapeHtml(e.message) + '</div>'; }
    };

    // ============ 资源面板 ============
    function renderResourceContent() {
        const container = document.getElementById('devtools-resource-content');
        if (!container) return;
        switch (activeResourceTab) {
            case 'local': renderStorageTable(getLocalStorage(), '本地存储', 'local'); break;
            case 'session': renderStorageTable(getSessionStorage(), '会话存储', 'session'); break;
            case 'cookie': renderStorageTable(getCookies(), 'Cookie', 'cookie'); break;
            case 'ua': renderUserAgent(); break;
            case 'script': renderLinkList(getScripts(), '脚本'); break;
            case 'stylesheet': renderLinkList(getStylesheets(), '样式表'); break;
            case 'iframe': renderLinkList(getIframes(), '框架'); break;
            case 'image': renderImageGrid(getImages(), '图片'); break;
            case 'cache': renderCacheInfo(); break;
        }
    }

    function getLocalStorage() {
        try { const data = []; for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (key) try { data.push({ key, value: localStorage.getItem(key), id: i }); } catch(e) {} } return data; } catch(e) { return []; }
    }
    function getSessionStorage() {
        try { const data = []; for (let i = 0; i < sessionStorage.length; i++) { const key = sessionStorage.key(i); if (key) try { data.push({ key, value: sessionStorage.getItem(key), id: i }); } catch(e) {} } return data; } catch(e) { return []; }
    }
    function getCookies() {
        try { if (!document.cookie) return []; return document.cookie.split(';').map((cookie, idx) => { const parts = cookie.trim().split(/=(.+)/); return { key: parts[0] || '', value: parts[1] || '', id: idx }; }).filter(item => item.key); } catch(e) { return []; }
    }
    function getScripts() { try { return Array.from(document.scripts).map((s,i) => ({ url: s.src || '(内联脚本)', id: i })); } catch(e) { return []; } }
    function getStylesheets() {
        try {
            const hrefs = [];
            Array.from(document.styleSheets).forEach(sheet => { if (sheet.href) hrefs.push({ url: sheet.href, id: hrefs.length }); });
            Array.from(document.getElementsByTagName('link')).forEach(link => { if (link.rel === 'stylesheet' && link.href && !hrefs.find(h => h.url === link.href)) hrefs.push({ url: link.href, id: hrefs.length }); });
            return hrefs;
        } catch(e) { return []; }
    }
    function getImages() { try { return Array.from(document.images).map((img,i) => ({ url: img.src, id: i })); } catch(e) { return []; } }
    function getIframes() { try { return Array.from(document.getElementsByTagName('iframe')).map((iframe,i) => ({ url: iframe.src || '(空)', id: i })); } catch(e) { return []; } }

    function renderStorageTable(data, title, type) {
        const container = document.getElementById('devtools-resource-content');
        let html = '<div class="devtools-resource-header"><span class="devtools-resource-title">' + title + '</span><span style="font-size:11px;color:#999;">共 ' + data.length + ' 个</span></div><table class="devtools-storage-table"><thead><tr><th style="width:30%;">键名</th><th style="width:50%;">值</th><th style="width:20%;">操作</th></tr></thead><tbody>';
        data.forEach(item => {
            const keyEscaped = escapeHtml(item.key).replace(/'/g, "\\'");
            const valuePreview = (item.value || '').length > 200 ? escapeHtml(item.value.substring(0, 200)) + '...' : escapeHtml(item.value || '');
            html += '<tr><td>' + escapeHtml(item.key) + '</td><td>' + valuePreview + '</td><td><button class="devtools-action-btn" onclick="window.devtoolsEditStorage(\'' + keyEscaped + '\',\'' + type + '\')">编辑</button> <button class="devtools-action-btn" onclick="window.devtoolsCopyStorageValue(\'' + keyEscaped + '\',\'' + type + '\')">复制</button> <button class="devtools-action-btn" onclick="window.devtoolsDeleteStorage(\'' + keyEscaped + '\',\'' + type + '\')">删除</button></td></tr>';
        });
        html += '</tbody></table>';
        if (['local', 'session', 'cookie'].includes(type)) html += '<button class="devtools-add-row" onclick="window.devtoolsAddStorage(\'' + type + '\')">+ 添加</button>';
        container.innerHTML = html;
    }

    window.devtoolsEditStorage = function(key, type) {
        if (type === 'cookie') {
            const cookieValue = document.cookie.split(';').find(c => c.trim().startsWith(key + '='))?.split('=')[1] || '';
            const newValue = prompt('编辑 "' + key + '" 的值:', decodeURIComponent(cookieValue));
            if (newValue !== null) {
                document.cookie = key + '=' + encodeURIComponent(newValue) + ';path=/';
                renderResourceContent();
            }
        } else {
            let value = type === 'local' ? localStorage.getItem(key) || '' : sessionStorage.getItem(key) || '';
            const newValue = prompt('编辑 "' + key + '" 的值:', value);
            if (newValue !== null) { 
                if (type === 'local') localStorage.setItem(key, newValue); 
                else sessionStorage.setItem(key, newValue); 
                renderResourceContent(); 
            }
        }
    };

    window.devtoolsCopyStorageValue = function(key, type) {
        let value = '';
        if (type === 'cookie') {
            value = document.cookie.split(';').find(c => c.trim().startsWith(key + '='))?.split('=')[1] || '';
            value = decodeURIComponent(value);
        } else {
            value = type === 'local' ? localStorage.getItem(key) || '' : sessionStorage.getItem(key) || '';
        }
        navigator.clipboard.writeText(value).then(() => showToast('已复制')).catch(() => showToast('复制失败'));
    };

    window.devtoolsDeleteStorage = function(key, type) {
        if (confirm('确定删除 "' + key + '" 吗?')) { 
            if (type === 'cookie') {
                document.cookie = key + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
            } else if (type === 'local') {
                localStorage.removeItem(key); 
            } else {
                sessionStorage.removeItem(key);
            }
            renderResourceContent(); 
        }
    };

    window.devtoolsAddStorage = function(type) {
        if (type === 'cookie') {
            const key = prompt('请输入Cookie名称:'); if (!key) return;
            const value = prompt('请输入值:', '');
            if (value !== null) { document.cookie = key + '=' + encodeURIComponent(value) + ';path=/'; renderResourceContent(); }
        } else {
            const key = prompt('请输入键名:'); if (!key) return;
            const value = prompt('请输入值:', '');
            if (value !== null) { if (type === 'local') localStorage.setItem(key, value); else sessionStorage.setItem(key, value); renderResourceContent(); }
        }
    };

    function renderLinkList(data, title) {
        const container = document.getElementById('devtools-resource-content');
        let html = '<div class="devtools-resource-header"><span class="devtools-resource-title">' + title + '</span><span style="font-size:11px;color:#999;">共 ' + data.length + ' 个</span></div><div class="devtools-resource-list">';
        data.forEach(item => {
            if (item.url.startsWith('http') || item.url.startsWith('//')) html += '<a href="' + escapeHtml(item.url) + '" target="_blank" class="devtools-resource-link">' + escapeHtml(item.url) + '</a>';
            else html += '<div class="devtools-resource-link" style="cursor:default;">' + escapeHtml(item.url) + '</div>';
        });
        html += '</div>';
        container.innerHTML = html;
    }

    function renderImageGrid(data, title) {
        const container = document.getElementById('devtools-resource-content');
        const uniqueUrls = [...new Set(data.map(d => d.url))].slice(0, 100);
        let html = '<div class="devtools-resource-header"><span class="devtools-resource-title">' + title + '</span><span style="font-size:11px;color:#999;">显示 ' + uniqueUrls.length + ' 张（共 ' + data.length + '）</span></div><div class="devtools-image-grid">';
        uniqueUrls.forEach(url => {
            if (!isSafeUrl(url)) return;
            html += '<div class="devtools-image-item"><img src="' + escapeHtml(url) + '" loading="lazy" alt=""></div>';
        });
        html += '</div>';
        container.innerHTML = html;
    }

    function renderUserAgent() {
        const container = document.getElementById('devtools-resource-content');
        const ua = navigator.userAgent || '未知';
        window.__uaString = ua;
        container.innerHTML = '<div class="devtools-resource-header"><span class="devtools-resource-title">User Agent</span></div><div style="padding:8px;font-size:11px;"><div style="margin-bottom:10px;padding:10px;background:var(--bg-hover,#f5f5f5);border-radius:4px;word-break:break-all;font-family:Consolas,monospace;font-size:10px;">' + escapeHtml(ua) + '</div><button class="devtools-action-btn" onclick="navigator.clipboard.writeText(window.__uaString).then(()=>showToast(\'已复制\'))">复制</button></div>';
    }

    function renderCacheInfo() {
        const container = document.getElementById('devtools-resource-content');
        const usedMemory = performance.memory?.usedJSHeapSize ? (performance.memory.usedJSHeapSize/1024/1024).toFixed(2)+'MB' : '不支持';
        const totalMemory = performance.memory?.jsHeapSizeLimit ? (performance.memory.jsHeapSizeLimit/1024/1024).toFixed(2)+'MB' : '不支持';
        const domCount = document.querySelectorAll('*').length;
        container.innerHTML = '<div class="devtools-resource-header"><span class="devtools-resource-title">缓存信息</span></div><div style="padding:8px;font-size:11px;"><div class="devtools-performance-metric"><span>内存使用</span><span>' + usedMemory + '</span></div><div class="devtools-performance-metric"><span>总内存</span><span>' + totalMemory + '</span></div><div class="devtools-performance-metric"><span>DOM节点数</span><span>' + domCount + '</span></div><button class="devtools-tool-btn" onclick="location.reload()" style="margin-top:10px;">刷新页面</button></div>';
    }

    // ============ 性能面板 ============
    function renderPerformanceContent() {
        try {
            const container = document.getElementById('devtools-performance-content');
            if (!container) return;
            const navEntry = performance.getEntriesByType('navigation')[0] || {};
            const entries = performance.getEntriesByType('resource');
            const loadTime = navEntry.loadEventEnd ? Math.round(navEntry.loadEventEnd) + 'ms' : '计算中';
            const domParse = navEntry.domContentLoadedEventEnd ? Math.round(navEntry.domContentLoadedEventEnd) + 'ms' : '计算中';
            const firstByte = navEntry.responseStart ? Math.round(navEntry.responseStart) + 'ms' : '计算中';
            
            let html = '<div style="padding:8px;">';
            html += '<div class="devtools-resource-header"><span class="devtools-resource-title">页面性能</span></div>';
            html += '<div class="devtools-performance-metric"><span>加载时间</span><span>' + loadTime + '</span></div>';
            html += '<div class="devtools-performance-metric"><span>DOM解析</span><span>' + domParse + '</span></div>';
            html += '<div class="devtools-performance-metric"><span>首字节</span><span>' + firstByte + '</span></div>';
            html += '<div class="devtools-performance-metric"><span>节点数</span><span>' + document.querySelectorAll('*').length + '</span></div>';
            html += '</div>';
            
            html += '<div style="padding:8px;border-top:1px solid var(--border-light,#eee);">';
            html += '<div class="devtools-resource-header"><span class="devtools-resource-title">资源加载 (' + entries.length + ')</span><button class="devtools-console-btn" onclick="performance.clearResourceTimings();window.devtoolsRenderPerformance&&window.devtoolsRenderPerformance();">刷新</button></div>';
            html += '<div style="max-height:250px;overflow:auto;font-size:11px;">';
            html += '<table class="devtools-storage-table" style="width:100%;"><thead><tr><th>资源</th><th>类型</th><th>耗时</th><th>大小</th></tr></thead><tbody>';
            entries.slice(-50).forEach(entry => {
                const urlParts = entry.name.split('/');
                const fileName = urlParts[urlParts.length - 1].split('?')[0] || entry.name;
                const displayName = fileName.length > 30 ? fileName.substring(0, 30) + '...' : fileName;
                const initType = entry.initiatorType || 'other';
                const duration = entry.duration ? entry.duration.toFixed(1) + 'ms' : '-';
                const size = entry.transferSize ? (entry.transferSize/1024).toFixed(1)+'KB' : '-';
                html += '<tr><td title="' + escapeHtml(entry.name) + '">' + escapeHtml(displayName) + '</td><td>' + initType + '</td><td>' + duration + '</td><td>' + size + '</td></tr>';
            });
            html += '</tbody></table></div></div>';
            container.innerHTML = html;
        } catch (e) {}
    }
    window.devtoolsRenderPerformance = renderPerformanceContent;

    // Long Task 观察器（只创建一次）
    if (window.PerformanceObserver && !window.__devscopeLongTaskObserver) {
        try {
            window.__devscopeLongTaskObserver = new PerformanceObserver(list => {
                const container = document.getElementById('devtools-performance-content');
                const longTasks = list.getEntries();
                if (longTasks.length && container) {
                    container.innerHTML += `<div class="devtools-performance-metric"><span>检测到长任务</span><span>${longTasks[longTasks.length-1].duration.toFixed(1)}ms</span></div>`;
                }
            });
            window.__devscopeLongTaskObserver.observe({ type: 'longtask', buffered: true });
        } catch(e) {}
    }

    // ============ 高亮滚动更新 ============
    function updateHighlightPosition() {
        if (!selectedElement) return;
        highlightElement(selectedElement);
    }

    function onScrollUpdate() {
        if (scrollRaf) return;
        scrollRaf = requestAnimationFrame(() => {
            updateHighlightPosition();
            scrollRaf = null;
        });
    }

    function addScrollListener() {
        window.addEventListener('scroll', onScrollUpdate, { passive: true });
    }

    // ============ 初始化 ============
    function addKeyboardShortcut() {
        document.addEventListener('keydown', e => {
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'I') {
                e.preventDefault();
                toggleSidebar();
            }
        });
    }

    function init() {
        createStyles();
        createSidebar();
        applySidebarSettings();
        hijackConsole();
        hijackNetwork();
        hijackNavigation();
        if (GM_getValue('devtools-fn-trace', false)) hijackFunctions();
        if (GM_getValue('devtools-dom-observe', false)) observeDOM();
        addKeyboardShortcut();
        addScrollListener();
        restoreCrossPageLogs();
        // 元素 ID 映射清理
        if (!window.__devscope_elementObserver) {
            window.__devscope_elementObserver = new MutationObserver(mutations => {
                mutations.forEach(m => {
                    m.removedNodes.forEach(node => {
                        if (node.nodeType === 1) {
                            const id = elementToIdMap.get(node);
                            if (id) {
                                elementIdToElementMap.delete(id);
                                elementToIdMap.delete(node);
                            }
                        }
                    });
                });
            });
            window.__devscope_elementObserver.observe(document.documentElement, { childList: true, subtree: true });
        }
        console.log('DevScope v6.0.8 已加载');
    }

    if (document.body) {
        requestIdleCallback ? requestIdleCallback(init) : setTimeout(init, 100);
    } else {
        document.addEventListener('DOMContentLoaded', () => requestIdleCallback ? requestIdleCallback(init) : init);
    }
})();