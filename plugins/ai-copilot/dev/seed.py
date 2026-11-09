"""Testdaten fuer die lokale Entwicklung (nur ausgedachte Inhalte).

Aufruf aus plugins/ai-copilot/dev:
    python seed.py            # Konten, SnappyMail-Konfiguration, Testmails
    python seed.py --mails    # nur Testmails erneut einspielen

Legt an:
- Konten test@example.com und kollege@example.com (Passwort: test1234)
- Domain example.com in SnappyMail (IMAP 993 SSL, SMTP 587 STARTTLS)
- Plugins aktiv, ai-copilot eingeschaltet
- Testmails im Posteingang und unter Gesendet
"""
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from email.policy import SMTP
from email.utils import format_datetime, make_msgid

HERE = os.path.dirname(os.path.abspath(__file__))
ENV = dict(os.environ, MSYS_NO_PATHCONV='1')
PASSWORD = 'test1234'
ME = 'test@example.com'
NOW = datetime.now(timezone.utc)


def dc(*args, stdin=None, check=True):
    r = subprocess.run(['docker', 'compose', *args], cwd=HERE, env=ENV, input=stdin,
                       capture_output=True)
    if check and r.returncode != 0:
        raise SystemExit(f"Fehler: {' '.join(args)}\n{r.stdout.decode(errors='replace')}\n{r.stderr.decode(errors='replace')}")
    return r.stdout.decode(errors='replace')


def accounts():
    existing = dc('exec', '-T', 'mail', 'setup', 'email', 'list', check=False)
    for addr in (ME, 'kollege@example.com'):
        if addr not in existing:
            dc('exec', '-T', 'mail', 'setup', 'email', 'add', addr, PASSWORD)
            print('Konto angelegt:', addr)


PHP_CONFIG = r'''
$base = '/var/lib/snappymail/_data_/_default_/';
$d = json_decode(file_get_contents($base . 'domains/default.json'), true);
$d['IMAP']['host'] = 'mail.example.com'; $d['IMAP']['port'] = 993; $d['IMAP']['type'] = 1;
$d['IMAP']['disabled_capabilities'] = array_values(array_diff($d['IMAP']['disabled_capabilities'], ['PREVIEW']));
$d['SMTP']['host'] = 'mail.example.com'; $d['SMTP']['port'] = 587; $d['SMTP']['type'] = 2; $d['SMTP']['useAuth'] = true;
foreach (['IMAP', 'SMTP'] as $k) { $d[$k]['ssl']['verify_peer'] = true; $d[$k]['ssl']['verify_peer_name'] = true; }
file_put_contents($base . 'domains/example.com.json', json_encode($d, JSON_PRETTY_PRINT));
$ini = file_get_contents($base . 'configs/application.ini');
$ini = preg_replace('/(\[plugins\][^\[]*?)enable = Off/s', '$1enable = On', $ini);
$ini = preg_replace('/enabled_list = "[^"]*"/', 'enabled_list = "ai-copilot"', $ini);
// Entwicklung: kompiliertes Plugin-JS und HTTP-Cache nicht zwischenspeichern
$ini = preg_replace('/^system_data = On/m', 'system_data = Off', $ini);
$ini = preg_replace('/^http = On/m', 'http = Off', $ini);
file_put_contents($base . 'configs/application.ini', $ini);
echo "SnappyMail konfiguriert\n";
'''


def snappymail_config():
    out = dc('exec', '-T', '-u', 'www-data', 'snappymail', 'php', '-r', PHP_CONFIG)
    print(out.strip())


PHP_MOCK_LLM = r'''
$file = '/var/lib/snappymail/_data_/_default_/configs/plugin-ai-copilot.json';
$c = is_file($file) ? (json_decode(file_get_contents($file), true) ?: []) : [];
$c['plugin'] = array_merge($c['plugin'] ?? [], [
    'profile_default' => 'llmster',
    'llmster_base_url' => 'http://host.docker.internal:18234/v1',
    'llmster_model' => 'mock-model',
    'llmster_json_mode' => 'none',
]);
file_put_contents($file, json_encode($c, JSON_PRETTY_PRINT));
echo "KI-Profil auf den lokalen Mock gesetzt\n";
'''


