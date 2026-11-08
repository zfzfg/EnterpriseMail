#!/usr/bin/env python3
"""Real Phase 5 integration test. Uses only the isolated loopback mock provider."""

import http.client
import http.cookiejar
import json
import os
import re
import shlex
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
COMPOSE = shlex.split(os.environ.get('COMPOSE', 'docker compose'))
PROJECT = 'snappymail-phase5'
APP = 'snappymail-phase5-app'
PREFIX = 'snappymail-phase5-prefix'
MAIL = 'snappymail-phase5-mail'
PHP_ONLY = 'snappymail-phase5-php-only'
FATAL = 'snappymail-phase5-fatal'
CREDENTIAL = 'phase5-service-credential-32-bytes'
PROVIDER_KEY = 'phase5-provider-key-marker'
PROMPT_MARKER = 'PHASE5_PROMPT_SECRET'
DRAFT = {
    'mode': 'new', 'tone': '', 'instruction': PROMPT_MARKER + ' Schreibe eine kurze Antwort.',
    'current': '', 'wantSubject': True, 'folder': '', 'uids': [], 'sent': ''
}
ENV = dict(os.environ, MSYS_NO_PATHCONV='1')
CHECKS = 0


def check(condition, message):
    global CHECKS
    CHECKS += 1
    if not condition:
        raise AssertionError(message)


def run(args, *, check_result=True, timeout=60):
    result = subprocess.run(args, env=ENV, capture_output=True, text=True, timeout=timeout)
    if check_result and result.returncode:
        raise RuntimeError(f"Command failed ({result.returncode}): {args[:3]}\n{result.stdout[-2000:]}\n{result.stderr[-2000:]}")
    return result


def dc(*args, check_result=True, timeout=60):
    return run([*COMPOSE, '-p', PROJECT, '-f', str(HERE / 'docker-compose.yml'), *args],
               check_result=check_result, timeout=timeout)


def docker(*args, check_result=True, timeout=60):
    return run(['docker', *args], check_result=check_result, timeout=timeout)


def wait_until(callback, message, timeout=45):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            last = callback()
            if last:
                return last
        except Exception as error:
            last = error
        time.sleep(0.5)
    raise AssertionError(f'{message}; last={last!r}')


def provider_requests():
    result = docker('exec', APP, 'php', '-r',
                    '$p="/tmp/phase5-provider.jsonl"; echo is_file($p) ? file_get_contents($p) : "";')
    return [json.loads(line) for line in result.stdout.splitlines() if line.strip()]


def provider_count():
    return sum(item.get('event') == 'request' for item in provider_requests())


def set_admin_draft(enabled):
    code = '''$p='/var/lib/snappymail/_data_/_default_/configs/plugin-ai-copilot.json';
$d=json_decode(file_get_contents($p),true); $d['plugin']['feature_draft']=$enabled;
file_put_contents($p,json_encode($d,JSON_PRETTY_PRINT));'''
    docker('exec', '-u', 'www-data', APP, 'php', '-r', code.replace('$enabled', 'true' if enabled else 'false'))


def find_plugin_config(value):
    if isinstance(value, dict):
        if 'providers' in value and 'features' in value and 'storeKeywords' in value:
            return value
        for child in value.values():
            found = find_plugin_config(child)
            if found is not None:
                return found
    elif isinstance(value, list):
        for child in value:
            found = find_plugin_config(child)
            if found is not None:
                return found
    return None


def has_key(value, wanted):
    if isinstance(value, dict):
        return wanted in value or any(has_key(child, wanted) for child in value.values())
    if isinstance(value, list):
        return any(has_key(child, wanted) for child in value)
    return False


def parse_sse(body):
    events = []
    for block in re.split(r'\r?\n\r?\n', body):
        name = None
        data = []
        for line in block.splitlines():
            if line.startswith('event:'):
                name = line[6:].strip()
            elif line.startswith('data:'):
                data.append(line[5:].lstrip())
        if name:
            events.append({'event': name, 'data': json.loads('\n'.join(data))})
    return events


