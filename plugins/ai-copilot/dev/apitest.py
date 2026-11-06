"""Kleiner Testclient fuer die JSON-API (lokal, Testkonto).

    python apitest.py appdata
    python apitest.py call AiSummarize '{"folder":"INBOX","uids":[1,3]}'
    python apitest.py list INBOX
    python apitest.py stream '{"mode":"new","instruction":"..."}'
"""
import http.cookiejar
import json
import sys
import urllib.request

BASE = 'http://localhost:8888/'
USER, PASSWORD = 'test@example.com', 'test1234'

jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def get_json(url):
    with opener.open(urllib.request.Request(url, headers={'Accept': 'application/json'}), timeout=60) as r:
        return json.loads(r.read().decode())


def appdata():
    return get_json(BASE + '?/AppData/0/1/')


def post(action, params, token, timeout=200):
    body = dict(params, Action=action)
    req = urllib.request.Request(BASE + '?/Json/&q[]=/0/', data=json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json', 'Accept': 'application/json',
                                          'X-SM-Token': token})
    with opener.open(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def login():
    opener.open(BASE, timeout=30).read()
    data = appdata()
    token = data['System']['token']
    if not data.get('Auth'):
        r = post('Login', {'Email': USER, 'Password': PASSWORD}, token)
        if not r.get('Result'):
            raise SystemExit('Login fehlgeschlagen: ' + json.dumps(r)[:500])
        data = appdata()
        token = data['System']['token']
    return data, token


def main():
    data, token = login()
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'appdata'
    if 'appdata' == cmd:
        print(json.dumps({'Auth': data.get('Auth'), 'Plugins': data.get('Plugins')}, indent=1, ensure_ascii=False))
    elif 'call' == cmd:
        params = json.loads(sys.argv[3]) if len(sys.argv) > 3 else {}
        print(json.dumps(post('Plugin' + sys.argv[2], params, token), indent=1, ensure_ascii=False))
    elif 'raw' == cmd:
        params = json.loads(sys.argv[3]) if len(sys.argv) > 3 else {}
        print(json.dumps(post(sys.argv[2], params, token), indent=1, ensure_ascii=False)[:6000])
    elif 'list' == cmd:
        r = post('MessageList', {'folder': sys.argv[2], 'limit': 50, 'offset': 0, 'search': sys.argv[3] if len(sys.argv) > 3 else ''}, token)
        for m in (r.get('Result') or {}).get('@Collection', []):
            print(m['uid'], '|', m.get('aiCategory'), '|', m['subject'], '|', ','.join(m.get('flags', [])), '| threads', m.get('threads'))
    elif 'stream' == cmd:
        params = json.loads(sys.argv[2])
        req = urllib.request.Request(BASE + '?/AiStream/', data=json.dumps(params).encode(),
                                     headers={'Content-Type': 'application/json', 'X-SM-Token': token,
                                              'Accept': 'text/event-stream'})
        with opener.open(req, timeout=200) as r:
            print('Content-Type:', r.headers.get('Content-Type'))
            for line in r:
                line = line.decode().rstrip('\n')
                if line:
                    print(line[:300], flush=True)


if __name__ == '__main__':
    main()
