# Aufruf aus dem Repo-Wurzelordner: python cli/theme-slate-dark.py snappymail/v/0.0.0/themes
# Erzeugt SlateDark/styles.css aus Slate/styles.css: gleicher Komponententeil, dunkle Tokens.
import re, sys, pathlib
base = pathlib.Path(sys.argv[1])
src = (base / 'Slate/styles.css').read_text(encoding='utf-8')
dark = {
 'color-scheme': 'dark',
 '--sl-bg': '#0f1318', '--sl-surface': '#171c23', '--sl-surface-2': '#1c222b', '--sl-hover': '#232b36',
 '--sl-border': '#2b333e', '--sl-border-strong': '#3e4756', '--sl-input-border': '#64707f', '--sl-text': '#e4e8ee', '--sl-text-muted': '#9ba5b3',
 '--sl-accent': '#7aa2f7', '--sl-accent-hover': '#96b6fa', '--sl-accent-contrast': '#0f1318',
 '--sl-accent-soft': '#1f2b42', '--sl-accent-soft-text': '#b0c8fb', '--sl-ring': 'rgba(122, 162, 247, .35)',
 '--sl-link-visited': '#b89ef5', '--sl-star': '#e8b03c', '--sl-success': '#4cc38a',
 '--sl-danger': '#d1453d', '--sl-danger-hover': '#b83a33',
 '--sl-shadow-pop': '0 8px 24px rgba(0, 0, 0, .45), 0 2px 6px rgba(0, 0, 0, .30)',
 '--sl-shadow-dialog': '0 24px 64px rgba(0, 0, 0, .55), 0 4px 12px rgba(0, 0, 0, .35)',
 '--sl-backdrop': 'rgba(0, 0, 0, .55)', '--sl-scroll-thumb': '#3a4350', '--sl-scroll-thumb-hover': '#4f5a6b',
 '--sl-paper': '#f5f6f8', '--sl-paper-text': '#1c2430', '--sl-paper-link': '#2f63d0',
 '--sl-swap-bg': '#171c23', '--sl-swap-text': '#e4e8ee',
 '--sl-logo-filter': 'invert(1)',
 '--warning-clr': '#f0c060', '--warning-bg-clr': '#2e2614', '--warning-border-clr': '#5a4a22',
 '--error-clr': '#f28b82', '--error-bg-clr': '#3a1d1d', '--error-border-clr': '#6b2e2e',
 '--info-clr': '#b0c8fb', '--info-bg-clr': '#1a2540', '--info-border-clr': '#2f4270',
 '--folders-hover-bg-color': 'rgba(255, 255, 255, .06)', '--settings-menu-hover-bg-color': 'rgba(255, 255, 255, .06)',
}
head, marker, rest = src.partition('/* ==================== KOMPONENTEN')
assert marker
seen = set()
def repl(m):
    k = m.group(2)
    if k in dark:
        seen.add(k)
        return f'{m.group(1)}{k}: {dark[k]};'
    return m.group(0)
head = re.sub(r'^(\s*)(color-scheme|--[\w-]+):\s*[^;]+;', repl, head, flags=re.M)
head = head.replace("stroke='%235b6676'", "stroke='%239ba5b3'")
head = head.replace(' * Slate: ruhiges, helles Theme.', ' * SlateDark: dunkles Gegenstueck zu Slate (aus Slate/styles.css erzeugt).')
missing = set(dark) - seen
assert not missing, missing
(base / 'SlateDark').mkdir(exist_ok=True)
(base / 'SlateDark/styles.css').write_text(head + marker + rest, encoding='utf-8', newline='\n')
print('SlateDark geschrieben')
