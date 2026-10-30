(function () {
  'use strict';

  var icons = {
    'arrow-left': '<path d="M19 12H5M11 18l-6-6 6-6"/>',
    book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5z"/>',
    brain:
      '<path d="M9 4a3 3 0 0 0-5 2.2A3 3 0 0 0 3 12a3 3 0 0 0 3 5.8A3 3 0 0 0 12 17V7a3 3 0 0 0-3-3zM15 4a3 3 0 0 1 5 2.2A3 3 0 0 1 21 12a3 3 0 0 1-3 5.8A3 3 0 0 1 12 17"/><path d="M8 9h4M16 9h-4M8 14h4M16 14h-4"/>',
    calendar:
      '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    'chevron-left': '<path d="m15 18-6-6 6-6"/>',
    'chevron-right': '<path d="m9 18 6-6-6-6"/>',
    'chevron-up': '<path d="m6 15 6-6 6 6"/>',
    clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M8 9h8M8 13h8M8 17h5"/>',
    diamond: '<path d="m12 3 9 9-9 9-9-9z"/>',
    eye: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="2.5"/>',
    'eye-off':
      '<path d="m3 3 18 18M10.5 6.2A10 10 0 0 1 12 6c6 0 9.5 6 9.5 6a15 15 0 0 1-2.1 2.8M6.6 6.6C4 8.3 2.5 12 2.5 12s3.5 6 9.5 6a9 9 0 0 0 3-.5"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
    folder: '<path d="M3 6h7l2 3h9v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    grammar: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M8 8h7M8 12h7M8 16h4"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5"/>',
    library: '<path d="M4 5h4v15H4zM10 3h4v17h-4zM16 6h4v14h-4z"/><path d="M3 20h18"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
    maximize: '<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/>',
    minimize: '<path d="M8 3v5H3M16 3v5h5M8 21v-5H3M16 21v-5h5"/>',
    network:
      '<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="18" r="2.5"/><circle cx="19" cy="18" r="2.5"/><path d="m10.7 7.2-4.4 8.6M13.3 7.2l4.4 8.6M7.5 18h9"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    pencil: '<path d="m4 20 4.5-1 10-10-3.5-3.5-10 10zM13.5 7l3.5 3.5"/>',
    play: '<path d="m8 5 11 7-11 7z"/>',
    repeat: '<path d="M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3"/>',
    'rotate-ccw': '<path d="M3 7v5h5M4.5 16a8 8 0 1 0 .8-9.7L3 9"/>',
    ruler: '<path d="m4 17 13-13 3 3L7 20zM13 8l3 3M10 11l2 2M7 14l3 3"/>',
    scale: '<path d="M12 3v18M6 6h12M5 6l-3 6h6zM19 6l-3 6h6zM8 21h8"/>',
    scroll:
      '<path d="M9.5 3.6 12 1.9l2.5 1.7"/><path d="M5 4.6h14"/><path d="M7 4.6v13.9M17 4.6v13.9"/><rect x="4.5" y="18.5" width="15" height="2.6" rx="1.3"/><path d="M14 8.6v7M10.5 8.6v4.4"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/>',
    settings:
      '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/>',
    shuffle: '<path d="M16 3h5v5M4 20l6.5-6.5M21 3l-7.5 7.5M16 16h5v5M14.5 14.5 21 21M4 4l6.5 6.5"/>',
    skip: '<path d="m5 5 9 7-9 7zM18 5v14"/>',
    sparkles:
      '<path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2zM19 14l.7 2.3L22 17l-2.3.7L19 20l-.7-2.3L16 17l2.3-.7zM5 13l.8 2.2L8 16l-2.2.8L5 19l-.8-2.2L2 16l2.2-.8z"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
    tag: '<path d="M20 13 13 20 4 11V4h7z"/><circle cx="8.5" cy="8.5" r="1.5"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/>',
    text: '<path d="M4 5h16M12 5v14M8 19h8"/>',
    trash: '<path d="M4 7h16M9 3h6l1 4H8zM6 7l1 14h10l1-14M10 11v6M14 11v6"/>',
    volume: '<path d="M11 5 6 9H3v6h3l5 4zM15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12"/>',
    wand: '<path d="m4 20 10-10M12 4l1-2M18 8l2-1M17 3l1.5 1.5M7 7 5.5 5.5M3 13l2-1"/><path d="m13 9 2 2-9 9-2-2z"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    'x-circle': '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
  };

  function render(el) {
    var name = el.getAttribute('name');
    var body = icons[name] || icons['diamond'];
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" focusable="false">' +
      body +
      '</svg>';
  }

  function UiIcon() {
    return Reflect.construct(HTMLElement, [], UiIcon);
  }
  UiIcon.prototype = Object.create(HTMLElement.prototype);
  UiIcon.prototype.constructor = UiIcon;
  UiIcon.prototype.connectedCallback = function () {
    render(this);
  };
  UiIcon.prototype.attributeChangedCallback = function () {
    if (this.isConnected) render(this);
  };
  UiIcon.observedAttributes = ['name'];
  Object.setPrototypeOf(UiIcon, HTMLElement);

  if (!customElements.get('ui-icon')) customElements.define('ui-icon', UiIcon);
  window.uiIcon = function (name) {
    return '<ui-icon name="' + name + '"></ui-icon>';
  };
})();