def mock_llm_config():
    print(dc('exec', '-T', '-u', 'www-data', 'snappymail', 'php', '-r', PHP_MOCK_LLM).strip())


def eml(frm, to, subject, body, days_ago=0, hours_ago=0, cc=None, headers=None, msgid=None, in_reply_to=None, references=None):
    date = NOW - timedelta(days=days_ago, hours=hours_ago)
    msg = EmailMessage(policy=SMTP)
    msg['From'] = frm
    msg['To'] = to
    if cc:
        msg['Cc'] = cc
    msg['Subject'] = subject
    msg['Date'] = format_datetime(date)
    msg['Message-ID'] = msgid or make_msgid(domain='dev.example')
    if in_reply_to:
        msg['In-Reply-To'] = in_reply_to
    if references:
        msg['References'] = references
    for k, v in (headers or {}).items():
        msg[k] = v
    msg.set_content(body, charset='utf-8', cte='quoted-printable')
    return msg.as_bytes()


def save(mailbox, data, user=ME):
    dc('exec', '-T', 'mail', 'doveadm', 'save', '-u', user, '-m', mailbox, stdin=data)


def mails():
    # vorhandene Testmails entfernen
    for box in ('INBOX', 'Sent', 'Archive', 'Trash'):
        dc('exec', '-T', 'mail', 'doveadm', 'expunge', '-u', ME, 'mailbox', box, 'all', check=False)
    for box in ('Archive',):
        dc('exec', '-T', 'mail', 'doveadm', 'mailbox', 'create', '-u', ME, '-s', box, check=False)

    anna = 'Anna Müller <anna.mueller@kunde.example>'
    id1, id2, id3 = '<angebot-1@kunde.example>', '<angebot-2@example.com>', '<angebot-3@kunde.example>'
    save('INBOX', eml(anna, ME, 'Anfrage Geländer Wohnhaus Müller',
        'Hallo Herr Test,\n\nwir planen für unser Wohnhaus in der Lindenstraße 12 ein neues Treppengeländer aus Edelstahl,\n'
        'etwa 9 Meter, innen, mit Handlauf. Können Sie uns ein Angebot machen?\n\nViele Grüße\nAnna Müller',
        days_ago=9, msgid=id1))
    save('Sent', eml(f'Test Nutzer <{ME}>', anna, 'Re: Anfrage Geländer Wohnhaus Müller',
        'Hallo Frau Müller,\n\ndanke für Ihre Anfrage. Für ein genaues Angebot würden wir gerne vor Ort aufmessen.\n'
        'Passt Ihnen der kommende Dienstag um 10 Uhr?\n\nViele Grüße\nTest Nutzer\n\n> Hallo Herr Test,\n> wir planen ...',
        days_ago=8, msgid=id2, in_reply_to=id1, references=id1))
    save('INBOX', eml(anna, ME, 'Re: Anfrage Geländer Wohnhaus Müller',
        'Hallo Herr Test,\n\nDienstag 10 Uhr passt uns gut. Zwei Fragen vorab:\n'
        '1. Wie lange ist die Lieferzeit nach Auftrag ungefähr?\n'
        '2. Können Sie das alte Holzgeländer mit entsorgen?\n\n'
        'Wir möchten bis Ende November entscheiden.\n\nViele Grüße\nAnna Müller\n\n'
        'Am 29.10.2026 schrieb Test Nutzer:\n> Hallo Frau Müller,\n> danke für Ihre Anfrage.',
        days_ago=3, msgid=id3, in_reply_to=id2, references=f'{id1} {id2}'))

    save('INBOX', eml('Werkzeug-Shop <news@werkzeugshop.example>', ME, 'Herbst-Sale: 20 % auf Schweißgeräte',
        'Nur diese Woche: 20 % Rabatt auf alle Schweißgeräte und Zubehör.\nJetzt im Shop ansehen.\n\nAbmelden: https://werkzeugshop.example/abmelden',
        days_ago=1, headers={'List-Unsubscribe': '<https://werkzeugshop.example/abmelden>', 'Precedence': 'bulk'}))

    save('INBOX', eml('Stahlhandel Nord Buchhaltung <noreply@stahlhandel.example>', ME, 'Rechnung 2026-1043',
        'Sehr geehrte Damen und Herren,\n\nanbei erhalten Sie die Rechnung 2026-1043 über 1.284,50 EUR für die Lieferung vom 28.10.2026.\n'
        'Zahlbar bis 20.11.2026 ohne Abzug.\n\nMit freundlichen Grüßen\nStahlhandel Nord',
        days_ago=2))

    save('INBOX', eml('Paketdienst <noreply@paket.example>', ME, 'Ihre Sendung ist unterwegs',
        'Ihre Sendung 00340434 wird morgen zwischen 9 und 13 Uhr zugestellt.',
        hours_ago=5, headers={'Auto-Submitted': 'auto-generated'}))

    save('INBOX', eml('Kollege <kollege@example.com>', ME, 'Termin Donnerstag Baustelle Hafenstraße?',
        'Hi,\n\nkannst du am Donnerstag um 7:30 mit zur Baustelle Hafenstraße? Ich bräuchte Hilfe beim Setzen der Stützen.\n'
        'Sag mir bitte bis morgen Bescheid.\n\nGruß\nKollege',
        days_ago=4))

    save('INBOX', eml('Planungsbüro Weber <info@weber-planung.example>', 'bauleitung@weber-planung.example', 'Protokoll Baubesprechung KW 45',
        'Hallo zusammen,\n\nanbei das Protokoll der Baubesprechung. Wichtig: Montage der Balkongeländer verschiebt sich auf KW 48.\n\nGrüße\nWeber',
        days_ago=1, cc=ME))

    save('Sent', eml(f'Test Nutzer <{ME}>', 'Bauamt <bauamt@stadt.example>', 'Anfrage Genehmigung Außentreppe Gartenweg 3',
        'Sehr geehrte Damen und Herren,\n\nwir bitten um Auskunft, ob für die geplante Außentreppe am Gartenweg 3 eine Genehmigung nötig ist.\n\nMit freundlichen Grüßen\nTest Nutzer',
        days_ago=5))
    print('Testmails eingespielt')


