"""Bounded Deepgram speech output. Provider credentials never leave the server."""
import json
import os
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from django.http import HttpResponse
from rest_framework.decorators import api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .views import FailOpenThrottle

VOICE_MODEL = 'aura-2-athena-en'
MAX_TEXT = 1200


class SpeakThrottle(FailOpenThrottle):
    scope = 'speak'
    rate = '10/min'


@api_view(['GET', 'POST'])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([SpeakThrottle])
def speak(request):
    key = os.getenv('DEEPGRAM_API_KEY', '')
    if request.method == 'GET':
        return Response({'backend': 'deepgram' if key else 'unavailable', 'voice': 'Athena', 'model': VOICE_MODEL})
    text = request.data.get('text') if isinstance(request.data, dict) else None
    if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT:
        return Response({'detail': f'Provide 1–{MAX_TEXT} characters of response text.'}, status=400)
    if not key:
        return Response({'detail': 'Deepgram speech output is not configured.'}, status=503)
    provider = Request(f'https://api.deepgram.com/v1/speak?model={VOICE_MODEL}&encoding=mp3',
                       data=json.dumps({'text': text.strip()}).encode(), method='POST',
                       headers={'Authorization': f'Token {key}', 'Content-Type': 'application/json'})
    try:
        with urlopen(provider, timeout=15) as response:
            audio = response.read(4 * 1024 * 1024 + 1)
            content_type = response.headers.get('Content-Type', '')
        if not audio or len(audio) > 4 * 1024 * 1024 or not content_type.startswith('audio/'):
            raise ValueError('invalid audio')
    except (HTTPError, URLError, TimeoutError, OSError, ValueError):
        return Response({'detail': 'Deepgram speech output is unavailable. The written response is still available.'}, status=503)
    result = HttpResponse(audio, content_type='audio/mpeg')
    result['Cache-Control'] = 'no-store'
    result['X-Friday-Voice'] = VOICE_MODEL
    return result
