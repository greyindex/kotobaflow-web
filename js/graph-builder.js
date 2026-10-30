/**
 * GraphBuilder: 用 Cytoscape.js 构建和渲染图谱
 *
 * [v3] 新增：
 *   - 支持最多 4000 词条渲染
 *   - 三级性能保护（normal / simplified / extreme）
 *   - preset 随机散布布局（2000+ 节点避免 cose 卡死）
 */
function GraphBuilder(containerId) {
    this.containerId = containerId;
    this.cy = null;
    this._perfMode = 'normal'; // 'normal' | 'simplified' | 'extreme'
}

// Cytoscape (about 357 KB) loads when a graph is first shown, not at start-up.
GraphBuilder.SCRIPT_URL = './vendor/cytoscape.min.js?v=3.28.1';
var cytoscapeLoading = null;

function loadCytoscape() {
    if (window.cytoscape) return Promise.resolve();
    if (!cytoscapeLoading) {
        cytoscapeLoading = new Promise(function(resolve, reject) {
            var script = document.createElement('script');
            script.src = GraphBuilder.SCRIPT_URL;
            script.onload = function() { resolve(); };
            script.onerror = function() {
                cytoscapeLoading = null;
                script.remove();
                reject(new Error('Cytoscape failed to load'));
            };
            document.head.appendChild(script);
        });
    }
    return cytoscapeLoading;
}

// Kept for the start-up call; the engine itself starts in ready().
GraphBuilder.prototype.init = function() {};

GraphBuilder.prototype.ready = function() {
    var self = this;
    if (this.cy) return Promise.resolve(this);
    return loadCytoscape().then(function() {
        if (!self.cy) self._createCy();
        return self;
    });
};

GraphBuilder.prototype._createCy = function() {
    this.cy = cytoscape({
        container: document.getElementById(this.containerId),
        style: [
            {
                selector: 'node',
                style: {
                    'label': 'data(label)',
                    'text-valign': 'center',
                    'text-halign': 'center',
                    'color': '#fff',
                    'text-outline-width': 1.5,
                    'font-size': '11px',
                    'font-family': 'sans-serif',
                    'min-zoomed-font-size': 8
                }
            },
            {
                selector: 'node[type="word"]',
                style: {
                    'background-color': '#4A8C6E',
                    'text-outline-color': '#2A5C42',
                    'width': 38,
                    'height': 38,
                    'font-size': '11px'
                }
            },
            {
                selector: 'node[type="domain"]',
                style: {
                    'background-color': '#B07D2A',
                    'text-outline-color': '#6B4410',
                    'shape': 'hexagon',
                    'width': 'data(nodeSize)',
                    'height': 'data(nodeSize)',
                    'font-size': '13px',
                    'font-weight': 'bold'
                }
            },
            {
                selector: 'node[type="semantic"]',
                style: {
                    'background-color': '#5A5098',
                    'text-outline-color': '#352E6A',
                    'shape': 'round-rectangle',
                    'width': 'data(nodeSize)',
                    'height': 'data(nodeSize)',
                    'font-size': '12px'
                }
            },
            {
                selector: 'node[type="pos"]',
                style: {
                    'background-color': '#A84830',
                    'text-outline-color': '#6B2010',
                    'shape': 'diamond',
                    'width': 45,
                    'height': 45
                }
            },
            {
                selector: 'edge',
                style: {
                    'width': 1,
                    'line-color': '#C8BFAE',
                    'curve-style': 'bezier',
                    'opacity': 0.4
                }
            },
            // 聚合图的边（按共享词数着色）
            {
                selector: 'edge[type="cooccurrence"]',
                style: {
                    'width': 'data(weight)',
                    'line-color': '#B0A99F',
                    'opacity': 0.28
                }
            },
            {
                selector: '.highlighted',
                style: {
                    'border-width': 3,
                    'border-color': '#fff',
                    'opacity': 1,
                    'z-index': 999
                }
            },
            {
                selector: '.dimmed',
                style: {
                    'opacity': 0.10
                }
            }
        ],
        layout: { name: 'preset' }
    });
    // Slow wheel zoom (one notch ≈ 0.87× instead of 0.4×). Passing
    // wheelSensitivity at init makes Cytoscape 3.28 log a warning on every
    // graph; its renderer reads this field on each wheel event instead.
    var renderer = this.cy.renderer();
    if (renderer && typeof renderer.wheelSensitivity === 'number') renderer.wheelSensitivity = 0.15;

    this._attachEvents();
    this._attachZoomLabelToggle();
};

