"""Display formatting for the integer units the system runs on. Pure. Never used for storage or maths."""

MM_PER_INCH = 25.4
MM_PER_FOOT = 304.8
WHOLE_UNIT_TOLERANCE_MM = 1


def _whole(mm: int, unit_mm: float) -> int | None:
    count = round(mm / unit_mm)
    return count if count > 0 and abs(count * unit_mm - mm) <= WHOLE_UNIT_TOLERANCE_MM else None


def format_mm(mm: int) -> str:
    """Show a length the way it was probably said: whole feet, else whole inches, else metric."""
    feet = _whole(mm, MM_PER_FOOT)
    if feet is not None:
        return f"{feet} ft"
    inches = _whole(mm, MM_PER_INCH)
    if inches is not None:
        return f"{inches} in"
    if mm % 10 == 0:
        return f"{mm / 1000:g} m" if mm % 500 == 0 and mm >= 1000 else f"{mm // 10} cm"
    return f"{mm} mm"


def format_cents(cents: int) -> str:
    dollars, remainder = divmod(cents, 100)
    return f"${dollars:,}" if remainder == 0 else f"${dollars:,}.{remainder:02d}"
