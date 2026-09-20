from django.db import transaction
from django.conf import settings
import json
import re
from django.utils import timezone
from accounts.policy import account_status
from api.scene_service import SceneError, apply_scene_commands, scene_for_session, serialize
from api.shared_data import shared_root
from catalogue.feed import load_catalogue
from catalogue.pricing import has_price
from checkout.catalogue import VENDOR
from checkout.models import Checkout
from visa.schema import payload_hash
from .models import ShoppingSession, CartItem, ShoppingOperation


# Packaged furniture only. Amazon Berkeley Objects folders are abo-<ASIN>, and an ASIN has capitals.
DEPLOYED_MODEL = re.compile(r'/models/furniture/[A-Za-z0-9-]+/model\.glb')


def cart_product(product_id):
    """A piece that can go in the cart: a catalogue listing whose model is deployed with approved metadata.

    Whether it can be PRICED is a separate question, answered by `priced`. A price of 0 means nobody knows the
    price (every Amazon Berkeley Objects listing), not that the piece is free or not for sale: it is real, it
    was placed at its true size, and a bill has to be able to list it. Its amount is simply not known.
    """
    listing = next((item for item in load_catalogue() if item.id == product_id), None)
    if listing is None or not listing.model_url:
        raise SceneError('unavailable_product', 'This furniture is not available for checkout.', 400)
    # Only packaged furniture can be bought in this demo; remote/unmapped models are excluded.
    if not DEPLOYED_MODEL.fullmatch(listing.model_url):
        raise SceneError('unavailable_product', 'This furniture has no deployed model.', 400)
    metadata_path = shared_root() / listing.model_url.lstrip('/').replace('/model.glb', '/metadata.json')
    try:
        metadata = json.loads(metadata_path.read_text())
        if metadata.get('catalogueListingId') != listing.id or metadata.get('modelUrl') != listing.model_url:
            raise ValueError()
    except (OSError, ValueError):
        raise SceneError('unavailable_product', 'This furniture has no approved model metadata.', 400)
    priced = has_price(listing)
    return {'product_id': listing.id, 'name': listing.title, 'unit_amount': listing.price_cents if priced else 0,
            'priced': priced, 'thumbnail': metadata.get('thumbnailUrl', listing.thumb_url), 'model_url': listing.model_url}


def cart(shopping, user=None):
    shopping.refresh_from_db()
    items = []
    for item in shopping.items.filter(selected=True, present=True).order_by('room_id', 'instance_id'):
        try:
            product = cart_product(item.product_id)
            available = True
        except SceneError:
            product = {'product_id': item.product_id, 'name': item.product_id, 'unit_amount': 0, 'priced': False, 'thumbnail': ''}
            available = False
        items.append({'id': str(item.id), 'roomId': item.room_id, 'instanceId': item.instance_id,
                      **product, 'available': available})
    # The amount covers what can be priced, and the counts say so: "48 items · 31 priced · $12,480".
    priced = [item for item in items if item['available'] and item['priced']]
    return {'id': str(shopping.pk), 'revision': shopping.revision, 'items': items,
            'item_count': len(items), 'priced_count': len(priced),
            'amount': sum(item['unit_amount'] for item in priced), 'currency': 'USD', 'sandbox': True,
            'owned': shopping.owner_id is not None,
            **({'account': account_status(user)} if user is not None else {})}


def bill_lines(items):
    """One line per product. A partial bill is honest, not a bug: a piece whose price nobody knows is still listed,
    with no amount (None, never 0), and adds nothing to the total or to what Visa is asked for."""
    grouped = {}
    for item in items:
        line = grouped.setdefault(item['product_id'], {'product_id': item['product_id'], 'name': item['name'],
            'priced': item['priced'], 'unit_amount': item['unit_amount'] if item['priced'] else None, 'quantity': 0})
        line['quantity'] += 1
        line['line_amount'] = line['quantity'] * line['unit_amount'] if line['priced'] else None
    return list(grouped.values())


def assert_editable(shopping):
    if Checkout.objects.filter(shopping=shopping, state__in=['submitting', 'transport_unknown']).exists():
        raise SceneError('checkout_pending', 'A checkout result is still pending. Check its status before changing this cart.', 409)


def lock_scene_cart(scene_key):
    shopping = ShoppingSession.objects.select_for_update().filter(scene_key=scene_key).first()
    if shopping:
        assert_editable(shopping)


def changed(shopping):
    shopping.revision += 1
    shopping.save(update_fields=['revision'])
    Checkout.objects.filter(shopping=shopping, state__in=['draft', 'approved']).update(state='superseded')


@transaction.atomic
def sync_scene_cart(scene):
    """Keep confirmed instances selected across remove/undo; cart removals remain deliberate."""
    shopping = ShoppingSession.objects.select_for_update().filter(scene_key=scene.session_key).first()
    if shopping is None:
        return
    assert_editable(shopping)
    present = {item['instanceId']: item['productId'] for item in scene.instances}
    dirty = False
    for item in shopping.items.filter(room_id=scene.room_id):
        now = present.get(item.instance_id) == item.product_id
        if now != item.present:
            item.present = now
            item.save(update_fields=['present'])
            dirty = dirty or item.selected
    if dirty:
        changed(shopping)


