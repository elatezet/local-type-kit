# Local Type

A Figma plugin for teams whose typeface lives on their own machines, not on Figma's servers. Licensed brand fonts often may not be uploaded to a shared font service. Figma's desktop app can still use them, and this plugin does the repetitive work around them across a whole file.

It does four things:

1. **Fonts** lists every font the file uses, in text layers and in local text styles, and marks the ones that are not installed on your machine.
2. **Replace** swaps fonts everywhere: loose text, components, instance overrides and local styles, including mixed text runs. Components change first, so instances only keep the overrides they really have. Text that uses a style follows the style. Preview shows the counts before anything changes.
3. **Styles** creates or updates text styles from a variable collection and binds family, size and line height to the variables.
4. **Assign** gives loose text the one local style that matches its family, weight, size and line height exactly. Where more than one style fits, it leaves the text alone and tells you.

## Safe by design

- No network access. The manifest allows no domains.
- Nothing is uploaded. Fonts load from your machine through the desktop app, the same way Figma uses them anyway.
- Every change has a preview, and every run is one undo step.
- Layers whose font family is bound to a variable are skipped and listed, never unbound.
- The configuration is stored in the file, so the next person runs the same setup.

One limit belongs to Figma, not to the plugin: people without the font installed see it as missing. Local Type tells you where that is the case; it cannot make a font appear on someone else's machine.

## Install

1. Download or clone this repository.
2. In the Figma desktop app: Plugins → Development → Import plugin from manifest, and pick `manifest.json`.
3. Open a design file and run Plugins → Development → Local Type.

## Styles configuration

The Styles tab takes JSON. Variable names are `<group><sizeSuffix>` and `<group><lineHeightSuffix>`; the family comes from a string variable or a fixed name.

```json
{
  "collection": "Typography",
  "sizeSuffix": "/font-size",
  "lineHeightSuffix": "/line-height",
  "styles": [
    { "name": "heading-1", "group": "heading-1", "familyVariable": "font/heading", "style": "Bold" },
    { "name": "body", "group": "body", "family": "Inter", "style": "Regular", "description": "Running text" }
  ]
}
```

## License

MIT
