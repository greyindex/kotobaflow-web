# Theme palette references and notices

W-03 uses a small selection of colors from the following themes and adapts them for Japanese reading. It does not bundle a syntax highlighter, upstream theme files, fonts, images, or Codex source code. All remaining component colors are derived by the site's own implementation in `js/appearance.js`.

- **Catppuccin**: [palette.json](https://github.com/catppuccin/palette/blob/07d02aa110ef9eb7e7427afca5c73ba9cf7f8ebd/palette.json), commit `07d02aa110ef9eb7e7427afca5c73ba9cf7f8ebd`; Latte/Mocha background, text and mauve references. The light accent is darkened for selected-state contrast. [MIT license](https://github.com/catppuccin/palette/blob/07d02aa110ef9eb7e7427afca5c73ba9cf7f8ebd/LICENSE).
- **Nord**: [src/nord.css](https://github.com/nordtheme/nord/blob/1cef71605416a222e57225b544540ce0fcec18d4/src/nord.css), commit `1cef71605416a222e57225b544540ce0fcec18d4`; Polar Night/Snow Storm surfaces and Frost accent references. Light and dark accents are adjusted for reading and selected states. [MIT license](https://github.com/nordtheme/nord/blob/1cef71605416a222e57225b544540ce0fcec18d4/license).
- **Gruvbox**: [colors/gruvbox.vim](https://github.com/morhetz/gruvbox/blob/5d15b2765f59754d7ac263c88a0f6e3e58124951/colors/gruvbox.vim), commit `5d15b2765f59754d7ac263c88a0f6e3e58124951`; light/dark paper, foreground and yellow references. The light accent is darkened for reading. Author: morhetz <morhetz@gmail.com>. The upstream [README declares MIT/X11](https://github.com/morhetz/gruvbox/blob/5d15b2765f59754d7ac263c88a0f6e3e58124951/README.md#license).

Source review: 2026-09-13. The original gray-green and neutral ink presets, the traditional-color presets 藍染, 紺碧, 抹茶, 桜色 and 柿色 (added 2026-10-02), and the default 简洁 preset (white / near-black, added 2026-10-16) are site-owned palettes.

The upstream theme selection was traced from [openai/codex theme_picker.rs](https://github.com/openai/codex/blob/1715e55076737158ba61d43158ede504de6d4ce1/codex-rs/tui/src/theme_picker.rs) to [render/highlight.rs](https://github.com/openai/codex/blob/1715e55076737158ba61d43158ede504de6d4ce1/codex-rs/tui/src/render/highlight.rs), which lists the themes provided by `two_face`. This is the public terminal implementation; it is not a claim that the desktop client's complete theme source was located or reproduced.

## MIT notices

Catppuccin: Copyright (c) 2021 Catppuccin.

Nord: Copyright (c) 2016-present Sven Greb <development@svengreb.de> (https://www.svengreb.de).

Gruvbox: morhetz <morhetz@gmail.com>; upstream declares MIT/X11 as linked above.

The MIT permission and warranty text below applies to the referenced upstream material; it does not relicense this repository as a whole.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