@transaction.atomic
def confirm(shopping, data):
    if not isinstance(data, dict) or set(data) != {'roomId', 'instance', 'baseRevision', 'cartRevision', 'operationId'}:
        raise SceneError('validation', 'Provide room, instance, revisions and operation ID.')
    op = data['operationId']
    if not isinstance(op, str) or not 1 <= len(op) <= 120:
        raise SceneError('validation', 'Invalid operation ID.')
    if any(type(data[key]) is not int or data[key] < 0 for key in ('baseRevision', 'cartRevision')):
        raise SceneError('validation', 'Invalid revision.')
    if not isinstance(data['instance'], dict) or not isinstance(data['roomId'], str):
        raise SceneError('validation', 'Invalid room or furniture.')
    shopping = ShoppingSession.objects.select_for_update().get(pk=shopping.pk)
    digest = payload_hash(data)
    previous = ShoppingOperation.objects.filter(shopping=shopping, operation_id=op).first()
    if previous:
        if previous.digest != digest:
            raise SceneError('operation_conflict', 'This operation ID was already used for a different placement.', 409)
        return previous.result
    assert_editable(shopping)
    if shopping.revision != data['cartRevision']:
        raise SceneError('cart_conflict', 'Your cart changed. Refresh it before confirming.', 409)
    instance = data['instance']
    cart_product(instance.get('productId'))
    scene = scene_for_session(shopping.scene_key, data['roomId'])
    scene = type(scene).objects.select_for_update().get(pk=scene.pk)
    if scene.revision != data['baseRevision']:
        raise SceneError('revision_conflict', 'The room changed. Reload before confirming.', 409)
    existing = next((i for i in scene.instances if i['instanceId'] == instance.get('instanceId')), None)
    if existing is not None:
        if existing != instance:
            raise SceneError('instance_conflict', 'The placed furniture changed.', 409)
        snapshot = serialize(scene)
    else:
        snapshot = apply_scene_commands(shopping.scene_key, data['baseRevision'], 'cart:' + op,
                                        [{'type': 'add', 'instance': instance}], data['roomId'])
    item, created = CartItem.objects.get_or_create(shopping=shopping, room_id=data['roomId'],
        instance_id=instance['instanceId'], defaults={'product_id': instance['productId']})
    if not created and item.product_id != instance['productId']:
        raise SceneError('instance_conflict', 'An instance cannot change product.', 409)
    if created or not item.selected or not item.present:
        item.selected = item.present = True
        item.save(update_fields=['selected', 'present'])
        changed(shopping)
    result = {'scene': snapshot, 'cart': cart(shopping)}
    ShoppingOperation.objects.create(shopping=shopping, operation_id=op, digest=digest, result=result)
    return result


@transaction.atomic
def remove(shopping, item_id, revision):
    shopping = ShoppingSession.objects.select_for_update().get(pk=shopping.pk)
    assert_editable(shopping)
    if type(revision) is not int or revision != shopping.revision:
        raise SceneError('cart_conflict', 'Your cart changed. Refresh before removing furniture.', 409)
    item = CartItem.objects.filter(shopping=shopping, pk=item_id).first()
    if item is None:
        raise SceneError('not_found', 'Cart item not found.', 404)
    if item.selected:
        item.selected = False
        item.save(update_fields=['selected'])
        changed(shopping)
    return cart(shopping)


@transaction.atomic
def checkout(shopping, user, revision):
    from datetime import timedelta
    shopping = ShoppingSession.objects.select_for_update().get(pk=shopping.pk)
    assert_editable(shopping)
    if shopping.owner_id != user.pk or type(revision) is not int or revision != shopping.revision:
        raise SceneError('cart_conflict', 'Refresh your cart before checkout.', 409)
    state = cart(shopping)
    if not state['items'] or any(not i['available'] for i in state['items']):
        raise SceneError('validation', 'Choose available furniture before checkout.')
    if not state['priced_count']:
        raise SceneError('validation', 'Nothing in your cart has a known price yet, so there is nothing to check out.')
    snapshot = {'vendor': VENDOR, 'items': bill_lines(state['items']), 'item_count': state['item_count'],
                'priced_count': state['priced_count'], 'amount': state['amount'],
                'currency': 'USD', 'exponent': 2, 'sandbox': True}
    if state['amount'] > 1000000:
        raise SceneError('validation', 'Cart exceeds the sandbox total limit.')
    digest = payload_hash(snapshot)
    existing = Checkout.objects.filter(shopping=shopping, cart_revision=revision, snapshot_hash=digest,
        state__in=['draft', 'approved'], expires_at__gt=timezone.now()).first()
    if existing:
        return existing
    return Checkout.objects.create(user=user, shopping=shopping, cart_revision=revision, snapshot=snapshot,
        snapshot_hash=digest, expires_at=timezone.now() + timedelta(minutes=15))
