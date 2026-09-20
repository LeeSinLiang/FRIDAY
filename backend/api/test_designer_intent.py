from unittest.mock import patch

from django.test import SimpleTestCase, override_settings

from .designer_intent import Intent, route
from .scene_service import SceneError


@override_settings(CACHES={'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}})
class ConversationIntentTests(SimpleTestCase):
    room = 'haussmann-apartment'

    @patch('api.designer_intent.interpret')
    def test_whole_casual_utterance_reaches_model_without_keyword_extraction(self, model):
        text = 'with a $1,200 budget, um, help me plan my room. I want a couch beside the bed.'
        model.return_value = Intent(action='create_designs', message='Planning your room.')
        self.assertEqual(route({'text': text, 'hasDraft': False}, self.room)['action'], 'create_designs')
        self.assertEqual(model.call_args.args[0]['request'], text)

    @patch('api.designer_intent.interpret')
    def test_ordinary_natural_refinement_uses_active_context_and_history(self, model):
        model.return_value = Intent(action='refine_design', message='Updating this design.')
        history = [{'text': 'Please arrange a cozy sleeping space.', 'action': 'create_designs'}]
        result = route({'text': 'The seating feels too pale and I need more room near the window.', 'hasDraft': True, 'history': history}, self.room)
        self.assertEqual(result['action'], 'refine_design')
        self.assertEqual(model.call_args.args[0]['history'], history)
        self.assertTrue(model.call_args.args[0]['hasDraft'])

    @patch('api.designer_intent.interpret')
    def test_checkout_opens_review_with_or_without_an_active_draft(self, model):
        model.return_value = Intent(action='checkout', message='Opening your bill for review.')
        for has_draft in (False, True):
            text = 'I am ready to pay for these pieces.'
            result = route({'text': text, 'hasDraft': has_draft}, self.room)
            self.assertEqual(result['action'], 'checkout')
            self.assertEqual(model.call_args.args[0]['request'], text)
            self.assertEqual(model.call_args.args[0]['hasDraft'], has_draft)

    @patch('api.designer_intent.interpret')
    def test_verification_codes_never_reach_the_model(self, model):
        for text in ('123456', 'my code is 1 2 3 4 5 6', 'one two three four five six', 'code 123-456'):
            self.assertEqual(route({'text': text}, self.room)['action'], 'clarify')
        model.assert_not_called()

    @patch('api.designer_intent.interpret')
    def test_history_verification_codes_are_withheld_without_changing_ordinary_history(self, model):
        model.return_value = Intent(action='checkout', message='Opening review.')
        history = [{'text': 'My code was 654321', 'action': 'clarify'},
                   {'text': 'The budget is $1200.', 'action': 'create_designs'}]
        route({'text': 'Show the bill again.', 'history': history}, self.room)
        sent = model.call_args.args[0]['history']
        self.assertNotIn('654321', str(sent))
        self.assertEqual(sent[1], history[1])
        self.assertEqual(history[0]['text'], 'My code was 654321')

    @patch('api.designer_intent.interpret')
    def test_model_cannot_emit_payment_approval_submission_or_cancellation_actions(self, model):
        for action in ('approve', 'submit', 'confirm_checkout', 'cancel_checkout'):
            model.return_value = {'action': action, 'message': 'Proceed.'}
            self.assertEqual(route({'text': 'Yes.', 'hasDraft': True}, self.room)['action'], 'clarify')

    @patch('api.designer_intent.interpret', side_effect=TimeoutError)
    def test_model_failure_clarifies_without_silently_searching_or_mutating(self, model):
        self.assertEqual(route({'text': 'Make it feel calmer.'}, self.room)['action'], 'clarify')

    @patch('api.designer_intent.interpret')
    def test_context_mismatches_cannot_dispatch_inapplicable_actions(self, model):
        for action, has_draft in [('lock_design', False), ('refine_design', False), ('scene_edit', True), ('create_designs', True)]:
            model.return_value = Intent(action=action, message='Proceed.')
            self.assertEqual(route({'text': 'Yes please.', 'hasDraft': has_draft}, self.room)['action'], 'clarify')

    @patch('api.designer_intent.interpret')
    def test_ambiguous_reply_is_a_real_question_and_input_is_bounded(self, model):
        model.return_value = Intent(action='clarify', message='Would you like options to browse, or should I place one?')
        self.assertIn('place one', route({'text': 'Maybe something there.'}, self.room)['message'])
        for payload in [{'text': ''}, {'text': 'x'*2001}, {'text': 'hello', 'hasDraft': 'yes'}, {'text': 'hello', 'history': [{'text': 'bad'}]}]:
            with self.assertRaises(SceneError):
                route(payload, self.room)

    @patch('api.designer_intent.interpret')
    def test_http_contract_does_not_create_or_modify_a_scene(self, model):
        model.return_value = Intent(action='search', message='Looking for furniture.')
        response = self.client.post('/api/designer/intent/?roomId=haussmann-apartment',
                                    {'text': 'Show me some seats.', 'hasDraft': False, 'history': []}, content_type='application/json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['action'], 'search')
        self.assertEqual(response['Cache-Control'], 'private, no-store')
