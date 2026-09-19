from django.urls import reverse
from rest_framework.test import APITestCase


class HealthTests(APITestCase):
    def test_health_is_public(self):
        response = self.client.get(reverse("health"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok", "service": "friday-api"})

    def test_health_rejects_writes(self):
        self.assertEqual(self.client.post(reverse("health"), {}).status_code, 405)
