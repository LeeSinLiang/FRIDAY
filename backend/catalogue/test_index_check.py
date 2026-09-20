"""The file-versus-index agreement check. Offline: the cluster is a fake that pages like the real one."""
import os
import unittest
from unittest import mock

from django.test import SimpleTestCase

from catalogue import index_check
from catalogue.index_check import differences, file_docs, fingerprint, index_docs


def doc(doc_id, **fields):
    return {"id": doc_id, "title": doc_id.upper(), "model_url": None, **fields}


class FakeCluster:
    """Answers search() the way Elasticsearch does for a match_all sorted by id with search_after."""

    def __init__(self, docs):
        self.docs, self.requests = sorted(docs, key=lambda d: d["id"]), 0

    def options(self, **_):
        return self

    def search(self, *, size, search_after=None, **_):
        self.requests += 1
        rest = [d for d in self.docs if search_after is None or d["id"] > search_after[0]]
        return {"hits": {"hits": [{"_source": d, "sort": [d["id"]]} for d in rest[:size]]}}


class FingerprintTests(SimpleTestCase):
    def test_order_does_not_matter_but_content_does(self):
        a, b = doc("a"), doc("b")
        self.assertEqual(fingerprint([a, b]), fingerprint([b, a]))
        self.assertEqual(fingerprint([a, b])[0], 2)
        self.assertNotEqual(fingerprint([a, b]), fingerprint([a]))

    def test_a_changed_model_url_changes_the_hash_and_not_the_count(self):
        # The case a count alone misses: same listings, one of them has gained a model.
        stale, fresh = [doc("a"), doc("b")], [doc("a"), doc("b", model_url="/models/furniture/b/model.glb")]
        self.assertEqual(fingerprint(stale)[0], fingerprint(fresh)[0])
        self.assertNotEqual(fingerprint(stale)[1], fingerprint(fresh)[1])

    def test_the_real_catalogue_fingerprints_the_same_twice(self):
        self.assertEqual(fingerprint(file_docs()), fingerprint(file_docs()))
        self.assertGreater(fingerprint(file_docs())[0], 12000)


class DifferenceTests(SimpleTestCase):
    def test_names_missing_extra_and_changed_fields(self):
        in_file = [doc("a"), doc("b", model_url="/m.glb"), doc("c")]
        in_index = [doc("b"), doc("c"), doc("z")]
        self.assertEqual(differences(in_file, in_index), [
            "not in the index: a",
            "in the index but not in the files: z",
            "b: model_url is None in the index, '/m.glb' in the files",
        ])

    def test_agreement_is_silent(self):
        self.assertEqual(differences([doc("a")], [doc("a")]), [])


class PagingTests(SimpleTestCase):
    def test_reads_every_document_across_pages(self):
        docs = [doc(f"seed-{n:06d}") for n in range(2500)]
        cluster = FakeCluster(docs)
        with mock.patch.object(index_check, "PAGE_SIZE", 1000):
            self.assertEqual(fingerprint(index_docs(cluster, "listings")), fingerprint(docs))
        self.assertEqual(cluster.requests, 4)  # 1000 + 1000 + 500, then the empty page that ends it


class CheckExitCodeTests(SimpleTestCase):
    def run_check(self, in_index):
        client = FakeCluster(in_index)
        client.indices = mock.Mock(exists=mock.Mock(return_value=True))
        with mock.patch.object(index_check, "get_client", return_value=client), \
             mock.patch.object(index_check, "file_docs", return_value=[doc("a"), doc("b", model_url="/m.glb")]), \
             mock.patch("sys.stdout"), mock.patch("sys.stderr"):
            return index_check.check()

    def test_zero_when_they_agree_and_one_when_they_do_not(self):
        self.assertEqual(self.run_check([doc("a"), doc("b", model_url="/m.glb")]), 0)
        self.assertEqual(self.run_check([doc("a"), doc("b")]), 1)  # same count, stale model_url
        self.assertEqual(self.run_check([doc("a")]), 1)


@unittest.skipUnless(os.getenv("ELASTIC_LIVE_TEST") == "1", "live Elasticsearch test; set ELASTIC_LIVE_TEST=1")
class LiveIndexAgreementTests(SimpleTestCase):
    def test_the_live_index_holds_exactly_the_catalogue_in_the_files(self):
        from catalogue.es import get_client, index_name
        in_index = list(index_docs(get_client(), index_name()))
        self.assertEqual(differences(file_docs(), in_index)[:8], [], "re-ingest: uv run python -m catalogue.ingest")
        self.assertEqual(fingerprint(file_docs()), fingerprint(in_index))
