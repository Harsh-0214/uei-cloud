from __future__ import annotations

import json
import re

import anthropic
import requests
from django.conf import settings
from django.http import JsonResponse, StreamingHttpResponse
from django.shortcuts import render
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

TOOLS = [
    {
        "name": "run_query",
        "description": (
            "Execute a SQL SELECT query against the PostgreSQL database. "
            "Always use this to fetch real data before answering. Returns up to 200 rows as JSON."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "sql": {"type": "string", "description": "A valid SQL SELECT statement."}
            },
            "required": ["sql"],
        },
    }
]


def index(request):
    return render(request, 'dashboard/index.html')


def latest(request):
    node_id = request.GET.get('node_id')
    url = f"{settings.API_URL}/latest"
    if node_id:
        url += f"?node_id={node_id}"
    try:
        resp = requests.get(url, timeout=5)
        return JsonResponse(resp.json(), safe=False, status=resp.status_code)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=502)


def metrics(request):
    metric   = request.GET.get('metric', 'soc')
    node_id  = re.sub(r'[^a-zA-Z0-9_-]', '', request.GET.get('node_id', ''))
    range_   = request.GET.get('range', '1h')

    allowed_metrics = {'soc','pack_voltage','pack_current','temp_high','temp_low','highest_cell_v','lowest_cell_v','ccl','dcl','temperature'}
    allowed_ranges  = {'1h','6h','24h','7d'}

    is_temp = metric == 'temperature'
    if not is_temp and metric not in allowed_metrics:
        return JsonResponse({'error': 'Invalid metric'}, status=400)
    if range_ not in allowed_ranges:
        return JsonResponse({'error': 'Invalid range'}, status=400)

    select_cols = 'temp_high, temp_low' if is_temp else metric
    raw_sql = f"""
        SELECT ts_utc AS time, {select_cols}
        FROM telemetry
        WHERE node_id = '{node_id}'
          AND $__timeFilter(ts_utc)
        ORDER BY ts_utc
        LIMIT 500
    """

    try:
        resp = requests.post(
            f"{settings.GRAFANA_URL}/api/ds/query",
            headers={
                'Authorization': f"Bearer {settings.GRAFANA_API_KEY}",
                'Content-Type': 'application/json',
            },
            json={
                'queries': [{
                    'datasource': {'uid': settings.GRAFANA_DS_UID, 'type': 'postgres'},
                    'rawSql': raw_sql,
                    'format': 'time_series',
                    'refId': 'A',
                    'intervalMs': 30000,
                    'maxDataPoints': 500,
                }],
                'from': f"now-{range_}",
                'to': 'now',
            },
            timeout=10,
        )
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=502)

    if not resp.ok:
        return JsonResponse({'error': 'Grafana query failed'}, status=502)

    body   = resp.json()
    result = body.get('results', {}).get('A', {})
    frames = result.get('frames', [])
    if not frames:
        return JsonResponse([], safe=False)

    values     = frames[0]['data']['values']
    timestamps = values[0]

    if is_temp:
        highs = values[1]
        lows  = values[2]
        return JsonResponse(
            [{'time': t, 'high': highs[i], 'low': lows[i]} for i, t in enumerate(timestamps)],
            safe=False,
        )
    else:
        vals = values[1]
        return JsonResponse(
            [{'time': t, 'value': vals[i]} for i, t in enumerate(timestamps)],
            safe=False,
        )


def _get_schema() -> str:
    try:
        resp = requests.get(f"{settings.API_URL}/schema", timeout=5)
        return resp.text if resp.ok else '(Schema unavailable)'
    except Exception:
        return '(Schema unavailable)'


def _execute_query(sql: str):
    resp = requests.post(
        f"{settings.API_URL}/query",
        json={'sql': sql},
        timeout=10,
    )
    if not resp.ok:
        detail = resp.json().get('detail', 'Query failed')
        raise ValueError(detail)
    return resp.json()


@csrf_exempt
@require_http_methods(['POST'])
def chat(request):
    data    = json.loads(request.body)
    message = data.get('message', '')
    history = data.get('history', [])

    schema = _get_schema()
    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

    system = f"""You are a helpful data analyst assistant for the UEI (Unified Energy Interface) platform.
You answer questions about battery management system telemetry data stored in a PostgreSQL database.

{schema}

Instructions:
- Always call run_query to retrieve actual data before answering.
- Provide clear, insightful summaries with observations and trends.
- Format values with appropriate units (V, A, %, °C) where applicable.
- Keep responses concise but informative.
- If a query returns no results, say so clearly.
- Never invent data."""

    def generate():
        messages = list(history) + [{'role': 'user', 'content': message}]
        assistant_text = ''

        try:
            while True:
                with client.messages.stream(
                    model='claude-sonnet-4-6',
                    max_tokens=4096,
                    system=system,
                    tools=TOOLS,
                    messages=messages,
                ) as stream:
                    for event in stream:
                        if (
                            event.type == 'content_block_delta'
                            and event.delta.type == 'text_delta'
                        ):
                            assistant_text += event.delta.text
                            yield f"data: {json.dumps({'type': 'text', 'text': event.delta.text})}\n\n"
                        elif (
                            event.type == 'content_block_start'
                            and event.content_block.type == 'tool_use'
                        ):
                            yield f"data: {json.dumps({'type': 'thinking'})}\n\n"

                    final = stream.get_final_message()

                if final.stop_reason == 'end_turn':
                    yield f"data: {json.dumps({'type': 'done', 'assistantText': assistant_text})}\n\n"
                    break

                if final.stop_reason == 'tool_use':
                    messages.append({'role': 'assistant', 'content': final.content})
                    tool_results = []

                    for block in final.content:
                        if block.type != 'tool_use':
                            continue
                        sql = block.input.get('sql', '')
                        try:
                            rows = _execute_query(sql)
                            yield f"data: {json.dumps({'type': 'query', 'sql': sql, 'rows': len(rows)})}\n\n"
                            tool_results.append({
                                'type': 'tool_result',
                                'tool_use_id': block.id,
                                'content': json.dumps(rows, default=str),
                            })
                        except Exception as exc:
                            yield f"data: {json.dumps({'type': 'query_error', 'error': str(exc)})}\n\n"
                            tool_results.append({
                                'type': 'tool_result',
                                'tool_use_id': block.id,
                                'content': f'Error: {exc}',
                                'is_error': True,
                            })

                    messages.append({'role': 'user', 'content': tool_results})
                else:
                    yield f"data: {json.dumps({'type': 'done', 'assistantText': assistant_text})}\n\n"
                    break

        except Exception as exc:
            yield f"data: {json.dumps({'type': 'error', 'text': str(exc)})}\n\n"

    response = StreamingHttpResponse(generate(), content_type='text/event-stream')
    response['Cache-Control'] = 'no-cache'
    response['X-Accel-Buffering'] = 'no'
    return response
