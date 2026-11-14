/**
 * 严格 CSP 站点下的运行时兜底：nonce 复用、样式注入三级回退、外部资源加载。
 *
 * 零依赖，直接拷进项目（如 src/csp.js）即可。所有注入点都走这里，
 * 站点收紧 style-src / script-src 时功能降级，而不是整页报错或静默失效。
 */

const STYLE_MARK = 'data-csp-style';
const POLICY_NAME = 'userscript-csp';

let nonce = null;
let inlineBlocked = null;
let policy;

// root -> Map<key, dispose>：同 key 重复注入时先移除上一份，热更新不会叠加
const registry = new WeakMap();

/** 复用页面的 CSP nonce；站点策略不含 nonce-source 时返回空字符串 */
export function getNonce() {
    if (nonce) return nonce;
    if (typeof document === 'undefined') return '';
    const el = document.querySelector('style[nonce], script[nonce]');
    const value = el?.nonce || el?.getAttribute('nonce') || '';
    // 页面可能在脚本启动后才插入带 nonce 的标签，未命中时不缓存
    if (value) nonce = value;
    return value;
}

/** 清空 nonce 缓存：SPA 重建后页面可能换成另一份 CSP 策略 */
export function resetNonce() {
    nonce = null;
}

/** 探针判断 style-src 是否禁掉了内联样式；被禁时只能靠构造式样式表或 GM_addStyle */
export function isInlineStyleBlocked() {
    if (inlineBlocked !== null) return inlineBlocked;
    if (typeof document === 'undefined') return (inlineBlocked = false);
    const probe = document.createElement('div');
    try {
        (document.documentElement || document.body || document).appendChild(probe);
        probe.style.setProperty('position', 'fixed');
        inlineBlocked = !probe.getAttribute('style');
    } catch (e) {
        inlineBlocked = false;
    } finally {
        probe.remove();
    }
    return inlineBlocked;
}

/**
 * 注入一段样式，返回移除函数；同 id 再次调用会替换上一份。
 * 依次尝试：构造式样式表（不受 style-src 约束）→ GM_addStyle（管理器注入）→ 带 nonce 的 <style>。
 */
export function applyStyle(text, { root = document, id = '' } = {}) {
    if (!text) return () => {};
    const map = registryOf(root);
    const key = id || text;
    map.get(key)?.();

    const dispose = adoptSheet(root, text) ?? gmStyle(root, text) ?? styleTag(root, text);
    map.set(key, dispose);
    return dispose;
}

/** 加载外部样式；直连被 style-src 拦下时改由管理器取文本再注入 */
export async function loadCss(href, options = {}) {
    try {
        await appendLink(href);
        return () => {};
    } catch (e) {
        // 注意：只绕过 style-src；样式里 @font-face 的字体文件仍受 font-src 限制
        return applyStyle(await fetchText(href), { id: href, ...options });
    }
}

/** 加载外部脚本；直连被 script-src 拦下时改由管理器取源码，再以页面允许的方式执行 */
export async function loadScript(src) {
    try {
        await appendScript({ src });
        return;
    } catch (e) {
        if (typeof GM_xmlhttpRequest !== 'function') throw e;
    }
    const code = await fetchText(src);
    try {
        await appendScript({ code: `${code}\n//# sourceURL=${src}` });
    } catch (e) {
        // 页面既不允许这个源、也不允许内联执行：退到脚本自己的沙箱里 eval
        // （CSP 管不到管理器沙箱，代价是代码拿不到页面全局作用域）
        console.warn(`[userscript-csp] ${src} 只能在脚本沙箱内执行，页面上下文不可用`);
        // eslint-disable-next-line no-eval
        eval(code);
    }
}

/** 以页面允许的方式执行一段脚本源码（内联脚本在 require-trusted-types-for 下需要策略包装） */
export function runScript(code, { sourceURL = 'userscript:inline' } = {}) {
    return appendScript({ code: `${code}\n//# sourceURL=${sourceURL}` });
}

function registryOf(root) {
    let map = registry.get(root);
    if (!map) registry.set(root, (map = new Map()));
    return map;
}

function adoptSheet(root, text) {
    if (typeof CSSStyleSheet !== 'function' || !('adoptedStyleSheets' in root)) return null;
    try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(text);
        root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
        return () => {
            root.adoptedStyleSheets = root.adoptedStyleSheets.filter((item) => item !== sheet);
        };
    } catch (e) {
        return null;
    }
}

function gmStyle(root, text) {
    // GM_addStyle 只能写进页面文档，ShadowRoot 里没有对应的管理器 API
    if (root !== document || typeof GM_addStyle !== 'function') return null;
    try {
        const el = GM_addStyle(text);
        return () => el?.remove?.();
    } catch (e) {
        return null;
    }
}

function styleTag(root, text) {
    const el = document.createElement('style');
    el.setAttribute(STYLE_MARK, '');
    const value = getNonce();
    // nonce 必须在插入前设置，插入后再改不起作用
    if (value) el.setAttribute('nonce', value);
    el.textContent = text;
    containerOf(root).appendChild(el);
    return () => el.remove();
}

function containerOf(root) {
    return root === document ? document.head || document.documentElement : root;
}

function appendLink(href) {
    return new Promise((resolve, reject) => {
        const el = document.createElement('link');
        el.rel = 'stylesheet';
        el.href = href;
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error(`样式加载失败：${href}`));
        (document.head || document.documentElement).appendChild(el);
    });
}

function appendScript({ src, code }) {
    return new Promise((resolve, reject) => {
        const el = document.createElement('script');
        try {
            if (code !== undefined) el.text = trustedScript(code);
            else el.src = trustedUrl(src);
        } catch (e) {
            reject(e);
            return;
        }
        const value = getNonce();
        if (value) el.setAttribute('nonce', value);
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error(`脚本加载被 CSP 拦截或失败：${src ?? 'inline'}`));
        (document.head || document.documentElement).appendChild(el);
    });
}

function fetchText(url) {
    return new Promise((resolve, reject) => {
        if (typeof GM_xmlhttpRequest !== 'function') {
            reject(new Error('绕过 connect-src 需要 @grant GM_xmlhttpRequest'));
            return;
        }
        GM_xmlhttpRequest({
            method: 'GET',
            url,
            onload: (res) => {
                if (res.status >= 200 && res.status < 300) resolve(res.responseText);
                else reject(new Error(`${url} → HTTP ${res.status}`));
            },
            onerror: () => reject(new Error(`无法请求 ${url}`)),
        });
    });
}

/** Trusted Types 策略：Gemini 这类站点在设置 script.src / text 时直接抛错 */
function trustedPolicy() {
    if (policy !== undefined) return policy;
    const scope = typeof unsafeWindow !== 'undefined' && unsafeWindow ? unsafeWindow : globalThis;
    const tt = scope.trustedTypes;
    if (!tt) return (policy = null);
    const rules = { createScriptURL: (value) => value, createScript: (value) => value };
    try {
        policy = tt.createPolicy(POLICY_NAME, rules);
    } catch (e) {
        // 同名策略已被另一份实例占用，换个名字
        try {
            policy = tt.createPolicy(`${POLICY_NAME}-${Math.random().toString(36).slice(2)}`, rules);
        } catch (err) {
            policy = null;
        }
    }
    return policy;
}

function trustedUrl(value) {
    return trustedPolicy()?.createScriptURL(value) ?? value;
}

function trustedScript(value) {
    return trustedPolicy()?.createScript(value) ?? value;
}
