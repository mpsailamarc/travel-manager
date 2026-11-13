"""Sync server for Travel Manager: a tiny WSGI add-on using only the Python standard library.

It wraps an existing WSGI app (e.g. your PythonAnywhere web app) and answers requests under /travel-api/,
passing everything else through untouched. Data arrives already encrypted by the app, so this server only
stores opaque records: it cannot read your trips.

Install on PythonAnywhere: put this file in /home/<you>/travel-manager-api/ and add to the end of your
WSGI configuration file:

    import sys
    sys.path.insert(0, '/home/<you>/travel-manager-api')
    from travel_sync import wrap
    application = wrap(application)

Run locally for testing:  python3 travel_sync.py [port] [static-dir]
"""

import hashlib
import hmac
import json
import os
import re
import sqlite3
import time

PREFIX = '/travel-api/'
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'travel_sync.sqlite3')
MAX_SPACES = 3  # a "space" is one sync code; the first ones to sync claim the slots
MAX_BODY = 8 * 1024 * 1024
MAX_PAYLOAD = 2 * 1024 * 1024
MAX_RECORDS_PER_SPACE = 50000

HEX32 = re.compile(r'^[0-9a-f]{32}$')
HEX64 = re.compile(r'^[0-9a-f]{64}$')
KEY = re.compile(r'^[a-z]+/[^\x00-\x1f]{1,300}$')

# The app may be hosted on another site (e.g. Cloudflare Pages) than this server, so browsers need CORS.
# Allowing any origin is safe here: there are no cookies, every request must carry the sync token, and the data is
# encrypted with a key the server never sees.
CORS = [
    ('Access-Control-Allow-Origin', '*'),
    ('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'),
    ('Access-Control-Allow-Headers', 'Content-Type, X-Sync-Space, X-Sync-Token'),
    ('Access-Control-Max-Age', '86400'),
]

STATUS = {200: '200 OK', 204: '204 No Content', 400: '400 Bad Request', 403: '403 Forbidden', 404: '404 Not Found', 405: '405 Method Not Allowed', 413: '413 Payload Too Large', 500: '500 Internal Server Error'}


def _connect():
    con = sqlite3.connect(DB_PATH, timeout=15, isolation_level=None)
    con.execute('CREATE TABLE IF NOT EXISTS spaces (space TEXT PRIMARY KEY, token_hash TEXT NOT NULL, seq INTEGER NOT NULL, created REAL NOT NULL)')
    con.execute('CREATE TABLE IF NOT EXISTS records (space TEXT NOT NULL, key TEXT NOT NULL, seq INTEGER NOT NULL, deleted INTEGER NOT NULL, payload TEXT, PRIMARY KEY (space, key))')
    con.execute('CREATE INDEX IF NOT EXISTS records_by_seq ON records (space, seq)')
    return con


