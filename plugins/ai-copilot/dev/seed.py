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


if __name__ == '__main__':
    if '--mails' not in sys.argv:
        accounts()
        snappymail_config()
    mails()
