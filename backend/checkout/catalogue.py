"""Explicit sandbox fixtures; replace with the team's authoritative catalogue adapter."""
VENDOR = {"id": "friday-sandbox", "name": "FRIDAY Sandbox Furniture"}
# Two different facts, never to be conflated. VENDOR above is the MERCHANT OF RECORD: the one Visa sandbox account every
# payment goes through, and the merchantName Visa is sent. A line's vendor is who that piece comes from, so a bill for a
# whole building can say which vendor each line belongs to. Synthetic listings (stub, seed) are the sandbox's own.
LINE_VENDORS = {"ikea": {"id": "ikea", "name": "IKEA"}, "abo": {"id": "amazon", "name": "Amazon"}}


def vendor_for(source):
    return LINE_VENDORS.get(source, VENDOR)
PRODUCTS = {
    "sample-sofa": {"name": "Sample two-seat sofa", "unit_amount": 42500},
    "sample-lamp": {"name": "Sample reading lamp", "unit_amount": 7900},
}


def snapshot(items):
    lines = [{"product_id": item["product_id"], **PRODUCTS[item["product_id"]],
              "quantity": item["quantity"], "line_amount": PRODUCTS[item["product_id"]]["unit_amount"] * item["quantity"]}
             for item in items]
    return {"vendor": VENDOR, "items": lines, "amount": sum(line["line_amount"] for line in lines),
            "currency": "USD", "exponent": 2, "sandbox": True}
