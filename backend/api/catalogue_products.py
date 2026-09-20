"""Catalogue listings as scene products. The backend's only millimetre-to-centimetre crossing.

The scene is centimetres and the catalogue is integer millimetres; neither changes. A client may
carry a product inline on an instance, but the server derives the same product from its own
catalogue and rejects one that disagrees, so a client cannot shrink a sofa to make it fit.
"""
from functools import lru_cache

from catalogue.feed import load_catalogue

DIMENSION_TOLERANCE_CM = 0.05
PRODUCT_KEYS = {'productId', 'name', 'widthCm', 'depthCm', 'heightCm', 'color', 'kind'}
OPTIONAL_PRODUCT_KEYS = {'modelUrl'}

# The scene's kind only picks a stand-in shape. Mirrors KIND_BY_CATEGORY in frontend/src/region/boundary.ts.
KIND_BY_CATEGORY = {
    'sofa': 'sofa', 'bed': 'sofa',
    'armchair': 'chair', 'chair': 'chair', 'lamp': 'chair', 'plant': 'chair',
    'table': 'table', 'desk': 'table', 'shelf': 'table', 'storage': 'table', 'rug': 'table', 'decor': 'table',
}


def mm_to_cm(mm):
    return mm / 10


@lru_cache(maxsize=1)
def _listings_by_id():
    return {listing.id: listing for listing in load_catalogue()}


def catalogue_product(product_id):
    """The scene product for a catalogue id, or None when the catalogue has no such listing."""
    listing = _listings_by_id().get(product_id)
    if listing is None:
        return None
    product = {
        'productId': listing.id, 'name': listing.title,
        'widthCm': mm_to_cm(listing.dims_mm.w), 'depthCm': mm_to_cm(listing.dims_mm.d), 'heightCm': mm_to_cm(listing.dims_mm.h),
        'color': listing.colour_hex[0] if listing.colour_hex else '#999999', 'kind': KIND_BY_CATEGORY[listing.category],
    }
    if listing.model_url:
        product['modelUrl'] = listing.model_url
    return product


def agrees_with_catalogue(carried, authoritative):
    """True when a client-carried product states the catalogue's dimensions."""
    return all(abs(carried[key] - authoritative[key]) <= DIMENSION_TOLERANCE_CM for key in ('widthCm', 'depthCm', 'heightCm'))
