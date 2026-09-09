"""Headless play-by-play simulation engine (spec §4, §29).

Consumes the Phase B/C/D artifacts; stitches the resolvers into a game loop
in strict event chronology; emits play events from which team stats emerge
(never a final score first). Used by 23_full_sim_validation.py for the §22
average-rating league-distribution check (rating modifiers = 0).
"""
