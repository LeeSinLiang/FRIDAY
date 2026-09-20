from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import patch
from django.contrib.auth import get_user_model
from django.test import Client
from accounts.tests import AccountTestCase, totp
from api.catalogue_products import catalogue_product
from catalogue.feed import load_catalogue
from checkout.models import Checkout
from .models import CartItem, ShoppingSession


class ShoppingTests(AccountTestCase):
    def enrolled(self):
        result = super().enrolled()
        response = self.send('/api/accounts/recovery/acknowledge/',{'acknowledged':True})
        self.assertEqual(response.status_code,200,response.content)
        return result

    def setUp(self):
        super().setUp()
        self.state = self.client.get('/api/cart/').json()
        self.listing = next(i for i in load_catalogue() if i.model_url and i.category == 'chair')
        self.instance = {'instanceId':'chair-one','productId':self.listing.id,'product':catalogue_product(self.listing.id),
                         'pose':{'xCm':200,'zCm':200,'yawRad':0}}
        self.data = {'roomId':'empty-room','instance':self.instance,'baseRevision':0,'cartRevision':0,'operationId':'one'}

    def send(self, path, data, method='post'):
        return getattr(self.client,method)(path,data,content_type='application/json',HTTP_X_CSRFTOKEN=self.client.cookies['csrftoken'].value)

    def place(self):
        response = self.send('/api/cart/confirm-placement/',self.data)
        self.assertEqual(response.status_code,200,response.content)
        return response.json()

    def test_confirmation_is_atomic_idempotent_and_guest_accessible(self):
        result = self.place()
        self.assertEqual(len(result['cart']['items']),1)
        self.assertEqual(result['cart']['amount'],self.listing.price_cents)
        self.assertEqual(self.place(),result)
        self.assertEqual(CartItem.objects.count(),1)
        bad = deepcopy(self.data); bad['instance']['pose']['xCm'] = -1000; bad['operationId']='bad'
        bad.update(baseRevision=result['scene']['revision'],cartRevision=result['cart']['revision'])
        bad['instance']['instanceId']='invalid'
        response = self.send('/api/cart/confirm-placement/',bad)
        self.assertEqual(response.status_code,400,response.content)
        self.assertEqual(CartItem.objects.count(),1)
        self.assertEqual(len(self.client.get('/api/scene/?roomId=empty-room').json()['instances']),1)

    def test_cart_removal_preserves_arrangement_and_readd_is_explicit(self):
        result = self.place()
        item = result['cart']['items'][0]
        response = self.send('/api/cart/items/'+item['id']+'/',{'revision':result['cart']['revision']},'delete')
        self.assertEqual(response.status_code,200,response.content)
        self.assertEqual(response.json()['items'],[])
        self.assertEqual(len(self.client.get('/api/scene/?roomId=empty-room').json()['instances']),1)
        again = {**self.data,'operationId':'again','baseRevision':result['scene']['revision'],'cartRevision':response.json()['revision']}
        self.assertEqual(len(self.send('/api/cart/confirm-placement/',again).json()['cart']['items']),1)

    def test_remove_undo_restores_membership_move_keeps_quantity(self):
        result = self.place()
        def command(commands,revision,identifier):
            return self.send('/api/scene/commands/?roomId=empty-room',{'baseRevision':revision,'commandId':identifier,'commands':commands})
        removed = command([{'type':'remove','instanceId':'chair-one'}],result['scene']['revision'],'remove')
        self.assertEqual(removed.status_code,200,removed.content)
        self.assertEqual(self.client.get('/api/cart/').json()['items'],[])
        restored = command([{'type':'add','instance':self.instance}],removed.json()['revision'],'undo')
        self.assertEqual(restored.status_code,200,restored.content)
        before = self.client.get('/api/cart/').json()
        moved = command([{'type':'setPose','instanceId':'chair-one','pose':{**self.instance['pose'],'xCm':210}}],restored.json()['revision'],'move')
        self.assertEqual(moved.status_code,200,moved.content)
        self.assertEqual(self.client.get('/api/cart/').json()['revision'],before['revision'])
        self.assertEqual(len(before['items']),1)
        self.assertEqual(self.client.get('/api/scene/?roomId=demo-room').json()['instances'],[])

    def test_signup_mfa_claim_rotation_and_account_isolation(self):
        result = self.place()
        token = self.client.cookies['friday_shopping'].value
        user,_ = self.enrolled()
        claimed = self.send('/api/cart/claim/',{})
        self.assertEqual(claimed.status_code,200,claimed.content)
        self.assertEqual(claimed.json()['id'],result['cart']['id'])
        self.assertEqual(self.send('/api/cart/claim/',{}).json()['id'],result['cart']['id'])
        self.assertEqual(ShoppingSession.objects.get(pk=result['cart']['id']).owner_id,user.pk)
        other = Client(); other.cookies['friday_shopping']=token
        stranger = get_user_model().objects.create_user(username='other',email='other@example.com')
        other.force_login(stranger)
        self.assertEqual(other.get('/api/cart/').json()['items'],[])
        self.assertEqual(other.get('/api/scene/?roomId=empty-room').json()['instances'],[])
        self.assertEqual(len(self.client.get('/api/cart/').json()['items']),1)

    def test_server_prices_stale_approval_and_snapshot_recovery(self):
        result = self.place(); _,secret = self.enrolled(); self.send('/api/cart/claim/',{})
        draft = self.send('/api/cart/checkout/',{'revision':result['cart']['revision'],'amount':1})
        self.assertEqual(draft.status_code,201,draft.content)
        checkout = draft.json()
        self.assertEqual(checkout['snapshot']['amount'],self.listing.price_cents)
        self.assertEqual(self.send('/api/cart/checkout/',{'revision':result['cart']['revision']}).json()['id'],checkout['id'])
        approved = self.send('/api/checkouts/'+checkout['id']+'/approve/',{'snapshot_hash':checkout['snapshot_hash'],'approved':True,'code':totp(secret)})
        self.assertEqual(approved.status_code,200,approved.content)
        item = result['cart']['items'][0]
        self.send('/api/cart/items/'+item['id']+'/',{'revision':result['cart']['revision']},'delete')
        with patch('checkout.services.submit_idx') as visa:
            response = self.send('/api/checkouts/'+checkout['id']+'/submit/',{'snapshot_hash':checkout['snapshot_hash']})
            self.assertEqual(response.status_code,409,response.content); visa.assert_not_called()
        self.assertEqual(self.client.get('/api/checkouts/'+checkout['id']+'/').json()['data']['state'],'superseded')
        self.assertEqual(Checkout.objects.count(),1)

    def test_csrf_and_revisions_and_product_metadata_are_enforced(self):
        self.assertEqual(self.client.post('/api/cart/confirm-placement/',self.data,content_type='application/json').status_code,403)
        bad = deepcopy(self.data); bad['instance']['product']['widthCm']=1
        self.assertEqual(self.send('/api/cart/confirm-placement/',bad).status_code,400)
        bad = {**self.data,'cartRevision':99}
        self.assertEqual(self.send('/api/cart/confirm-placement/',bad).status_code,409)
        self.assertEqual(CartItem.objects.count(),0)

    def test_recovery_acknowledgement_is_required_and_survives_refresh(self):
        self.place()
        super().enrolled()
        self.assertEqual(self.send('/api/cart/claim/',{}).status_code,401)
        self.assertEqual(self.send('/api/accounts/recovery/acknowledge/',{'acknowledged':1}).status_code,400)
        self.assertEqual(self.send('/api/accounts/recovery/acknowledge/',{'acknowledged':True}).status_code,200)
        self.assertTrue(self.client.get('/api/accounts/status/').json()['recovery_acknowledged'])
        self.assertEqual(self.send('/api/cart/claim/',{}).status_code,200)

    def test_multiple_instances_group_in_server_checkout(self):
        result = self.place()
        second = deepcopy(self.data)
        second.update(operationId='two',baseRevision=result['scene']['revision'],cartRevision=result['cart']['revision'])
        second['instance']['instanceId']='chair-two';second['instance']['pose']['xCm']=350
        response=self.send('/api/cart/confirm-placement/',second)
        self.assertEqual(response.status_code,200,response.content)
        self.enrolled();self.send('/api/cart/claim/',{})
        draft=self.send('/api/cart/checkout/',{'revision':response.json()['cart']['revision']})
        self.assertEqual(draft.status_code,201,draft.content)
        self.assertEqual(draft.json()['snapshot']['items'][0]['quantity'],2)
        self.assertEqual(draft.json()['snapshot']['amount'],self.listing.price_cents*2)

    def unpriced(self):
        """A real product with a real model and no known price: every Amazon Berkeley Objects listing."""
        listing = next(i for i in load_catalogue() if i.source == 'abo' and i.category == 'decor')
        self.assertEqual((listing.price_cents, bool(listing.model_url)), (0, True))
        instance = {'instanceId':'vase-one','productId':listing.id,'product':catalogue_product(listing.id),'pose':{'xCm':300,'zCm':300,'yawRad':0}}
        return listing, {'roomId':'empty-room','instance':instance,'baseRevision':0,'cartRevision':0,'operationId':'unpriced'}

    def test_a_piece_with_a_model_and_no_known_price_goes_in_the_cart_without_an_amount(self):
        listing, data = self.unpriced()
        response = self.send('/api/cart/confirm-placement/',data)
        self.assertEqual(response.status_code,200,response.content)
        item = response.json()['cart']['items'][0]
        self.assertEqual((item['product_id'],item['available'],item['priced'],item['unit_amount']),(listing.id,True,False,0))
        self.assertRegex(listing.model_url,'[A-Z]','its folder is abo-<ASIN>: capitals must count as a deployed model')
        # A priced piece beside it: the amount is the priced piece alone, never padded with a guess.
        self.data['baseRevision'],self.data['cartRevision'] = response.json()['scene']['revision'],response.json()['cart']['revision']
        cart = self.place()['cart']
        self.assertEqual(sorted(i['priced'] for i in cart['items']),[False,True])
        self.assertEqual(cart['amount'],self.listing.price_cents)

    def test_a_listing_without_a_deployed_model_still_cannot_go_in_the_cart(self):
        listing = next(i for i in load_catalogue() if not i.model_url and i.price_cents > 0)
        data = deepcopy(self.data); data['instance'].update(productId=listing.id,product=catalogue_product(listing.id))
        response = self.send('/api/cart/confirm-placement/',data)
        self.assertEqual(response.status_code,400,response.content)
        self.assertEqual(CartItem.objects.count(),0)

    def test_a_partial_bill_lists_every_piece_and_charges_only_what_has_a_price(self):
        unpriced,data = self.unpriced()
        first = self.send('/api/cart/confirm-placement/',data).json()
        self.data['baseRevision'],self.data['cartRevision'] = first['scene']['revision'],first['cart']['revision']
        cart = self.place()['cart']
        self.assertEqual((cart['item_count'],cart['priced_count'],cart['amount']),(2,1,self.listing.price_cents))
        _,secret = self.enrolled(); self.send('/api/cart/claim/',{})
        draft = self.send('/api/cart/checkout/',{'revision':cart['revision']})
        self.assertEqual(draft.status_code,201,draft.content)
        snapshot = draft.json()['snapshot']
        self.assertEqual((snapshot['item_count'],snapshot['priced_count'],snapshot['amount']),(2,1,self.listing.price_cents))
        lines = {line['product_id']:line for line in snapshot['items']}
        self.assertEqual((lines[unpriced.id]['priced'],lines[unpriced.id]['unit_amount'],lines[unpriced.id]['line_amount']),(False,None,None))
        self.assertEqual((lines[self.listing.id]['priced'],lines[self.listing.id]['line_amount']),(True,self.listing.price_cents))
        # Each line says who it comes from; the merchant of record is a separate fact and stays FRIDAY's sandbox account.
        self.assertEqual((lines[unpriced.id]['vendor'],lines[self.listing.id]['vendor']),({'id':'amazon','name':'Amazon'},{'id':'ikea','name':'IKEA'}))
        self.assertEqual(snapshot['vendor'],{'id':'friday-sandbox','name':'FRIDAY Sandbox Furniture'})
        # Visa is asked for the priced amount and nothing else.
        checkout = draft.json()
        self.send('/api/checkouts/'+checkout['id']+'/approve/',{'snapshot_hash':checkout['snapshot_hash'],'approved':True,'code':totp(secret)})
        with patch('checkout.services.load_credentials'), patch('checkout.services.submit_idx',return_value=('accepted',{})) as visa:
            response = self.send('/api/checkouts/'+checkout['id']+'/submit/',{'snapshot_hash':checkout['snapshot_hash']})
        self.assertEqual(response.status_code,200,response.content)
        self.assertEqual(visa.call_args.args[0]['purchaseAmount'],str(self.listing.price_cents))
        self.assertEqual(visa.call_args.args[0]['merchantName'],'FRIDAY Sandbox Furniture')

    def test_a_cart_with_nothing_priced_is_refused_at_checkout_in_plain_words(self):
        _,data = self.unpriced()
        result = self.send('/api/cart/confirm-placement/',data).json()
        self.enrolled(); self.send('/api/cart/claim/',{})
        response = self.send('/api/cart/checkout/',{'revision':result['cart']['revision']})
        self.assertEqual(response.status_code,400,response.content)
        self.assertIn('nothing to check out',response.json()['error']['message'])
        self.assertEqual(Checkout.objects.count(),0)

    def test_full_design_lock_is_atomic_idempotent_and_preserves_other_rooms(self):
        first = self.place()
        CartItem.objects.create(
            shopping_id=first['cart']['id'], room_id='demo-room', instance_id='other-room-chair',
            product_id=self.listing.id, selected=True, present=True,
        )
        chosen = deepcopy(self.instance)
        chosen['instanceId'] = 'chosen-chair'
        chosen['pose']['xCm'] = 320
        variant = {
            'id': 'warm-one', 'revision': 4, 'instances': [chosen],
            'totalCents': self.listing.price_cents,
            'geometryValidated': True, 'budgetValidated': True,
        }
        payload = {
            'roomId': 'empty-room', 'variantSetId': 'bedroom-set', 'variantId': 'warm-one',
            'baseRevision': 4, 'requestId': 'lock-one',
        }
        job = SimpleNamespace(data={'variantSet': {'baseRevision': first['scene']['revision']}})
        with patch('api.designer_variants.selected_variant', return_value=(job, variant)), \
             patch('api.designer_variants.mark_accepted') as accepted:
            response = self.send('/api/checkout/lock-design/', payload)
            self.assertEqual(response.status_code, 200, response.content)
            result = response.json()
            retry = self.send('/api/checkout/lock-design/', payload)
            self.assertEqual(retry.status_code, 200, retry.content)
            self.assertEqual(retry.json(), result)
            accepted.assert_called_once()
        self.assertEqual(result['checkoutUrl'], '/checkout')
        self.assertEqual(result['variantId'], 'warm-one')
        self.assertEqual(
            {(item['roomId'], item['instanceId']) for item in result['cart']['items']},
            {('empty-room', 'chosen-chair'), ('demo-room', 'other-room-chair')},
        )
        self.assertEqual(
            self.client.get('/api/scene/?roomId=empty-room').json()['instances'], [chosen],
        )
        self.assertEqual(CartItem.objects.filter(room_id='empty-room', selected=True).count(), 1)
        self.assertEqual(CartItem.objects.filter(room_id='empty-room').count(), 2)
