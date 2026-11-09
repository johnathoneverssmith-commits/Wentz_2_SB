"""Derived scheme tags — Python mirror of ``src/engine/scheme-tags.ts``.

Tags implied by position + attributes, for a player with no ``scheme_tags`` of
his own. Keep identical to the TypeScript.
"""

from __future__ import annotations


def derived_scheme_tags(position: str, attributes: dict) -> list[str]:
    def a(k: str) -> float:
        return attributes.get(k, 0) or 0

    if position == "QB":
        if a("speed") >= 85:
            return ["rpo", "play_action"]
        if a("throw_power") >= 90:
            return ["vertical", "play_action"]
        return ["west_coast"]
    if position == "RB":
        return (["power_run", "gap_scheme"] if a("break_tackle") >= 85 or a("strength") >= 80
                else ["outside_zone", "zone_run"])
    if position == "WR":
        if a("speed") >= 93:
            return ["vertical", "spread"]
        if a("route_running_short") >= 82:
            return ["west_coast", "spread"]
        return ["west_coast"]
    if position == "TE":
        return ["inline", "play_action"] if a("run_block") >= 74 else ["move_te", "spread"]
    if position in ("OT", "OG", "C"):
        return ["outside_zone"] if a("agility") >= 68 else ["gap_scheme", "power_run"]
    if position == "EDGE":
        return ["wide_9", "attack"] if a("finesse_moves") >= a("power_moves") else ["two_gap", "contain"]
    if position == "DT":
        return ["one_gap", "penetrate"] if a("power_moves") >= 78 else ["two_gap", "nose"]
    if position in ("ILB", "OLB"):
        if a("man_coverage") >= 76:
            return ["nickel", "cover_man"]
        return (["base_4_3", "cover_2"] if a("zone_coverage") >= a("block_shedding")
                else ["base_3_4", "cover_3"])
    if position == "CB":
        return ["man_press", "cover_1"] if a("press") >= 80 else ["zone", "cover_3"]
    if position == "S":
        return ["single_high", "robber"] if a("man_coverage") >= 78 else ["split_safety", "cover_2"]
    return []


def effective_scheme_tags(p: dict | None):
    """Stored tags when present, else derived. None for an empty slot."""
    if not p:
        return None
    tags = p.get("scheme_tags")
    if tags:
        return tags
    return derived_scheme_tags(p.get("position", ""), p.get("attributes", {}))