GraphBuilder.prototype._attachEvents = function() {
    var self = this;

    // 点击空白处恢复
    this.cy.on('tap', function(e) {
        if (e.target === self.cy) {
            self.cy.elements().removeClass('highlighted dimmed');
            if (window.detailPanel) window.detailPanel.clear();
        }
    });

    // 点击节点：高亮一阶邻居
    this.cy.on('tap', 'node', function(e) {
        var node = e.target;
        var neighborhood = node.neighborhood().add(node);

        self.cy.elements().addClass('dimmed').removeClass('highlighted');
        neighborhood.removeClass('dimmed').addClass('highlighted');

        if (window.detailPanel) {
            var originalEvent = e.originalEvent || {};
            var graphRect = self.container && self.container.getBoundingClientRect
                ? self.container.getBoundingClientRect()
                : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
            var anchorX = isFinite(originalEvent.clientX)
                ? originalEvent.clientX
                : graphRect.left + graphRect.width / 2;
            var anchorY = isFinite(originalEvent.clientY)
                ? originalEvent.clientY
                : graphRect.top + graphRect.height / 2;
            window.detailPanel.showNode(node.data(), {
                left: anchorX,
                right: anchorX + 1,
                top: anchorY,
                bottom: anchorY + 1,
                width: 1,
                height: 1
            });

            // 如果是分类节点，补充关联词条
            if (node.data('type') !== 'word') {
                var connectedWords = node.neighborhood('node[type="word"]').map(function(n) {
                    return n.data('rawData');
                });
                window.detailPanel.appendConnectedWords(connectedWords, node.data());
            }
        }
    });
};

/**
 * 缩放时隐藏标签：zoom < 0.5 时隐藏 word 节点标签，减少渲染压力
 */
GraphBuilder.prototype._attachZoomLabelToggle = function() {
    var self = this;
    var labelsHidden = false;

    this.cy.on('zoom', function() {
        var z = self.cy.zoom();
        if (z < 0.5 && !labelsHidden) {
            self.cy.nodes('[type="word"]').style('label', '');
            labelsHidden = true;
        } else if (z >= 0.5 && labelsHidden) {
            self.cy.nodes('[type="word"]').style('label', function(n) { return n.data('label'); });
            labelsHidden = false;
        }
    });
};

/**
 * 更新状态栏上的节点/边计数
 */
GraphBuilder.prototype._updateStats = function() {
    var nodes = this.cy.nodes().length;
    var edges = this.cy.edges().length;
    document.getElementById('nodeCount').textContent = nodes;
    document.getElementById('edgeCount').textContent = edges;
    // 同步顶部状态栏
    var sn = document.getElementById('statusNodes');
    var se = document.getElementById('statusEdges');
    if (sn) sn.textContent = nodes;
    if (se) se.textContent = edges;
};

/**
 * 选择合适的布局参数
 */
GraphBuilder.prototype._getLayoutOptions = function(nodeCount, layoutName) {
    var animate = nodeCount < 500;
    var duration = nodeCount > 300 ? 300 : 600;

    if (layoutName === 'aggregate') {
        return {
            name: 'circle',
            animate: true,
            animationDuration: 600,
            fit: true,
            padding: 60,
            avoidOverlap: true,
            startAngle: 0,
            sweep: 2 * Math.PI,
            sort: function(a, b) {
                return (b.data('wordCount') || 0) - (a.data('wordCount') || 0);
            }
        };
    }

    // 2000+ 节点使用 preset 随机散布（cose 会卡死）
    if (nodeCount > 3000) {
        var w = 6000, h = 4000;
        return {
            name: 'preset',
            fit: true,
            padding: 20,
            positions: function() {
                return {
                    x: Math.random() * w - w / 2,
                    y: Math.random() * h - h / 2
                };
            }
        };
    }

    // 普通 cose layout
    return {
        name: 'cose',
        animate: animate,
        animationDuration: duration,
        idealEdgeLength: nodeCount > 1000 ? 50 : 80,
        nodeOverlap: nodeCount > 1000 ? 10 : 20,
        refresh: 20,
        fit: true,
        padding: 30,
        componentSpacing: nodeCount > 1000 ? 40 : 80,
        nodeRepulsion: nodeCount > 1000 ? 200000 : 400000,
        edgeElasticity: nodeCount > 1000 ? 50 : 100,
        nestingFactor: 5,
        numIter: nodeCount > 1000 ? 500 : 1000
    };
};

/**
 * 三级性能保护
 *   normal:     ≤ 500  — 正常渲染
 *   simplified: 501-2000 — 隐藏词标签, 细边, 无动画
 *   extreme:    2001-4000 — 15px节点, 无标签, haystack边
 */
GraphBuilder.prototype._applyPerformanceMode = function(wordNodeCount) {
    if (wordNodeCount <= 500) {
        this._perfMode = 'normal';
        return;
    }

    if (wordNodeCount <= 2000) {
        this._perfMode = 'simplified';
        // 隐藏词节点标签
        this.cy.nodes('[type="word"]').style({
            'label': '',
            'width': 25,
            'height': 25
        });
        // 简化边
        this.cy.edges().style({
            'opacity': 0.25,
            'width': 0.8
        });
        return;
    }

    // extreme: 2001-4000
    this._perfMode = 'extreme';
    this.cy.nodes('[type="word"]').style({
        'label': '',
        'width': 15,
        'height': 15
    });
    this.cy.edges().style({
        'opacity': 0.12,
        'width': 0.5,
        'curve-style': 'haystack'
    });
};

// ────────────────────────────────────────────────────────────
// 普通图谱 (原有方法，增强)
// ────────────────────────────────────────────────────────────

/**
 * 构建普通图数据并渲染
 * @param {Array} words - 过滤后的词条数组
 * @param {string} mode - 'domain' or 'semantic'
 * @param {number} limit - 最大渲染词条数
 */
window.JPLearn.installGraphBuilders(GraphBuilder);