THEME_HTML = '''<!doctype html><html><body style="margin:0;background:#f2f2f2">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f2"><tr><td align="center" style="padding:24px">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:6px;font-family:Arial,sans-serif;color:#222222">
<tr><td style="background:#1d3557;color:#ffffff;padding:20px 24px;font-size:20px;font-weight:bold">Werkzeug-Shop Newsletter</td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.5;color:#333333">
<p>Hallo Test Nutzer,</p>
<p>diese Woche im Angebot: <b style="color:#c1121f">Schutzhandschuhe</b> und Schleifscheiben.
Text in fester dunkler Farbe, damit man sieht, ob er im dunklen Theme lesbar bleibt.</p>
<p><a href="https://werkzeugshop.example/angebote" style="display:inline-block;background:#e63946;color:#ffffff;padding:10px 18px;border-radius:4px;text-decoration:none">Zu den Angeboten</a></p>
<p>Ein normaler Link ohne eigene Farbe: <a href="https://werkzeugshop.example/hilfe">Hilfe</a>.</p>
<blockquote style="margin:0;padding-left:10px">Zitat aus einer frueheren Mail.</blockquote>
</td></tr></table></td></tr></table></body></html>'''


def theme_mails():
    """Zusaetzliche Grenzfaelle fuer Theme-Tests (keine KI-Aufrufe noetig)."""
    m = EmailMessage(policy=SMTP)
    m['From'] = 'Werkzeug-Shop <news@werkzeugshop.example>'
    m['To'] = ME
    m['Subject'] = 'Theme-Test: HTML-Newsletter mit festen Farben'
    m['Date'] = format_datetime(NOW - timedelta(minutes=30))
    m['Message-ID'] = make_msgid(domain='dev.example')
    m['List-Unsubscribe'] = '<https://werkzeugshop.example/abmelden>'
    m.set_content('Werkzeug-Shop Newsletter (Textversion)', charset='utf-8')
    m.add_alternative(THEME_HTML, subtype='html', charset='utf-8')
    save('INBOX', m.as_bytes())

    lang = ('Theme-Test: Sehr langer Betreff zur Prüfung von Umbrüchen und Abschneiden in der Liste, '
            'Auftrag 2026-11-0815 Geländer Treppenhaus Hinterhaus Lindenstraße 12, Nachtrag 3 von 7, bitte bis Freitag prüfen')
    m = EmailMessage(policy=SMTP)
    m['From'] = 'sehr.lange.absenderadresse.ohne.leerzeichen.fuer.den.test@ein-ziemlich-langer-domainname.example'
    m['To'] = ME
    m['Subject'] = lang
    m['Date'] = format_datetime(NOW - timedelta(minutes=40))
    m['Message-ID'] = make_msgid(domain='dev.example')
    m.set_content('Mail mit mehreren Anhängen.\n\n> Zitierter Text\n>> doppelt zitiert', charset='utf-8')
    for name in ('Aufmass_Treppenhaus_Hinterhaus_Lindenstrasse_12_final_v3.pdf', 'Foto1.jpg', 'Kalkulation.xlsx'):
        m.add_attachment(b'Testinhalt, ausgedacht.\n', maintype='application', subtype='octet-stream', filename=name)
    save('INBOX', m.as_bytes())

    save('INBOX', eml('مكتب الهندسة <info@rtl.example>', ME, 'Theme-Test: نص من اليمين إلى اليسار – Ölçü ✓',
        'Gemischte Schriftrichtungen: مرحبا بالعالم. Umlaute: äöüß.', hours_ago=1))
    save('INBOX', eml('A <a@example.com>', ME, '', 'Mail ohne Betreff.', hours_ago=2))
    # zuletzt gespeicherte Mail markieren (Stern)
    dc('exec', '-T', 'mail', 'doveadm', 'flags', 'add', '-u', ME, '\\Flagged', 'mailbox', 'INBOX', 'subject', 'Theme-Test: Sehr', check=False)
    print('Theme-Testmails eingespielt')


