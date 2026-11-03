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
    # Remixicon 4.9.1, Logos/figma-line.svg
    "icon_figma": _svg('fill="currentColor" xmlns="http://www.w3.org/2000/svg">'
        + '<path d="M5 6C5 3.79086 6.79086 2 9 2H15C17.2091 2 19 3.79086 19 6C19 7.19469 18.4762 8.26706 17.6458 9C18.4762 9.73295 19 10.8053 19 12C19 14.2091 17.2091 16 15 16C14.2714 16 13.5883 15.8052 13 15.4649V18C13 20.2091 11.2091 22 9 22C6.79086 22 5 20.2091 5 18C5 16.8053 5.52376 15.7329 6.35418 15C5.52376 14.2671 5 13.1947 5 12C5 10.8053 5.52376 9.73295 6.35418 9C5.52376 8.26706 5 7.19469 5 6ZM11 10H9C7.89543 10 7 10.8954 7 12C7 13.1046 7.89543 14 9 14H11V10ZM13 12C13 13.1046 13.8954 14 15 14C16.1046 14 17 13.1046 17 12C17 10.8954 16.1046 10 15 10C13.8954 10 13 10.8954 13 12ZM15 8C16.1046 8 17 7.10457 17 6C17 4.89543 16.1046 4 15 4H13V8H15ZM9 4C7.89543 4 7 4.89543 7 6C7 7.10457 7.89543 8 9 8H11V4H9ZM11 16H9C7.89543 16 7 16.8954 7 18C7 19.1046 7.89543 20 9 20C10.1046 20 11 19.1046 11 18V16Z"/>'),
    # Remixicon 4.9.1, Logos/claude-line.svg
    "logo_claude": _svg('fill="currentColor" xmlns="http://www.w3.org/2000/svg">' + '<path d="M8.64445 2.55279C8.39746 2.05881 7.79679 1.85859 7.30281 2.10558C6.80883 2.35257 6.60861 2.95324 6.8556 3.44722L9.68128 9.09859L5.06655 5.92596C4.61145 5.61308 3.98887 5.72837 3.67598 6.18348C3.3631 6.63858 3.47839 7.26116 3.9335 7.57405L9.40503 11.3357L3.05258 11.0014C2.50106 10.9724 2.03043 11.3959 2.00141 11.9474C1.97238 12.499 2.39594 12.9696 2.94747 12.9986L8.74187 13.3036L4.44532 16.168C3.9858 16.4743 3.86162 17.0952 4.16797 17.5547C4.47433 18.0142 5.0952 18.1384 5.55473 17.8321L9.19687 15.404L6.68629 18.9188C6.36528 19.3682 6.46937 19.9927 6.91879 20.3137C7.3682 20.6347 7.99275 20.5307 8.31376 20.0812L11.3471 15.8345L10.5136 20.8356C10.4228 21.3804 10.7909 21.8956 11.3356 21.9864C11.8804 22.0772 12.3956 21.7092 12.4864 21.1644L13.2883 16.3532L15.6588 20.0408C15.9575 20.5053 16.5762 20.6398 17.0408 20.3412C17.5054 20.0425 17.6399 19.4238 17.3412 18.9592L15.5553 16.1812L18.3217 18.7348C18.7276 19.1094 19.3602 19.0841 19.7348 18.6783C20.1094 18.2725 20.0841 17.6398 19.6783 17.2652L16.6427 14.4631L20.876 14.9923C21.424 15.0608 21.9238 14.6721 21.9923 14.124C22.0608 13.576 21.6721 13.0762 21.1241 13.0077L16.9342 12.484L21.2291 11.4734C21.7667 11.3469 22.0999 10.8086 21.9734 10.271C21.8469 9.73336 21.3086 9.40009 20.771 9.52659L15.1819 10.8417L19.2863 5.61783C19.6276 5.18356 19.5521 4.5549 19.1178 4.21369C18.6836 3.87247 18.0549 3.94791 17.7137 4.38218L13.8574 9.29015L14.738 3.65438C14.8233 3.10872 14.4501 2.59725 13.9044 2.51199C13.3587 2.42673 12.8473 2.79996 12.762 3.34563L11.876 9.01594L8.64445 2.55279Z"/>'),
    # Remixicon 4.9.1, Logos/openai-line.svg
    "logo_openai": _svg('fill="currentColor" xmlns="http://www.w3.org/2000/svg">' + '<path d="M11 4C11.6487 4 12.2498 4.20569 12.7411 4.55646C11.4486 5.22914 10.2602 6.07623 8.99996 6.80385L9.99996 8.5359C11.575 7.62654 13.0517 6.48541 14.7608 5.83037C16.1134 5.31198 17.681 5.83976 18.4282 7.13398C18.7526 7.69582 18.8749 8.31917 18.8168 8.92006C17.588 8.13708 16.2602 7.53146 15 6.80385L14 8.5359C15.575 9.44525 17.3016 10.1536 18.7234 11.3061C19.8487 12.2183 20.1754 13.8398 19.4282 15.134C19.1037 15.696 18.6249 16.1137 18.0752 16.3638C18.1385 14.9081 18 13.4553 18 12H16C16 13.8184 16.2498 15.6685 15.9626 17.4758C15.7353 18.9063 14.4944 20 13 20C12.351 20 11.7498 19.7942 11.2584 19.4432C12.5508 18.7701 13.7396 17.9238 15 17.1962L14 15.4641C12.4252 16.3733 10.9478 17.5147 9.23912 18.1696C7.88657 18.688 6.31898 18.1602 5.57176 16.866C5.24729 16.304 5.12493 15.6805 5.18316 15.0794C6.41224 15.8621 7.73964 16.4685 8.99997 17.1962L9.99997 15.4641C8.42517 14.5549 6.69801 13.8462 5.27649 12.6939C4.15128 11.7817 3.82455 10.1602 4.57176 8.86602C4.89624 8.30402 5.37506 7.88628 5.9247 7.63618C5.86145 9.09192 5.99997 10.5447 5.99997 12H7.99997C7.99997 10.1816 7.75013 8.33148 8.03733 6.52422C8.26467 5.09369 9.50554 4 11 4ZM14.7925 3.74171C13.8765 2.67659 12.5176 2 11 2C8.7782 2 6.89621 3.44833 6.24435 5.45243C4.86393 5.71314 3.59851 6.55175 2.83971 7.86602C1.72883 9.79013 2.04213 12.1442 3.4518 13.7107C2.98737 15.0366 3.08092 16.5518 3.83971 17.866C4.95059 19.7901 7.14589 20.6958 9.20742 20.2583C10.1234 21.3234 11.4824 22 13 22C15.2217 22 17.1037 20.5517 17.7556 18.5476C19.136 18.2869 20.4014 17.4482 21.1602 16.134C22.2711 14.2099 21.9578 11.8559 20.5481 10.2893C21.0126 8.96345 20.919 7.44825 20.1602 6.13398C19.0493 4.20987 16.854 3.30419 14.7925 3.74171Z"/>'),
    # Remixicon 4.9.1, Logos/cursor-ai-line.svg
    "logo_cursor": _svg('fill="currentColor" xmlns="http://www.w3.org/2000/svg">' + '<path d="M11.5498 1.35371C11.8283 1.19393 12.1718 1.19388 12.4502 1.35371L21.1211 6.33028C21.3551 6.46462 21.5 6.71356 21.5 6.98263V17.0188L21.4941 17.1184C21.4632 17.3478 21.3266 17.5526 21.1221 17.6701L12.4502 22.6477L12.3428 22.6995C12.0868 22.8042 11.7933 22.7874 11.5498 22.6477L2.87891 17.6701C2.67422 17.5527 2.53781 17.3479 2.50684 17.1184L2.5 17.0188V6.98263C2.5 6.71356 2.64488 6.46462 2.87891 6.33028L11.5498 1.35371ZM4.5 7.70528V16.2942L12 20.5989V12.3049C12 12.1165 11.8987 11.9416 11.7344 11.8469L4.50879 7.69943L4.5 7.70528ZM13.3535 19.8215L19.5 16.2942V9.23849L13.3535 19.8215ZM5.86133 6.92403H18.1387L11.999 3.40059L5.86133 6.92403Z"/>'),
    # Remixicon 4.9.1, Logos/gemini-line.svg
    "logo_gemini": _svg('fill="currentColor" xmlns="http://www.w3.org/2000/svg">' + '<path d="M11.1244 1.09094H12.8753L12.9269 1.9453C13.2227 6.85075 17.1493 10.7773 22.0546 11.0732L22.909 11.1247V12.8757L22.0546 12.9272C17.1493 13.2231 13.2227 17.1498 12.9269 22.0551L12.8753 22.9095H11.1244L11.0728 22.0551C10.777 17.1498 6.85036 13.2231 1.94518 12.9272L1.09082 12.8757V11.1247L1.94518 11.0732C6.85036 10.7773 10.777 6.85075 11.0728 1.9453L11.1244 1.09094ZM11.9999 5.85023C10.83 8.61547 8.61512 10.8304 5.84996 12.0002C8.61512 13.1701 10.83 15.385 11.9999 18.1502C13.1697 15.385 15.3846 13.1701 18.1498 12.0002C15.3846 10.8304 13.1697 8.61547 11.9999 5.85023Z"/>'),
    # Remixicon 4.9.1, Logos/grok-ai-line.svg
    "logo_grok": _svg('fill="currentColor" xmlns="http://www.w3.org/2000/svg">' + '<path d="M15.7754 2.77832C12.1756 1.29525 7.86569 2.03348 4.93945 4.96094 3.05829 6.84454 2.03903 9.40497 2.02376 12 2.01618 13.2875 2.25573 14.5835 2.75977 15.8096 3.89507 18.5729 1.99897 21.0271.124023 23L6.2285 17.5399C4.8483 16.1023 4 14.1502 4 12 4 7.58172 7.58172 4 12 4 13.3173 4 14.5602 4.31838 15.656 4.8824L17.8076 3.8877C17.2661 3.49585 16.5718 3.07449 15.7754 2.77832ZM21.6963 9.7334C20.7087 5.48171 21.6357 3.27424 23.9004.0996094L8.58984 15.4717 18.1992 8.80597C18.6339 8.48506 19.2549 8.61084 19.4619 9.10968 19.8094 10.0061 20 10.9808 20 12 20 16.4183 16.4183 20 12 20 10.6968 20 9.46638 19.6884 8.37918 19.1356L5.19629 20.1445C6.83273 21.3127 9.8361 22 12 22 17.5228 22 22 17.5228 22 12 21.9959 11.2365 21.8709 10.4756 21.6963 9.7334Z"/>'),
    "icon_menu": _svg('fill="none" stroke="currentColor"><path stroke-width="2" stroke-linecap="round" d="M4 7h16M4 12h16M4 17h16"/>'),
    "icon_close": _svg('fill="none" stroke="currentColor"><path stroke-width="2" stroke-linecap="round" d="M6 6l12 12M18 6 6 18"/>'),
    "icon_copy": _svg('fill="none" stroke="currentColor"><rect x="8" y="8" width="12" height="12" rx="2" stroke-width="2"/><path stroke-width="2" d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
    "icon_moon": _svg(
        'fill="none" stroke="currentColor"><path stroke-width="2" d="M21 12.79A9 9 0'
        ' 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'
    ),
}


def plugin_kopieren() -> None:
    """Die Seite zeigt die echte Oberflaeche. Sie wird bei jedem Lauf aus dem Plugin kopiert,
    damit die Seite nie einen aelteren Stand zeigt als das Plugin."""
    quelle = HIER.parent / "ui.html"
    ziel = HIER / "plugin" / "ui.html"
    ziel.parent.mkdir(exist_ok=True)
    ziel.write_text(quelle.read_text(encoding="utf-8"), encoding="utf-8")
    print(f"kopiert: ../ui.html -> {ziel.relative_to(HIER)}")


def main() -> int:
    plugin_kopieren()
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