def _sync(environ):
    space = environ.get('HTTP_X_SYNC_SPACE', '')
    token = environ.get('HTTP_X_SYNC_TOKEN', '')
    if not HEX32.match(space) or not HEX64.match(token):
        return 400, {'error': 'Missing or malformed sync credentials.'}
    try:
        length = int(environ.get('CONTENT_LENGTH') or 0)
    except ValueError:
        length = 0
    if length > MAX_BODY:
        return 413, {'error': 'Too much data in one sync.'}
    try:
        body = json.loads(environ['wsgi.input'].read(length) or b'{}')
        since = int(body.get('since', 0))
        changes = body.get('changes', [])
        assert isinstance(changes, list)
    except Exception:
        return 400, {'error': 'Unreadable request.'}
    for c in changes:
        if not isinstance(c, dict) or not KEY.match(str(c.get('key', ''))):
            return 400, {'error': 'Bad record key.'}
        payload = c.get('payload')
        if not c.get('deleted') and (not isinstance(payload, str) or len(payload) > MAX_PAYLOAD):
            return 400, {'error': 'Bad or oversized record.'}

    token_hash = hashlib.sha256(token.encode()).hexdigest()
    con = _connect()
    try:
        con.execute('BEGIN IMMEDIATE')
        row = con.execute('SELECT token_hash, seq FROM spaces WHERE space = ?', (space,)).fetchone()
        if row is None:
            (count,) = con.execute('SELECT COUNT(*) FROM spaces').fetchone()
            if count >= MAX_SPACES:
                con.execute('ROLLBACK')
                return 403, {'error': 'This server already has its maximum number of sync codes.'}
            con.execute('INSERT INTO spaces VALUES (?, ?, 0, ?)', (space, token_hash, time.time()))
            seq = 0
        else:
            if not hmac.compare_digest(row[0], token_hash):
                con.execute('ROLLBACK')
                return 403, {'error': 'Wrong sync code.'}
            seq = row[1]
        if since > seq:
            since = 0  # the server was reset: send everything again

        # Pull first: what other devices changed since this one last synced. The device's own pushes win.
        pushed = set(c['key'] for c in changes)
        pulled = [
            {'key': k, 'seq': s, 'deleted': bool(d), 'payload': p}
            for (k, s, d, p) in con.execute('SELECT key, seq, deleted, payload FROM records WHERE space = ? AND seq > ? ORDER BY seq', (space, since))
            if k not in pushed
        ]
        for c in changes:
            seq += 1
            deleted = 1 if c.get('deleted') else 0
            con.execute(
                'INSERT OR REPLACE INTO records (space, key, seq, deleted, payload) VALUES (?, ?, ?, ?, ?)',
                (space, c['key'], seq, deleted, None if deleted else c['payload']),
            )
        (n,) = con.execute('SELECT COUNT(*) FROM records WHERE space = ?', (space,)).fetchone()
        if n > MAX_RECORDS_PER_SPACE:
            con.execute('ROLLBACK')
            return 413, {'error': 'Too many records for this sync code.'}
        con.execute('UPDATE spaces SET seq = ? WHERE space = ?', (seq, space))
        con.execute('COMMIT')
        return 200, {'seq': seq, 'records': pulled}
    except Exception:
        try:
            con.execute('ROLLBACK')
        except Exception:
            pass
        raise
    finally:
        con.close()


def _handle(environ):
    path = environ.get('PATH_INFO', '')
    method = environ.get('REQUEST_METHOD', 'GET')
    if path == PREFIX + 'ping':
        return 200, {'ok': True, 'app': 'travel-manager-sync'}
    if path == PREFIX + 'sync':
        if method != 'POST':
            return 405, {'error': 'Use POST.'}
        return _sync(environ)
    return 404, {'error': 'Not found.'}


def wrap(app):
    """Serve /travel-api/ here and hand every other request to `app`."""

    def middleware(environ, start_response):
        if not environ.get('PATH_INFO', '').startswith(PREFIX):
            return app(environ, start_response)
        if environ.get('REQUEST_METHOD') == 'OPTIONS':  # CORS preflight
            start_response(STATUS[204], CORS + [('Content-Length', '0')])
            return [b'']
        try:
            status, body = _handle(environ)
        except Exception:
            status, body = 500, {'error': 'Server error.'}
        data = json.dumps(body).encode()
        start_response(STATUS[status], CORS + [('Content-Type', 'application/json'), ('Content-Length', str(len(data))), ('Cache-Control', 'no-store')])
        return [data]

    return middleware


def _static_app(root):
    """Local testing only: serves files like PythonAnywhere's static mapping (/travel/ -> root)."""
    import mimetypes

    def app(environ, start_response):
        path = environ.get('PATH_INFO', '')
        if path.startswith('/travel/'):
            rel = os.path.normpath(path[len('/travel/'):] or 'index.html')
            full = os.path.join(root, rel)
            if not rel.startswith('..') and os.path.isfile(full):
                with open(full, 'rb') as f:
                    data = f.read()
                ctype = mimetypes.guess_type(full)[0] or 'application/octet-stream'
                start_response('200 OK', [('Content-Type', ctype), ('Content-Length', str(len(data)))])
                return [data]
        start_response('404 Not Found', [('Content-Type', 'text/plain')])
        return [b'Not found']

    return app


if __name__ == '__main__':
    import sys
    from wsgiref.simple_server import make_server

    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8792
    static = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'dist')
    print('Travel Manager sync test server on http://127.0.0.1:%d/travel/index.html (API at %s)' % (port, PREFIX))
    make_server('127.0.0.1', port, wrap(_static_app(static))).serve_forever()
