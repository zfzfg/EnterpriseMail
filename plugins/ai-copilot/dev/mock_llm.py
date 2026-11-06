"""Mock eines OpenAI-kompatiblen Servers (wie llmster/LM Studio) fuer Tests.

    python mock_llm.py [port]

Antwortet mit <think>-Bloecken und content als Liste (wie zai-Modelle), damit
das Entfernen von Thinking im Plugin geprueft werden kann. Streaming per SSE.
Lauscht nur auf 0.0.0.0:<port> fuer den Zugriff aus dem Container
(host.docker.internal). Nicht dauerhaft laufen lassen.
"""
import json
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 1234


def answer(payload):
    system = payload['messages'][0]['content'] if payload.get('messages') else ''
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