class Client:
    def __init__(self, base):
        self.base = base
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.token = ''

    def request(self, path, *, method='GET', body=None, headers=None, timeout=30):
        data = None if body is None else json.dumps(body).encode()
        request_headers = {'Accept': 'application/json', **(headers or {})}
        if data is not None:
            request_headers['Content-Type'] = 'application/json'
        request = urllib.request.Request(self.base + path, data=data, headers=request_headers, method=method)
        try:
            with self.opener.open(request, timeout=timeout) as response:
                return response.status, response.headers, response.read()
        except urllib.error.HTTPError as error:
            return error.code, error.headers, error.read()

    def json(self, path, **kwargs):
        status, _, body = self.request(path, **kwargs)
        try:
            return status, json.loads(body)
        except json.JSONDecodeError:
            raise AssertionError(f'Non-JSON response from {path}: HTTP {status}, {body[:200]!r}')

    def appdata(self):
        status, data = self.json('?/AppData/0/1/')
        check(status == 200, 'AppData did not return HTTP 200')
        self.token = data['System']['token']
        return data

    def post(self, action, params):
        status, data = self.json('?/Json/&q[]=/0/', method='POST', body={'Action': action, **params},
                                 headers={'X-SM-Token': self.token})
        check(status == 200, f'{action} returned HTTP {status}')
        return data

    def login(self):
        self.request('')
        data = self.appdata()
        deadline = time.time() + 60
        result = None
        while not data.get('Auth') and time.time() < deadline:
            result = self.post('Login', {'Email': 'test@example.com', 'Password': 'test1234'})
            if result.get('Result'):
                data = self.appdata()
                break
            if result.get('code') != 104:
                break
            time.sleep(1)
            data = self.appdata()
        check(bool(data.get('Auth')), f'Fixture login failed: {result}')
        return data

    def save_settings(self, settings):
        result = self.post('PluginAiSaveSettings', {'settings': settings})
        check(bool((result.get('Result') or {}).get('saved')), f'Could not save fixture settings: {result}')

    def stream(self, route, draft=None, extra_headers=None):
        headers = {'X-SM-Token': self.token, 'Accept': 'text/event-stream',
                   'Sec-Fetch-Site': 'same-origin', **(extra_headers or {})}
        status, response_headers, body = self.request(route, method='POST', body=draft or DRAFT,
                                                      headers=headers, timeout=40)
        check(status == 200, f'Stream returned HTTP {status}: {body[:200]!r}')
        check((response_headers.get('Content-Type') or '').startswith('text/event-stream'),
              'Stream did not return SSE')
        return parse_sse(body.decode()), response_headers

    def cancel_stream(self):
        parsed = urllib.parse.urlsplit(self.base)
        connection = http.client.HTTPConnection(parsed.hostname, parsed.port, timeout=30)
        path = (parsed.path or '/') + 'api/ai/stream'
        cookie = '; '.join(f'{cookie.name}={cookie.value}' for cookie in self.jar)
        body = dict(DRAFT, instruction='CANCEL_PHASE5 ' + PROMPT_MARKER)
        connection.request('POST', path, body=json.dumps(body), headers={
            'Content-Type': 'application/json', 'Accept': 'text/event-stream',
            'X-SM-Token': self.token, 'Cookie': cookie, 'Sec-Fetch-Site': 'same-origin'
        })
        response = connection.getresponse()
        check(response.status == 200, 'Cancellation stream did not start')
        received = b''
        while b'event: delta' not in received:
            line = response.readline()
            check(bool(line), 'Cancellation stream ended before a delta')
            received += line
        response.close()
        connection.close()


