"""Synthetic full-schema compatibility probe, not a repository review.

Run on the enrolled Spark host with the existing Codex profile. Capture no
credential/config/session files or raw CLI diagnostics. Shared command lock
prevents overlap with native reviews. Model output is synthetic JSON only.
"""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

root = Path(sys.argv[1]).resolve()
schema = root / 'schema.json'
output = root / 'decision.json'
lock = Path.home() / '.cache/clawsweeper/clawsweeper-command.lock'
with lock.open('a') as held:
    try:
        fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print(json.dumps({'result': 'blocked', 'reason': 'native command lock busy'}))
        sys.exit(2)
    env = {'HOME': str(Path.home()), 'PATH': '/home/smoky/.nvm/versions/node/v24.18.0/bin:/usr/bin:/bin',
           'CODEX_HOME': str(Path.home() / '.config/clawsweeper/codex-home')}
    command = ['codex', 'exec', '--ephemeral', '--sandbox', 'read-only',
               '-c', 'approval_policy="never"', '--skip-git-repo-check',
               '--output-schema', str(schema), '--output-last-message', str(output), '-']
    prompt = ('Synthetic schema-compatibility probe only, not a code review. Do not use any tools. '
              'Return one minimal valid object matching the complete supplied schema. '
              'Use processGates: [], decision keep_open, closeReason none, no findings and '
              'no claims of inspecting source. State synthetic compatibility probe in summary. '
              'Use empty arrays and nullable fields where allowed. Never claim real review proof.')
    try:
        done = subprocess.run(command, input=prompt, text=True, cwd=root, env=env,
                              stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=180)
        result = {'result': 'pass' if done.returncode == 0 and output.is_file() else 'fail',
                  'exit_code': done.returncode, 'schema_sha256': hashlib.sha256(schema.read_bytes()).hexdigest(),
                  'proof_kind': 'synthetic_complete_schema_acceptance', 'review_performed': False, 'error_markers': [marker for marker in ['invalid_json_schema', 'Invalid schema', 'unexpected argument', 'not supported', '401 Unauthorized', 'refresh_token_reused', 'usage limit', 'Rate limit'] if marker in done.stderr]} 
        if output.is_file():
            raw = output.read_bytes()
            parsed = json.loads(raw)
            result.update(output_sha256=hashlib.sha256(raw).hexdigest(),
                          output_bytes=len(raw), process_gates=parsed.get('processGates'),
                          all_root_properties_present=set(json.loads(schema.read_text())['properties']) <= set(parsed))
    except subprocess.TimeoutExpired:
        result = {'result': 'timeout', 'review_performed': False}
    print(json.dumps(result, indent=2))
    (root / 'receipt.json').write_text(json.dumps(result, indent=2) + '\n')
    sys.exit(0 if result['result'] == 'pass' else 1)
