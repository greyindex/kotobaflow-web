(function (root) {
  'use strict';

  var app = root.JPLearn || (root.JPLearn = {});

  app.installGraphBuilders = function (GraphBuilder) {
    GraphBuilder.prototype.buildGraph = function (words, mode, limit) {
      mode = mode || 'domain';
      limit = limit || 100;

      var elements = [];
      var addedNodes = {};
      var renderWords = words.slice(0, limit);
      var mgr = window.taxonomyManager;

      for (var i = 0; i < renderWords.length; i++) {
        var wordObj = renderWords[i];
        var wordNodeId = 'word:' + wordObj.index;

        if (!addedNodes[wordNodeId]) {
          elements.push({
            data: {
              id: wordNodeId,
              type: 'word',
              label: wordObj.word,
              nodeSize: 40,
              rawData: wordObj,
            },
          });
          addedNodes[wordNodeId] = true;
        }

        // 根据模式选择关联的 codes
        var codes = mode === 'domain' ? wordObj.domain_codes : wordObj.semantic_tag_codes;
        var nodeType = mode;

        for (var j = 0; j < codes.length; j++) {
          var code = codes[j];
          var targetId = nodeType + ':' + code;

          if (!addedNodes[targetId]) {
            elements.push({
              data: {
                id: targetId,
                type: nodeType,
                label: mgr.getLabel(nodeType, code),
                nodeSize: 60,
                code: code,
                description: mgr.getDescription(nodeType, code),
              },
            });
            addedNodes[targetId] = true;
          }

          var edgeId = wordNodeId + '->' + targetId;
          elements.push({
            data: {
              id: edgeId,
              source: wordNodeId,
              target: targetId,
              type: mode === 'domain' ? 'word_in_domain' : 'word_has_semantic_tag',
            },
          });
        }
      }

      this.cy.elements().remove();
      this.cy.add(elements);

      var layout = this._getLayoutOptions(elements.length, 'cose');
      this.cy.layout(layout).run();

      // 性能保护
      this._applyPerformanceMode(renderWords.length);

      this._updateStats();
    };

    // ────────────────────────────────────────────────────────────
    // 聚合图：只显示分类节点，节点大小∝关联词数
    // ────────────────────────────────────────────────────────────

    /**
     * 构建聚合图
     * @param {Array} words - 过滤后的所有词条（不截断）
     * @param {string} mode - 'domain' or 'semantic'
     */
    GraphBuilder.prototype.buildAggregateGraph = function (words, mode) {
      mode = mode || 'domain';
      var mgr = window.taxonomyManager;
      var codeField = mode === 'domain' ? 'domain_codes' : 'semantic_tag_codes';

      // 1. 统计每个 code 关联的词数
      var codeCounts = {};
      var codeWords = {}; // code -> [wordObj, ...]
      for (var i = 0; i < words.length; i++) {
        var w = words[i];
        var codes = w[codeField];
        for (var j = 0; j < codes.length; j++) {
          var c = codes[j];
          if (!codeCounts[c]) {
            codeCounts[c] = 0;
            codeWords[c] = [];
          }
          codeCounts[c]++;
          if (codeWords[c].length < 100) {
            codeWords[c].push(w);
          }
        }
      }

      var allCodes = Object.keys(codeCounts);
      if (allCodes.length === 0) {
        this.cy.elements().remove();
        this._updateStats();
        return;
      }

      // 2. 计算节点大小范围：30 ~ 120
      var maxCount = 0;
      for (var k = 0; k < allCodes.length; k++) {
        if (codeCounts[allCodes[k]] > maxCount) maxCount = codeCounts[allCodes[k]];
      }

      var elements = [];
      var nodeType = mode;

      for (var k = 0; k < allCodes.length; k++) {
        var code = allCodes[k];
        var count = codeCounts[code];
        var size = 30 + Math.round((count / Math.max(maxCount, 1)) * 90);

        elements.push({
          data: {
            id: nodeType + ':' + code,
            type: nodeType,
            label: mgr.getLabel(nodeType, code) + ' (' + count + ')',
            nodeSize: size,
            code: code,
            wordCount: count,
            connectedWords: codeWords[code],
            description: mgr.getDescription(nodeType, code),
          },
        });
      }

      // 3. 构建共现边（优化：基于词→代码索引，仅当共享数≥阈值时连边）
      var pairCounts = {};
      var minShared = allCodes.length > 30 ? 10 : 3;
      for (var wi = 0; wi < words.length; wi++) {
        var wCodes = words[wi][codeField];
        for (var ca = 0; ca < wCodes.length; ca++) {
          for (var cb = ca + 1; cb < wCodes.length; cb++) {
            var pairKey =
              wCodes[ca] < wCodes[cb] ? wCodes[ca] + '|' + wCodes[cb] : wCodes[cb] + '|' + wCodes[ca];
            pairCounts[pairKey] = (pairCounts[pairKey] || 0) + 1;
          }
        }
      }
      var pairKeys = Object.keys(pairCounts);
      for (var pk = 0; pk < pairKeys.length; pk++) {
        var shared = pairCounts[pairKeys[pk]];
        if (shared < minShared) continue;
        var parts = pairKeys[pk].split('|');
        var edgeW = Math.min(1 + shared * 0.3, 8);
        elements.push({
          data: {
            id: 'co:' + parts[0] + '-' + parts[1],
            source: nodeType + ':' + parts[0],
            target: nodeType + ':' + parts[1],
            type: 'cooccurrence',
            weight: edgeW,
            sharedCount: shared,
          },
        });
      }

      this.cy.elements().remove();
      this.cy.add(elements);

      // 聚合图用专用布局参数（强排斥力，确保节点充分展开）
      var layout = this._getLayoutOptions(elements.length, 'aggregate');
      this.cy.layout(layout).run();

      this._updateStats();
    };

    /**
     * 计算两个 code 共享的词条数量
     */
    GraphBuilder.prototype._countSharedWords = function (words, field, codeA, codeB) {
      var count = 0;
      for (var i = 0; i < words.length; i++) {
        var codes = words[i][field];
        var hasA = false,
          hasB = false;
        for (var j = 0; j < codes.length; j++) {
          if (codes[j] === codeA) hasA = true;
          if (codes[j] === codeB) hasB = true;
        }
        if (hasA && hasB) count++;
      }
      return count;
    };

    // ────────────────────────────────────────────────────────────
    // 局部图：以某节点为中心的一阶邻居子图
    // ────────────────────────────────────────────────────────────

    /**
     * 构建局部图
     * @param {object} center - { type: 'word'|'domain'|'semantic', data: obj }
     * @param {Array} allFilteredWords - 当前筛选后的所有词条
     * @param {string} mode - 'domain' or 'semantic'（仅当 center.type !== 'word' 时使用）
     */
    GraphBuilder.prototype.buildLocalGraph = function (center, allFilteredWords, mode) {
      var mgr = window.taxonomyManager;
      var elements = [];
      var addedNodes = {};
      var maxRelatedWords = 50;

      if (center.type === 'word') {
        // 中心是词 → 显示该词 + 所有 domain + semantic + pos
        var w = center.data;
        var wordNodeId = 'word:' + w.index;
        elements.push({
          data: { id: wordNodeId, type: 'word', label: w.word, nodeSize: 55, rawData: w },
        });
        addedNodes[wordNodeId] = true;

        // domain 关联
        for (var i = 0; i < w.domain_codes.length; i++) {
          var dc = w.domain_codes[i];
          var did = 'domain:' + dc;
          if (!addedNodes[did]) {
            elements.push({
              data: {
                id: did,
                type: 'domain',
                label: mgr.getLabel('domain', dc),
                nodeSize: 60,
                code: dc,
                description: mgr.getDescription('domain', dc),
              },
            });
            addedNodes[did] = true;
          }
          elements.push({
            data: { id: wordNodeId + '->' + did, source: wordNodeId, target: did, type: 'word_in_domain' },
          });
        }

        // semantic 关联
        for (var i = 0; i < w.semantic_tag_codes.length; i++) {
          var sc = w.semantic_tag_codes[i];
          var sid = 'semantic:' + sc;
          if (!addedNodes[sid]) {
            elements.push({
              data: {
                id: sid,
                type: 'semantic',
                label: mgr.getLabel('semantic', sc),
                nodeSize: 55,
                code: sc,
                description: mgr.getDescription('semantic', sc),
              },
            });
            addedNodes[sid] = true;
          }
          elements.push({
            data: {
              id: wordNodeId + '->' + sid,
              source: wordNodeId,
              target: sid,
              type: 'word_has_semantic_tag',
            },
          });
        }

        // pos 关联
        var lexicalMetadata = window.JPLearn && window.JPLearn.lexicalMetadata;
        var posCodes = lexicalMetadata
          ? lexicalMetadata.classes(w.pos)
          : typeof w.pos === 'string' && w.pos
            ? [w.pos]
            : [];
        for (var p = 0; p < posCodes.length; p++) {
          var posCode = posCodes[p];
          var pid = 'pos:' + posCode;
          if (!addedNodes[pid]) {
            elements.push({
              data: {
                id: pid,
                type: 'pos',
                label: mgr.getLabel('pos', posCode),
                nodeSize: 45,
                code: posCode,
              },
            });
            addedNodes[pid] = true;
          }
          elements.push({
            data: { id: wordNodeId + '->' + pid, source: wordNodeId, target: pid, type: 'word_has_pos' },
          });
        }
      } else {
        // 中心是分类节点 → 显示该分类 + 关联词
        var cType = center.type; // 'domain', 'semantic' or 'pos'
        var cCode = center.data.code || center.data;
        var lexicalMetadata = window.JPLearn && window.JPLearn.lexicalMetadata;
        var cField = cType === 'domain' ? 'domain_codes' : 'semantic_tag_codes';
        var centerId = cType + ':' + cCode;

        elements.push({
          data: {
            id: centerId,
            type: cType,
            label: mgr.getLabel(cType, cCode),
            nodeSize: 80,
            code: cCode,
            description: mgr.getDescription(cType, cCode),
          },
        });
        addedNodes[centerId] = true;

        // 找出关联词
        var relatedWords = [];
        for (var i = 0; i < allFilteredWords.length; i++) {
          var word = allFilteredWords[i];
          var matchesCenter =
            cType === 'pos'
              ? lexicalMetadata
                ? lexicalMetadata.hasClass(word.pos, cCode)
                : word.pos === cCode
              : word[cField].indexOf(cCode) !== -1;
          if (matchesCenter) {
            relatedWords.push(allFilteredWords[i]);
            if (relatedWords.length >= maxRelatedWords) break;
          }
        }

        for (var i = 0; i < relatedWords.length; i++) {
          var rw = relatedWords[i];
          var rwId = 'word:' + rw.index;
          if (!addedNodes[rwId]) {
            elements.push({
              data: { id: rwId, type: 'word', label: rw.word, nodeSize: 40, rawData: rw },
            });
            addedNodes[rwId] = true;
          }
          elements.push({
            data: { id: rwId + '->' + centerId, source: rwId, target: centerId, type: 'word_in_' + cType },
          });
        }
      }

      this.cy.elements().remove();
      this.cy.add(elements);

      var layout = this._getLayoutOptions(elements.length, 'cose');
      this.cy.layout(layout).run();

      this._updateStats();
    };
  };
})(window);
