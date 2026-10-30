/**
 * ViewMode: 视图模式状态机
 *
 * 模式:
 *   graph     — 普通图谱（词→分类）
 *   list      — 分页列表
 *   aggregate — 聚合图（只显示分类节点，节点大小∝关联词数）
 *   local     — 局部图（以某节点为中心的一阶邻居子图）
 *   study     — 学习模式（卡片式背词）
 *   cards     — 词卡目录（电子词卡册）
 */
var ViewMode = {
    GRAPH: 'graph',
    LIST: 'list',
    AGGREGATE: 'aggregate',
    LOCAL: 'local',
    STUDY: 'study',
    CARDS: 'cards',

    current: null,
    previousMode: null,
    localCenter: null,   // { type:'word'|'domain'|'semantic', data: obj }
    _listeners: [],

    /**
     * 模式名称映射（用于 UI 显示）
     */
    LABELS: {
        graph: '普通图谱',
        list: '列表视图',
        aggregate: '聚合图',
        local: '局部图',
        study: '学习模式',
        cards: '词卡模式'
    },

    /**
     * 切换视图模式
     */
    set: function(mode, opts) {
        if (mode === this.current && mode !== 'local') return;
        this.previousMode = this.current;
        this.current = mode;

        if (mode === 'local' && opts && opts.center) {
            this.localCenter = opts.center;
        }
        if (mode !== 'local') {
            this.localCenter = null;
        }

        this._updateUI();
        this._notify();
    },

    get: function() {
        return this.current;
    },

    getLabel: function() {
        return this.LABELS[this.current] || this.current;
    },

    /**
     * 返回上级视图（从 local/study 返回）
     */
    goBack: function() {
        var target = this.previousMode || 'cards';
        if (target === 'local' || target === 'graph' || target === 'aggregate') target = 'cards';
        this.set(target);
    },

    /**
     * 进入局部图模式
     */
    showLocal: function(centerType, centerData) {
        this.set('local', {
            center: { type: centerType, data: centerData }
        });
    },

    /**
     * 自动模式：根据数据量决定视图
     */
    autoSelect: function(filteredCount) {
        if (filteredCount <= 200) {
            this.set('graph');
        } else if (filteredCount <= 500) {
            this.set('graph');
        } else {
            this.set('aggregate');
        }
    },

    onChange: function(fn) {
        this._listeners.push(fn);
    },

    _notify: function() {
        for (var i = 0; i < this._listeners.length; i++) {
            this._listeners[i](this.current);
        }
    },

    /**
     * 更新 UI 可见性：图谱容器 vs 列表容器 vs 学习容器
     */
    _updateUI: function() {
        var graphEl = document.getElementById('graph-container');
        var listEl = document.getElementById('list-container');
        var studyEl = document.getElementById('study-container');
        var cardEl = document.getElementById('card-container');
        var graphStatsEl = document.getElementById('graphStats');
        var backBtn = document.getElementById('backToOverviewBtn');

        if (!graphEl || !listEl) return;

        // 默认全部隐藏
        graphEl.style.display = 'none';
        listEl.style.display = 'none';
        if (studyEl) studyEl.style.display = 'none';
        if (cardEl) cardEl.style.display = 'none';
        if (graphStatsEl) graphStatsEl.style.display = 'none';

        switch (this.current) {
            case 'list':
                listEl.style.display = 'block';
                break;
            case 'study':
                if (studyEl) studyEl.style.display = 'flex';
                break;
            case 'cards':
                if (cardEl) cardEl.style.display = 'block';
                break;
            default: // graph, aggregate, local
                graphEl.style.display = 'block';
                if (graphStatsEl) graphStatsEl.style.display = 'block';
                break;
        }

        // 局部图模式下显示返回按钮
        if (backBtn) {
            backBtn.style.display = (this.current === 'local') ? 'inline-block' : 'none';
        }

        // 同步 select 值（study 和 local 不在 select 里，不同步）
        var sel = document.getElementById('viewModeSelect');
        if (sel && this.current !== 'local' && this.current !== 'study') {
            if (sel.value !== this.current) sel.value = this.current;
        }

        // 更新状态栏
        var modeLabel = document.getElementById('statusViewMode');
        if (modeLabel) {
            modeLabel.textContent = this.LABELS[this.current] || this.current;
        }

        // 学习队列状态
        var studyQueueEl = document.getElementById('statusStudyWrap');
        if (studyQueueEl) {
            studyQueueEl.style.display = (this.current === 'study') ? 'inline' : 'none';
        }
    }
};

window.ViewMode = ViewMode;