def internal_prepare(client, credential=CREDENTIAL, cookies=True, csrf=True):
    cookie = '; '.join(f'{item.name}={item.value}' for item in client.jar) if cookies else ''
    token = client.token if csrf else ''
    code = '''$headers=['Content-Type: application/json','Accept: application/json',
'X-Request-ID: 123e4567-e89b-42d3-a456-426614174000','Sec-Fetch-Site: same-origin'];
if ($argv[1] !== '') $headers[]='X-Snappy-Proxy-Key: '.$argv[1];
if ($argv[2] !== '') $headers[]='Cookie: '.$argv[2];
if ($argv[3] !== '') $headers[]='X-SM-Token: '.$argv[3];
$context=stream_context_create(['http'=>['method'=>'POST','header'=>implode("\r\n",$headers),
'content'=>$argv[4],'ignore_errors'=>true,'timeout'=>10]]);
$body=file_get_contents('http://127.0.0.1:8081/internal/ai/prepare',false,$context);
$status=0; foreach ($http_response_header ?? [] as $line) if (preg_match('#^HTTP/\\S+ (\\d+)#',$line,$m)) $status=(int)$m[1];
$json=json_decode((string)$body,true); echo json_encode(['status'=>$status,'body'=>$json]);'''
    result = docker('exec', APP, 'php', '-r', code, '--', credential, cookie, token, json.dumps(DRAFT))
    response = json.loads(result.stdout)
    return response['status'], response['body']


def wait_health(client, expected):
    def probe():
        status, _, _ = client.request('healthz', timeout=3)
        return status == expected
    wait_until(probe, f'Health did not become HTTP {expected}')


def successful_events(events):
    check([item['event'] for item in events] == ['start', 'delta', 'delta', 'done'],
          f'Unexpected successful SSE sequence: {events}')
    done = events[-1]['data']
    check(done['subject'] == 'Grüße ✓', 'Subject compatibility failed')
    check(done['body'] == 'Hallo Phase 5 ✓', 'Body compatibility failed')
    check(done['model'] == 'llmster · zai-phase5-mock', 'Model label compatibility failed')
    check('PRIVATE_FIXTURE_THINKING' not in json.dumps(events), 'Reasoning content leaked downstream')


