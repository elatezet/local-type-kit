#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Erzeugt die englische und die deutsche Seite aus einer Quelle.

    python3 build.py

Geschrieben werden `index.html` (Englisch) und `de/index.html` (Deutsch). Beide
sind erzeugt und werden bei jedem Lauf ueberschrieben; bearbeitet werden
`template.html` fuer das Markup und `strings.json` fuer die Texte.

Der Grund fuer den Generator statt zweier gepflegter Dateien: zwei Fassungen von
Hand laufen auseinander, und zwar leise. Hier kann eine Sprache hoechstens
fehlen, und dann sagt es das Skript.
"""
import json
import pathlib
import re
import sys

HIER = pathlib.Path(__file__).resolve().parent
SPRACHEN = {
    # Kennung -> (Zielpfad, Praefix zu den Dateien im Wurzelverzeichnis)
    "en": (HIER / "index.html", ""),
    "de": (HIER / "de" / "index.html", "../"),
}
ANDERE = {"en": "de", "de": "en"}

LINKS = {}

# Symbole. Sie stehen hier und nicht in `strings.json`, weil sie Markup sind
# und kein Text: eine Uebersetzung soll an ihnen nichts aendern koennen.
#
# Woher sie kommen, ist nicht beliebig, sie sind von fieldpack.dev uebernommen. Die Erdkugel ist Remixicon,
# unveraendert aus `node_modules/remixicon/icons/` uebernommen, dieselbe
# Bibliothek und dieselbe Kugel wie im Kopf von panoptia.com. Sonne und Mond
# zeichnet panoptia.com selbst mit der Kontur, sie sind von dort kopiert. Nichts davon ist nachgezeichnet.
def _svg(inhalt: str) -> str:
    return ('<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" '
            + inhalt + "</svg>")


ICONS = {
    # Remixicon 4.9.1, Business/global-line.svg
    "icon_global": _svg(
        'fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M12 22C6.4'
        '7715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12'
        'C22 17.5228 17.5228 22 12 22ZM9.71002 19.6674C8.74743 17.6259 8.15732 15.3'
        '742 8.02731 13H4.06189C4.458 16.1765 6.71639 18.7747 9.71002 19.6674ZM10.0'
        '307 13C10.1811 15.4388 10.8778 17.7297 12 19.752C13.1222 17.7297 13.8189 1'
        '5.4388 13.9693 13H10.0307ZM19.9381 13H15.9727C15.8427 15.3742 15.2526 17.6'
        '259 14.29 19.6674C17.2836 18.7747 19.542 16.1765 19.9381 13ZM4.06189 11H8.'
        '02731C8.15732 8.62577 8.74743 6.37407 9.71002 4.33256C6.71639 5.22533 4.45'
        '8 7.8235 4.06189 11ZM10.0307 11H13.9693C13.8189 8.56122 13.1222 6.27025 12'
        ' 4.24799C10.8778 6.27025 10.1811 8.56122 10.0307 11ZM14.29 4.33256C15.2526'
        ' 6.37407 15.8427 8.62577 15.9727 11H19.9381C19.542 7.8235 17.2836 5.22533 '
        '14.29 4.33256Z"/>'
    ),
    # panoptia.com, src/components/Header.astro, der Dunkelschalter
    "icon_sun": _svg(
        'fill="none" stroke="currentColor"><circle cx="12" cy="12" r="5" stroke-widt'
        'h="2"/><path stroke-width="2" d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 '
        '18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>'
    ),
    "icon_moon": _svg(
        'fill="none" stroke="currentColor"><path stroke-width="2" d="M21 12.79A9 9 0'
        ' 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'
    ),
}


def main() -> int:
    vorlage = (HIER / "template.html").read_text(encoding="utf-8")
    texte = json.loads((HIER / "strings.json").read_text(encoding="utf-8"))
    fehler = []

    for sprache, (ziel, wurzel) in SPRACHEN.items():
        werte = {"lang": sprache, "root": wurzel, "lang_other": ANDERE[sprache]}
        werte.update(ICONS)
        for schluessel, fassungen in texte.items():
            if schluessel.startswith("_"):
                continue
            if sprache not in fassungen:
                fehler.append(f"{schluessel}: keine Fassung fuer {sprache}")
                continue
            werte[schluessel] = fassungen[sprache].format(**LINKS)

        seite = vorlage
        for schluessel, wert in werte.items():
            seite = seite.replace("{{" + schluessel + "}}", wert)

        offen = sorted(set(re.findall(r"\{\{([a-z0-9_]+)\}\}", seite)))
        if offen:
            fehler.append(f"{sprache}: nicht ersetzt: {', '.join(offen)}")

        ziel.parent.mkdir(parents=True, exist_ok=True)
        ziel.write_text(seite, encoding="utf-8")
        print(f"geschrieben: {ziel.relative_to(HIER)}  ({len(seite):,} Zeichen)")

    # Jedes Bild, auf das die Seiten zeigen, muss auch dasein. Ein fehlendes
    # faellt sonst erst dem Besucher auf.
    for ziel, _ in SPRACHEN.values():
        seite = ziel.read_text(encoding="utf-8")
        for pfad in re.findall(r'(?:src|href)="((?:\.\./)?assets/[^"]+)"', seite):
            datei = (ziel.parent / pfad).resolve()
            if not datei.exists():
                fehler.append(f"{ziel.name}: fehlt {pfad}")

    if fehler:
        print("\nFehler:", file=sys.stderr)
        for zeile in sorted(set(fehler)):
            print("  " + zeile, file=sys.stderr)
        return 1

    print("alles vollstaendig")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
