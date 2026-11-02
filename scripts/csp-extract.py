"""One-time move of inline JavaScript out of the HTML pages, so the Content
Security Policy can drop 'unsafe-inline' from script-src.

For each page:
  * every inline <script> block moves, unchanged, to lib/pages/<page>-<name>.js
    and is replaced by <script src="..."> in the same place (same load order);
  * every inline on*="..." handler, in the HTML and inside the moved scripts'
    HTML strings, becomes data-on-<event>="<key>"; its code moves, unchanged,
    into lib/pages/<page>-handlers.js under that key, and lib/csp-handlers.js
    attaches it with addEventListener. ${...} values inside a handler become
    data-<event>-a<N> attributes the code reads back.

Run from the repo root:  python scripts/csp-extract.py
Re-running on already-converted pages is a no-op (nothing inline is left).
"""
import hashlib
import os
import re
import sys

PAGES = {
    'index.html': ('index', ['boot', 'auth-gate', 'theme', 'app', 'extras']),
    'login.html': ('login', None),
    'about.html': ('about', None),
    'privacy.html': ('privacy', None),
    'passkey-desktop.html': ('passkey-desktop', None),
    'oauth/consent/index.html': ('oauth-consent', None),
}
INLINE_SCRIPT = re.compile(r'<script(?![^>]*\bsrc=)([^>]*)>(.*?)</script>', re.S)
HANDLER = re.compile(r'(\s)on([a-z]+)="([^"]*)"')
PLACEHOLDER = re.compile(r"('?)\$\{([^{}]*)\}('?)")


def key_for(event, code):
    return 'h' + hashlib.sha1(f'{event}:{code}'.encode()).hexdigest()[:10]


def convert_handlers(text, table, in_js):
    def repl(m):
        lead, event, code = m.group(1), m.group(2), m.group(3)
        if in_js and '\\' in code:
            raise SystemExit(f'escaped handler needs a hand edit: {code!r}')
        attrs, n = [], 0

        def ph(pm):
            nonlocal n
            q1, expr, q2 = pm.group(1), pm.group(2), pm.group(3)
            name = f'data-{event}-a{n}'
            n += 1
            attrs.append(f'{name}="${{{expr}}}"')
            if q1 and q2:
                return f"this.getAttribute('{name}')"
            return f"JSON.parse(this.getAttribute('{name}'))"

        body = PLACEHOLDER.sub(ph, code) if in_js else code
        key = key_for(event, body)
        table[key] = (event, body)
        extra = (' ' + ' '.join(attrs)) if attrs else ''
        return f'{lead}data-on-{event}="{key}"{extra}'

    return HANDLER.sub(repl, text)


def main():
    root = os.getcwd()
    events = set()
    for path, (page, names) in PAGES.items():
        full = os.path.join(root, path)
        if not os.path.exists(full):
            continue
        html = open(full, encoding='utf8').read()
        table = {}
        blocks = list(INLINE_SCRIPT.finditer(html))
        if names and blocks and len(blocks) != len(names):
            raise SystemExit(f'{path}: expected {len(names)} inline scripts, found {len(blocks)}')
        out, last = [], 0
        for i, m in enumerate(blocks):
            name = names[i] if names else (str(i + 1) if len(blocks) > 1 else 'inline')
            rel = f'lib/pages/{page}-{name}.js'
            js = convert_handlers(m.group(2), table, in_js=True)
            os.makedirs(os.path.join(root, 'lib', 'pages'), exist_ok=True)
            with open(os.path.join(root, rel), 'w', encoding='utf8', newline='') as f:
                f.write(js.strip('\n') + '\n')
            out.append(html[last:m.start()])
            out.append(f'<script src="/{rel}"{m.group(1)}></script>')
            last = m.end()
        out.append(html[last:])
        html = convert_handlers(''.join(out), table, in_js=False)
        if table:
            events.update(e for e, _ in table.values())
            lines = [
                f'// Event handlers for {path}. They used to be inline on*="" attributes;',
                '// the Content Security Policy forbids those now. Elements point here with',
                '// data-on-<event>="<key>", and lib/csp-handlers.js attaches them.',
                '// To add one: give the element data-on-click="hYourKey" and add hYourKey',
                '// below, or attach a listener in code instead.',
                'window.__H = Object.assign(window.__H || {}, {',
            ]
            for k, (e, body) in sorted(table.items(), key=lambda kv: (kv[1][0], kv[1][1])):
                lines.append(f'  // on{e}: {body[:90]}')
                lines.append(f'  {k}: function (event) {{ {body} }},')
            lines.append('});')
            with open(os.path.join(root, f'lib/pages/{page}-handlers.js'), 'w', encoding='utf8', newline='') as f:
                f.write('\n'.join(lines) + '\n')
            head_scripts = f'<script src="/lib/csp-handlers.js"></script><script src="/lib/pages/{page}-handlers.js"></script>'
            m = re.search(r'<meta[^>]*charset[^>]*>', html, re.I) or re.search(r'<head[^>]*>', html, re.I)
            if 'csp-handlers.js' not in html:
                html = html[:m.end()] + head_scripts + html[m.end():]
        with open(full, 'w', encoding='utf8', newline='') as f:
            f.write(html)
        print(f'{path}: {len(blocks)} scripts moved, {len(table)} handlers moved')
    print('events used:', ' '.join(sorted(events)))


if __name__ == '__main__':
    main()