def main():
    direct = Client('http://127.0.0.1:18880/')
    prefixed = Client('http://127.0.0.1:18881/mail/')

    wait_until(lambda: direct.request('healthz', timeout=3)[0] == 204, 'Application did not become healthy', 90)
    wait_until(lambda: prefixed.request('healthz', timeout=3)[0] == 204, 'Prefix proxy did not become healthy', 30)
    wait_until(lambda: docker('exec', PHP_ONLY, 'wget', '-q', '-T', '3', '-O', '/dev/null',
                              'http://127.0.0.1:8888/healthz', check_result=False).returncode == 0,
               'Default PHP-only health was not successful', 30)
    check(docker('exec', PHP_ONLY, 'sh', '-c', 'pidof snappy-ai-proxy', check_result=False).returncode != 0,
          'Rust started despite default-disabled mode')
    exposed = json.loads(docker('image', 'inspect', 'snappymail-phase5:latest', '--format', '{{json .Config.ExposedPorts}}').stdout)
    check(list(exposed) == ['8888/tcp'], f'Image exposes unintended ports: {exposed}')

    def create_account():
        existing = docker('exec', MAIL, 'setup', 'email', 'list', check_result=False)
        if existing.returncode == 0 and 'test@example.com' in existing.stdout:
            return True
        return docker('exec', MAIL, 'setup', 'email', 'add', 'test@example.com', 'test1234', check_result=False).returncode == 0
    wait_until(create_account, 'Could not create the isolated fixture account', 60)

    app_config = r'''$base='/var/lib/snappymail/_data_/_default_/';
$d=json_decode(file_get_contents($base.'domains/default.json'),true);
$d['IMAP']['host']='mail.example.com'; $d['IMAP']['port']=993; $d['IMAP']['type']=1;
$d['SMTP']['host']='mail.example.com'; $d['SMTP']['port']=587; $d['SMTP']['type']=2; $d['SMTP']['useAuth']=true;
foreach(['IMAP','SMTP'] as $k){$d[$k]['ssl']['verify_peer']=true;$d[$k]['ssl']['verify_peer_name']=true;}
file_put_contents($base.'domains/example.com.json',json_encode($d,JSON_PRETTY_PRINT));
$ini=file_get_contents($base.'configs/application.ini');
$ini=preg_replace('/(\[plugins\][^\[]*?)enable = Off/s','$1enable = On',$ini);
$ini=preg_replace('/enabled_list = "[^"]*"/','enabled_list = "ai-copilot"',$ini);
$ini=preg_replace('/^system_data = On/m','system_data = Off',$ini);
$ini=preg_replace('/^http = On/m','http = Off',$ini);
file_put_contents($base.'configs/application.ini',$ini);
$p=$base.'configs/plugin-ai-copilot.json'; $c=file_exists($p)?json_decode(file_get_contents($p),true):[];
$c['plugin']=array_merge($c['plugin']??[],[
'feature_draft'=>true,'profile_default'=>'llmster',
'llmster_base_url'=>'http://127.0.0.1:18080/v1','llmster_model'=>'zai-phase5-mock',
'llmster_timeout'=>20,'llmster_json_mode'=>'none']);
file_put_contents($p,json_encode($c,JSON_PRETTY_PRINT));'''
    docker('exec', '-u', 'www-data', APP, 'php', '-r', app_config)

    status, unauthenticated = direct.json('?/AppData/0/1/')
    check(status == 200 and not has_key(unauthenticated, 'rustStream'), 'Guest AppData advertised Rust')
    status, admin = direct.json('?/AdminAppData/0/12345/')
    check(status == 200 and not has_key(admin, 'rustStream'), 'Admin AppData advertised Rust')
    data = direct.login()
    plugin = find_plugin_config(data)
    check(plugin is not None, 'Authenticated AppData omitted ai-copilot configuration')
    check(plugin.get('rustStream') == {'route': 'api/ai/stream'}, f'Rust capability missing or unsafe: {plugin}')
    check(PROVIDER_KEY not in json.dumps(data) and CREDENTIAL not in json.dumps(data), 'AppData exposed a secret')

    # The test-only public probe returns no secret values. It proves that FPM
    # receives only its explicit environment allowlist and the direct peer address.
    status, runtime = direct.json('phase5-runtime-probe.php')
    check(status == 200, 'Runtime probe was not available')
    check(runtime.get('rust_enabled') is True, 'FPM lost the Rust enablement setting')
    check(runtime.get('service_credential_available') is True, 'FPM lost the prepare service credential')
    check(runtime.get('provider_key_available') is True, 'FPM lost the configured provider environment key')
    check(runtime.get('unrelated_environment_absent') is True, 'FPM exposed an unrelated process secret')
    spoofed_ip = '203.0.113.221'
    spoof_headers = {'X-Real-IP': spoofed_ip, 'X-Forwarded-For': spoofed_ip}
    status, direct_spoof = direct.json('phase5-runtime-probe.php', headers=spoof_headers)
    check(status == 200 and direct_spoof.get('remote_addr') == runtime.get('remote_addr'),
          'Direct client spoofed PHP REMOTE_ADDR')
    check(direct_spoof.get('remote_addr') != spoofed_ip, 'PHP trusted an arbitrary X-Real-IP')
    status, prefix_spoof = prefixed.json('phase5-runtime-probe.php', headers=spoof_headers)
    check(status == 200 and prefix_spoof.get('remote_addr') != spoofed_ip,
          'Reverse-proxy topology forwarded a spoofed client address')

    # Make repeated fixture runs deterministic without deleting any volume.
    set_admin_draft(True)
    direct.save_settings({'enabled': True, 'notice_ack': False, 'features': {'draft': True}})

    before = provider_count()
    for client in (direct, prefixed):
        status, _, _ = client.request('internal/ai/prepare', method='POST', body=DRAFT)
        check(status == 404, 'Public private-prepare path was not hidden')
        status, body = client.json('?/AiPrepare/', method='POST', body=DRAFT,
                                   headers={'X-SM-Token': client.token})
        check(status == 403 and body.get('code') == 'prepare_forbidden', 'Public AiPrepare action was accepted')
    status, _, _ = direct.request('api/ai/stream', method='GET')
    check(status == 405, 'Public Rust route accepted GET')
    check(provider_count() == before, 'Public prepare rejection reached the provider')

    before = provider_count()
    events, _ = direct.stream('api/ai/stream')
    check(events[-1]['data'].get('code') == 'consent_required', f'Consent was not enforced: {events}')
    check(provider_count() == before, 'Consent rejection reached the provider')
    direct.save_settings({'enabled': True, 'notice_ack': True})

    for gate in ('user_feature', 'user', 'admin'):
        if gate == 'user_feature':
            direct.save_settings({'features': {'draft': False}})
        elif gate == 'user':
            direct.save_settings({'enabled': False})
        else:
            set_admin_draft(False)
        before = provider_count()
        events, _ = direct.stream('api/ai/stream')
        check(events[-1]['data'].get('code') == 'feature_disabled', f'{gate} gate failed: {events}')
        check(provider_count() == before, f'{gate} gate reached the provider')
        if gate == 'user_feature':
            direct.save_settings({'features': {'draft': True}})
        elif gate == 'user':
            direct.save_settings({'enabled': True})
        else:
            set_admin_draft(True)

    before = provider_count()
    status, body = internal_prepare(direct, credential='')
    check(status == 403 and body == {'code': 'prepare_forbidden'}, 'Missing internal credential was accepted')
    status, body = internal_prepare(direct, credential='wrong-credential')
    check(status == 403 and body == {'code': 'prepare_forbidden'}, 'Bad internal credential was accepted')
    status, body = internal_prepare(direct, cookies=False)
    check(status >= 400 and body.get('code') in ('invalid_csrf', 'unauthenticated'), 'Missing cookie was accepted')
    status, body = internal_prepare(direct, csrf=False)
    check(status == 403 and body == {'code': 'invalid_csrf'}, 'Missing CSRF was accepted')
    check(provider_count() == before, 'Rejected internal prepare reached the provider')
    status, prepared = internal_prepare(direct)
    check(status == 200, f'Valid internal prepare failed: {prepared}')
    check(re.fullmatch(r'[0-9a-f]{64}', prepared.get('account_key', '')) is not None, 'Account key is not opaque HMAC output')
    check('test@example.com' not in prepared['account_key'], 'Account key contains email')
    check(provider_count() == before, 'Successful internal prepare called the provider')

    before = provider_count()
    rust_events, headers = direct.stream('api/ai/stream')
    successful_events(rust_events)
    check(bool(headers.get('X-Request-ID')), 'Rust response omitted request ID')
    check(provider_count() == before + 1, 'Rust stream did not dispatch exactly once')
    request = [item for item in provider_requests() if item.get('event') == 'request'][-1]
    check(request['reasoning_effort'] == 'low' and request['stream'] is True, 'Rust provider payload lost reasoning/stream options')
    check(request['auth_ok'] is True, 'Provider credential was not forwarded to the mock')

    legacy_events, _ = direct.stream('?/AiStream/')
    successful_events(legacy_events)
    check(provider_count() == before + 2, 'Legacy stream did not dispatch exactly once')
    check(rust_events[-1]['data'] == legacy_events[-1]['data'], 'Rust and legacy done events differ')

    prefixed.login()
    prefixed_events, _ = prefixed.stream('api/ai/stream')
    successful_events(prefixed_events)
    before_cancel = provider_count()
    close_count = lambda: int(docker('exec', APP, 'php', '-r',
        'echo substr_count((string)@file_get_contents("/tmp/phase5-provider-server.log"),"Closing");').stdout)
    before_close = close_count()
    prefixed.cancel_stream()
    wait_until(lambda: close_count() > before_close,
               'Provider connection did not close after prefix-proxy cancellation', 10)
    check(provider_count() == before_cancel + 1, 'Cancellation caused a replay')

    before = provider_count()
    failed_events, _ = direct.stream('api/ai/stream', dict(DRAFT, instruction='FAIL_PHASE5 ' + PROMPT_MARKER))
    check(failed_events[-1]['data'].get('code') == 'upstream_http', f'Provider failure was not normalized: {failed_events}')
    time.sleep(1)
    check(provider_count() == before + 1, 'Provider failure was automatically replayed')

    rust_pid = docker('exec', APP, 'pidof', 'snappy-ai-proxy').stdout.strip().split()[0]
    docker('exec', APP, 'kill', '-STOP', rust_pid)
    wait_health(direct, 503)
    data = direct.appdata()
    check(not has_key(data, 'rustStream'), 'Stopped Rust process remained advertised')
    before = provider_count()
    rollback_events, _ = direct.stream('?/AiStream/', dict(DRAFT, instruction='ROLLBACK_PHASE5 ' + PROMPT_MARKER))
    successful_events(rollback_events)
    check(provider_count() == before + 1, 'Deliberate legacy rollback did not dispatch exactly once')
    docker('exec', APP, 'kill', '-CONT', rust_pid)
    wait_health(direct, 204)
    data = direct.appdata()
    check(find_plugin_config(data).get('rustStream') == {'route': 'api/ai/stream'}, 'Rust capability did not recover')

    docker('exec', APP, 'kill', '-KILL', rust_pid)
    def restarted():
        current = docker('exec', APP, 'pidof', 'snappy-ai-proxy', check_result=False).stdout.strip().split()
        running = docker('inspect', '-f', '{{.State.Running}}', APP).stdout.strip() == 'true'
        return current[0] if current and current[0] != rust_pid and running else False
    new_pid = wait_until(restarted, 'Supervisor did not restart an unexpectedly killed Rust process', 20)
    check(bool(new_pid), 'Missing replacement Rust PID')
    wait_health(direct, 204)

    uid = docker('exec', APP, 'id', '-u', 'snappy-ai-proxy').stdout.strip()
    status = docker('exec', APP, 'cat', f'/proc/{new_pid}/status').stdout
    check(re.search(rf'^Uid:\s+{uid}\s+', status, re.M) is not None and uid != '0', 'Rust is not running unprivileged')
    limits = docker('exec', APP, 'cat', f'/proc/{new_pid}/limits').stdout
    check(re.search(r'^Max core file size\s+0\s+0\s+', limits, re.M) is not None, 'Rust core dumps are not disabled')
    check(docker('exec', '-u', 'snappy-ai-proxy', APP, 'test', '!', '-r',
                 '/var/lib/snappymail/_data_/_default_/admin_password.txt').returncode == 0,
          'Rust can read mail-account data')
    listeners = docker('exec', APP, 'netstat', '-ltn').stdout
    for port in (3001, 8081, 9000):
        check(f'127.0.0.1:{port}' in listeners and f'0.0.0.0:{port}' not in listeners,
              f'Internal port {port} is not loopback-only')

    log_text = docker('logs', APP).stdout + docker('logs', APP).stderr + docker('logs', PREFIX).stdout + docker('logs', PREFIX).stderr
    markers = [CREDENTIAL, PROVIDER_KEY, PROMPT_MARKER, 'PRIVATE_FIXTURE_THINKING',
               'phase5-unrelated-environment-marker', direct.token]
    markers.extend(cookie.value for cookie in direct.jar)
    for marker in markers:
        check(marker not in log_text, 'A credential, session value, or prompt marker appeared in application logs')

    docker('stop', '-t', '10', APP, timeout=20)
    check(docker('inspect', '-f', '{{.State.Running}}', APP).stdout.strip() == 'false',
          'Expected container stop did not terminate the application')
    docker('start', APP)
    wait_health(direct, 204)

    dc('up', '-d', 'fatal', timeout=60)
    wait_until(lambda: docker('inspect', '-f', '{{.State.Running}}', FATAL).stdout.strip() == 'false',
               'Fatal Rust startup did not terminate its container', 30)
    check(CREDENTIAL not in (docker('logs', FATAL).stdout + docker('logs', FATAL).stderr),
          'Fatal startup logged the service credential')

    print(f'OK: {CHECKS} integration assertions; real PHP/Nginx/Rust/Supervisor, isolated mock only.')


if __name__ == '__main__':
    main()