def _png(width, height, rgb):
    """Einfarbiges PNG fuer Inline- und Anhangsbilder."""
    import struct
    import zlib
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    raw = b''.join(b'\x00' + bytes(rgb) * width for _ in range(height))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))


PNG_RED = _png(64, 48, (250, 81, 17))

FEATURE_HTML = '''<!doctype html><html><head><style>.box{padding:12px;border:1px solid #ccc}</style></head><body>
<h2>Funktionstest: HTML mit externen Bildern</h2>
<p>Externes Bild (muss blockiert sein): <img src="https://bilder.werkzeugshop.example/banner.png" width="300" height="80" alt="Banner"></p>
<p>Inline-Bild per cid: <img src="cid:logo123@dev.example" width="32" height="32" alt="Logo"></p>
<p>Tracking-Pixel (wird entfernt): <img src="https://tracker.example/track/open?id=42" width="1" height="1"></p>
<p><a href="https://werkzeugshop.example/angebote?utm_source=mail&amp;utm_campaign=herbst&amp;id=7">Link mit Tracking-Parametern</a></p>
<div class="box" style="background:url(https://bilder.werkzeugshop.example/hintergrund.jpg)">Box mit externem Hintergrund</div>
<blockquote>Zitat Ebene 1<blockquote>Zitat Ebene 2</blockquote></blockquote>
<script>alert("darf nie laufen")</script>
</body></html>'''

ICS = '''BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//dev.example//Test//DE
METHOD:REQUEST
BEGIN:VEVENT
UID:termin-1@dev.example
DTSTART:20261112T090000Z
DTEND:20261112T100000Z
SUMMARY:Aufmaß Lindenstraße 12
LOCATION:Lindenstraße 12\\, Musterstadt
ORGANIZER;CN=Anna Müller:mailto:anna.mueller@kunde.example
END:VEVENT
END:VCALENDAR
'''


