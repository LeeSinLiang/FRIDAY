from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
import os


@api_view(["GET"])
@permission_classes([AllowAny])
def health(request):
    response = Response({"status": "ok", "service": "friday-api"})
    response['X-Friday-Build'] = os.getenv('FRIDAY_BUILD_ID', 'local')
    return response
