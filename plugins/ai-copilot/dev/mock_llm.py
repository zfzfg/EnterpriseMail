"""Mock eines OpenAI-kompatiblen Servers (wie llmster/LM Studio) fuer Tests.

    python mock_llm.py [port]

Antwortet mit <think>-Bloecken und content als Liste (wie zai-Modelle), damit
das Entfernen von Thinking im Plugin geprueft werden kann. Streaming per SSE.
Lauscht nur auf 0.0.0.0:<port> fuer den Zugriff aus dem Container
(host.docker.internal). Nicht dauerhaft laufen lassen.
"""
import json
import re
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 1234


def chat_answer(messages):
    last = messages[-1]['content']
    question = next(m['content'] for m in reversed(messages) if m['role'] == 'user' and not m['content'].startswith('Werkzeug-Ergebnis'))
    if not last.startswith('Werkzeug-Ergebnis'):
        return json.dumps({'reply': 'Ich suche.', 'tool': {'name': 'search_mail', 'args': {'search': '', 'folder': 'INBOX'}}, 'actions': []})
    uid = int(re.search(r'"uid":(\d+)', last).group(1))
    kind = 'flag' if 'markiere' in question else 'mark_read'
    return json.dumps({'reply': 'Vorschlag:', 'tool': None, 'actions': [
        {'type': kind, 'folder': 'INBOX', 'uids': [uid], 'label': 'Mock-Aktion'}
    ]})


def answer(payload):
    messages = payload.get('messages') or []
    system = messages[0]['content'] if messages else ''
    if 'Fasse den Mailverlauf' in system or 'Fasse die ausgewählten' in system:
        return json.dumps({'tldr': 'Mock-Kurzfassung', 'points': ['Mock-Punkt'], 'decisions': ['Mock-Entscheidung'],
                           'actions': [{'who': 'Anna', 'what': 'Mock-Aufgabe', 'due': '2026-12-01'}], 'next': 'Mock-Schritt'})
    if 'Schlage genau drei' in system:
        time.sleep(1.5)  # long enough for a browser test to switch mails meanwhile
        return json.dumps({'replies': [{'label': 'Zusage', 'body': 'Mock-Antwort: gerne.'}, {'label': 'Rückfrage', 'body': 'Mock-Antwort: wann?'},
                                       {'label': 'Absage', 'body': 'Mock-Antwort: leider nein.'}]})
    if 'Copilot eines Webmailers' in system:
        return chat_answer(messages)
    if 'Suchsyntax' in system:
        return json.dumps({'search': 'subject:Rechnung', 'folder': '', 'explanation': 'Mock: Rechnungen'})
    if 'Kategorien' in system and 'items' in system:
        return json.dumps({'items': []})
    return 'Hallo,\n\ndas ist ein Mock-Entwurf.\n\nViele Grüße'


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path.endswith('/models'):
            self._json({'data': [{'id': 'mock-model'}]})
        else:
            self.send_error(404)

    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        payload = json.loads(self.rfile.read(length) or b'{}')
        text = answer(payload)
        print('Anfrage:', payload.get('model'), 'stream' if payload.get('stream') else '',
              'response_format' if 'response_format' in payload else '', flush=True)
        if payload.get('stream'):
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.end_headers()
            chunks = ['<think>interne Überlegung', ' noch mehr</think>'] + [text[i:i + 8] for i in range(0, len(text), 8)]
            for c in chunks:
                self.wfile.write(b'data: ' + json.dumps({'choices': [{'delta': {'content': c}}]}).encode() + b'\n\n')
                self.wfile.flush()
                time.sleep(0.05)
            self.wfile.write(b'data: [DONE]\n\n')
            return
        self._json({'choices': [{'message': {'role': 'assistant', 'content': [
            {'type': 'thinking', 'thinking': [{'type': 'text', 'text': 'geheim'}]},
            {'type': 'text', 'text': '<think>auch geheim</think>' + text}
        ]}}]})

    def _json(self, obj):
        body = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    print('Mock-LLM auf Port', PORT, flush=True)
    ThreadingHTTPServer(('0.0.0.0', PORT), Handler).serve_forever()