def feature_mails():
    """Testmails fuer Phase 1: Bilder, Tracking, Anhaenge, Termin, Lesebestaetigung, Abmelden, Spam, Entwurf."""
    m = EmailMessage(policy=SMTP)
    m['From'] = 'Werkzeug-Shop <news@werkzeugshop.example>'
    m['To'] = ME
    m['Subject'] = 'Funktionstest: HTML, Bilder, Tracking, Abmelden'
    m['Date'] = format_datetime(NOW - timedelta(minutes=10))
    m['Message-ID'] = make_msgid(domain='dev.example')
    m['List-Unsubscribe'] = '<mailto:abmelden@werkzeugshop.example?subject=abmelden>, <https://werkzeugshop.example/abmelden?u=42>'
    m['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click'
    m['Disposition-Notification-To'] = 'news@werkzeugshop.example'
    m.set_content('Textversion des Funktionstests.\n\n> Zitat\n>> doppelt\n\nLink: https://werkzeugshop.example/?utm_source=x', charset='utf-8')
    m.add_alternative(FEATURE_HTML, subtype='html', charset='utf-8')
    m.get_payload()[1].add_related(PNG_RED, maintype='image', subtype='png', cid='<logo123@dev.example>', filename='logo.png')
    save('INBOX', m.as_bytes())

    m = EmailMessage(policy=SMTP)
    m['From'] = 'Anna Müller <anna.mueller@kunde.example>'
    m['To'] = ME
    m['Cc'] = 'Kollege <kollege@example.com>, buero@kunde.example'
    m['Reply-To'] = 'Büro Müller <buero@kunde.example>'
    m['Subject'] = 'Funktionstest: Anhänge und Termin'
    m['Date'] = format_datetime(NOW - timedelta(minutes=20))
    m['Message-ID'] = make_msgid(domain='dev.example')
    m.set_content('Hallo,\n\nanbei Foto, Aufmaß und die Einladung zum Termin.\n\nGrüße\nAnna Müller', charset='utf-8')
    m.add_attachment(PNG_RED, maintype='image', subtype='png', filename='Foto_Treppe.png')
    m.add_attachment(b'%PDF-1.4\n% ausgedacht\n', maintype='application', subtype='pdf', filename='Aufmass.pdf')
    m.add_attachment(ICS.encode(), maintype='text', subtype='calendar', filename='termin.ics')
    save('INBOX', m.as_bytes())

    m = EmailMessage(policy=SMTP)
    m['From'] = 'Gewinnspiel <win@spam.example>'
    m['To'] = ME
    m['Subject'] = 'Funktionstest: Sie haben gewonnen'
    m['Date'] = format_datetime(NOW - timedelta(minutes=30))
    m['Message-ID'] = make_msgid(domain='dev.example')
    m['X-Spam-Status'] = 'Yes, score=9.8 required=5.0'
    m['X-Spam-Flag'] = 'YES'
    m['X-Spam-Score'] = '9.8'
    m.set_content('Klicken Sie hier. (Testmail, ausgedacht)', charset='utf-8')
    save('INBOX', m.as_bytes())

    save('Drafts', eml(f'Test Nutzer <{ME}>', 'anna.mueller@kunde.example', 'Funktionstest: Entwurf Angebot',
        'Hallo Frau Müller,\n\nhier der Entwurf für das Angebot …', hours_ago=1))
    dc('exec', '-T', 'mail', 'doveadm', 'flags', 'add', '-u', ME, '\\Draft', 'mailbox', 'Drafts', 'all', check=False)
    dc('exec', '-T', 'mail', 'doveadm', 'flags', 'add', '-u', ME, 'Projekt-Linde', 'mailbox', 'INBOX', 'subject', 'Funktionstest: Anh', check=False)
    dc('exec', '-T', 'mail', 'doveadm', 'flags', 'add', '-u', ME, '\\Flagged', 'mailbox', 'INBOX', 'subject', 'Funktionstest: Anh', check=False)
    print('Funktionstest-Mails eingespielt')


def folder_mails():
    """Testdaten fuer Phase 3: verschachtelte Ordner, nicht abonnierter Ordner, Thread, Groessen, Kontingent."""
    # Maildir ohne eigenes Trennzeichen nutzt '.'
    sep = dc('exec', '-T', 'mail', 'doveconf', '-h', 'namespace/inbox/separator', check=False).strip() or '.'
    boxes = [('Projekte', True), (f'Projekte{sep}Linde', True), (f'Projekte{sep}Linde{sep}Aufmass', True),
             (f'Projekte{sep}Hafen', True), (f'Alt{sep}2019', False), ('Leer', True)]
    for box, subscribe in boxes:
        args = ['exec', '-T', 'mail', 'doveadm', 'mailbox', 'create', '-u', ME]
        if subscribe:
            args.append('-s')
        dc(*args, box, check=False)
    for box, _ in boxes:
        dc('exec', '-T', 'mail', 'doveadm', 'expunge', '-u', ME, 'mailbox', box, 'all', check=False)
    dc('exec', '-T', 'mail', 'doveadm', 'mailbox', 'unsubscribe', '-u', ME, f'Alt{sep}2019', check=False)

    save(f'Projekte{sep}Linde', eml('Anna Müller <anna.mueller@kunde.example>', ME, 'Linde: Farbe Geländer',
        'Wir nehmen RAL 7016 anthrazit.', days_ago=12))
    save(f'Projekte{sep}Linde{sep}Aufmass', eml('Kollege <kollege@example.com>', ME, 'Aufmaß Lindenstraße',
        'Treppe 9,20 m, 14 Steigungen.', days_ago=11))
    save(f'Projekte{sep}Hafen', eml('Planungsbüro Weber <info@weber-planung.example>', ME, 'Hafenstraße Statik',
        'Statik kommt Freitag.', days_ago=6))
    save(f'Alt{sep}2019', eml('Altkunde <alt@kunde.example>', ME, 'Alte Anfrage 2019', 'Archivierte Anfrage.', days_ago=400))

    # Thread im Posteingang mit drei Mails, eine davon ungelesen
    t1, t2, t3 = '<hafen-1@kollege.example>', '<hafen-2@example.com>', '<hafen-3@kollege.example>'
    save('INBOX', eml('Kollege <kollege@example.com>', ME, 'Stützen Hafenstraße', 'Welche Stützen nehmen wir?', days_ago=20, msgid=t1))
    save('INBOX', eml(f'Test Nutzer <{ME}>', 'kollege@example.com', 'Re: Stützen Hafenstraße', 'HEB 140.', days_ago=19, msgid=t2,
        in_reply_to=t1, references=t1))
    save('INBOX', eml('Kollege <kollege@example.com>', ME, 'Re: Stützen Hafenstraße', 'Gut, bestelle ich.', days_ago=18, msgid=t3,
        in_reply_to=t2, references=f'{t1} {t2}'))
    dc('exec', '-T', 'mail', 'doveadm', 'flags', 'add', '-u', ME, '\\Seen', 'mailbox', 'INBOX', 'subject', 'Stützen Hafenstraße',
       'before', '19d', check=False)

    # Grosse Mail fuer die Groessensuche (ca. 300 KB)
    save('INBOX', eml('Stahlhandel Nord <info@stahlhandel.example>', ME, 'Preisliste 2027 (groß)',
        'Preisliste\n' + ('Rohr 40x40x3 je Meter 7,80 EUR\n' * 9000), days_ago=7))
    # Spam zum Leeren
    for i in range(2):
        save('Junk', eml('Gewinn <win@spam.example>', ME, f'Spam {i + 1}', 'Ausgedachter Spam.', days_ago=i))
    dc('exec', '-T', 'mail', 'setup', 'quota', 'set', ME, '200M', check=False)
    print(f'Ordner-Testdaten eingespielt (Trennzeichen {sep!r})')


if __name__ == '__main__':
    if '--folder-mails' in sys.argv:
        folder_mails()
        sys.exit()
    if '--theme-mails' in sys.argv:
        theme_mails()
        sys.exit()
    if '--feature-mails' in sys.argv:
        feature_mails()
        sys.exit()
    if '--mock-llm' in sys.argv:
        mock_llm_config()
        sys.exit()
    if '--mails' not in sys.argv:
        accounts()
        snappymail_config()
    mails()
