(function (root) {
  'use strict';

  var app = root.JPLearn || (root.JPLearn = {});

  app.textbookImageMethods = Object.freeze({
    _renderLessonLeadImage: function (lesson) {
      if (!lesson || this.showImages === false) return '';
      var sections = [lesson.body, lesson.application, lesson.study_window];
      for (var i = 0; i < sections.length; i++) {
        var section = sections[i];
        var imageConfig = this._resolveSectionImageConfig(
          section,
          section && section.title ? section.title : '',
          lesson,
        );
        if (!imageConfig || imageConfig.position !== 'lesson_header') continue;
        return (
          '<div class="tb-reader-lead-media">' + this._renderResolvedSectionImage(imageConfig) + '</div>'
        );
      }
      var autoImage = this._buildAutoLessonImageConfig(lesson);
      if (autoImage)
        return '<div class="tb-reader-lead-media">' + this._renderResolvedSectionImage(autoImage) + '</div>';
      return '';
    },

    _getSectionImagePosition: function (section) {
      if (!section) return '';
      return this._cleanValue(section.image_position || section.image_layout || '').toLowerCase();
    },

    _resolveSectionImageConfig: function (section, sectionTitle, lesson) {
      if (!section) return '';
      var src = this._cleanValue(section.image_path || section.image_src);
      var position = this._getSectionImagePosition(section);
      if (!src) return null;
      var alt = this._cleanValue(section.image_alt) || this._buildSectionImageAlt(lesson, sectionTitle);
      var caption = this._cleanValue(section.image_caption);
      var width = parseInt(section.image_width, 10);
      var height = parseInt(section.image_height, 10);
      return {
        src: src,
        alt: alt,
        caption: caption,
        width: isNaN(width) ? 0 : width,
        height: isNaN(height) ? 0 : height,
        position: position || '',
      };
    },

    _buildAutoLessonImageConfig: function (lesson) {
      if (!lesson || !this.currentBookId) return null;
      // KotobaFlow topic illustrations are not produced yet; never borrow another book's image.
      if (TextbookLoader.isKotobaBook(this.currentBookId)) return null;
      var key = '';
      if (
        lesson.review_unit_no !== null &&
        lesson.review_unit_no !== undefined &&
        lesson.review_unit_no !== ''
      )
        key = 'r' + parseInt(lesson.review_unit_no, 10);
      else if (lesson.lesson_no !== null && lesson.lesson_no !== undefined && lesson.lesson_no !== '')
        key = String(parseInt(lesson.lesson_no, 10));
      if (!key || key === 'NaN' || key === 'rNaN') return null;
      return {
        src: 'image/' + this.currentBookId + '/' + key + '.png',
        alt: this._buildSectionImageAlt(lesson, ''),
        position: 'lesson_header',
      };
    },

    _buildSectionImageAlt: function (lesson, sectionTitle) {
      var lessonTitle = lesson && lesson.title ? this._cleanValue(lesson.title) : '';
      if (lessonTitle) return lessonTitle + ' 插图';
      if (sectionTitle) return this._cleanValue(sectionTitle) + ' 插图';
      return '课文插图';
    },

    _renderSectionImage: function (section, sectionTitle, lesson) {
      return this._renderResolvedSectionImage(this._resolveSectionImageConfig(section, sectionTitle, lesson));
    },

    // Illustrations follow the reader's image preference; teaching charts
    // (options.teaching) always render.
    _renderResolvedSectionImage: function (imageConfig, options) {
      if (!imageConfig || !imageConfig.src) return '';
      if (this.showImages === false && !(options && options.teaching)) return '';
      var sizeAttrs = '';
      if (imageConfig.width > 0) sizeAttrs += ' width="' + imageConfig.width + '"';
      if (imageConfig.height > 0) sizeAttrs += ' height="' + imageConfig.height + '"';
      var html =
        '<figure class="tb-section-figure"><picture>' +
        (/^image\/XinBian[1-4]\/[^/]+\.png$/.test(imageConfig.src)
          ? '<source type="image/webp" srcset="' +
            this._esc(imageConfig.src.replace(/\.png$/, '.webp')) +
            '">'
          : '') +
        '<img class="tb-section-image" src="' +
        this._esc(imageConfig.src) +
        '" alt="' +
        this._esc(imageConfig.alt || '课文插图') +
        '"' +
        sizeAttrs +
        ' loading="eager" fetchpriority="high" decoding="async"></picture>';
      if (imageConfig.caption)
        html += '<figcaption class="tb-section-caption">' + this._esc(imageConfig.caption) + '</figcaption>';
      html += '</figure>';
      return html;
    },
  });
})(window);
